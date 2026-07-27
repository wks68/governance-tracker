// 治理儀表板 UI 收斂新增：Preview／Smoke 展示資料建置腳本。
//
// 目的：正式 dev.db 目前沒有新版 Workflow runtime 資料（Hotfix v1 尚未實際發布給正式
// 案件使用），無法用來展示收斂後的治理儀表板畫面。本腳本在一個獨立 scratch DB 上建立
// 完整展示資料：發布 Hotfix v1 WorkflowVersion，並透過真正的執行引擎（M2-B
// workflowExecutionService，而非直接寫 raw row）把數筆 Issue 推進到各種需要展示的狀態
// （RD 修正中／待 RD 主管核准／QA 驗證中／待 QA 主管核准／OP 部署準備中／開單人確認中／
// 有風險／風險待確認／停留過久／重複退回／已取消），外加原有舊制案件（prisma/seed.ts）。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 執行方式（DATABASE_URL 指向的檔案必須已存在）：
//   touch /path/to/preview.db
//   DATABASE_URL="file:/path/to/preview.db" node_modules/.bin/tsx scripts/dev/seedGovernancePreviewDb.ts

import "../lib/assertSafeTestDatabase";

import { execSync } from "node:child_process";
import { prisma } from "../../src/lib/prisma";
import { decideApprovalRecord } from "../../src/lib/approvalService";
import { buildHotfixWorkflowV1 } from "../lib/buildHotfixWorkflowV1";
import {
  startIssueWorkflow,
  executeIssueTransition,
  returnIssueToStage,
  cancelIssueWorkflow,
  setIssueAssignedTeamAtTriage,
} from "../../src/lib/workflowExecutionService";

const RUN_TAG = "hfpv";

async function createUser(name: string, role: string) {
  const user = await prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function createTeam(name: string) {
  return prisma.team.create({ data: { name } });
}

async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD") {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
}

async function findTransition(workflowVersionId: string, fromStageId: string, actionKey: string) {
  const t = await prisma.workflowTransition.findFirst({ where: { workflowVersionId, fromStageId, actionKey } });
  if (!t) throw new Error(`找不到 Transition（fromStageId=${fromStageId}, actionKey=${actionKey}）`);
  return t;
}

async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  const r = await prisma.approvalRecord.findFirst({
    where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" },
    orderBy: { revisionNo: "desc" },
  });
  if (!r) throw new Error(`找不到 ApprovalRecord（${approvalType}/${relatedStageKey}）`);
  return r;
}

async function answerRiskChecks(issueId: string, stageKey: string, userId: string, answer: "NO" | "YES" | "UNKNOWN" = "NO") {
  const { getRiskCheckTemplate } = await import("../../src/lib/riskCheckTemplates");
  const template = getRiskCheckTemplate(stageKey);
  if (!template) throw new Error(`stageKey「${stageKey}」無風險檢核模板`);
  for (const item of template) {
    await prisma.stageRiskCheck.create({
      data: { issueId, stageKey, assessmentRound: 1, checkKey: item.checkKey, answer, answeredByUserId: userId, answeredAt: new Date() },
    });
  }
}

interface Ctx {
  hotfix: Awaited<ReturnType<typeof buildHotfixWorkflowV1>>;
  admin: { id: string };
  pm: { id: string };
  supervisor: { id: string };
  rdTeam: { id: string; name: string };
  rdMember: { id: string };
  rdLead: { id: string };
  qaTeam: { id: string; name: string };
  qaMember: { id: string };
  qaLead: { id: string };
  opTeam: { id: string; name: string };
  opMember: { id: string };
  opLead: { id: string };
}

// 依序推進 Issue 的每一步（每個 step 執行後所處的關卡列於右側註解），供 advanceTo
// 依 targetStepIndex 執行前綴步驟，實測共用同一套真實執行引擎（非直接寫 raw row）。
function buildSteps(ctx: Ctx, issue: { id: string }) {
  const { hotfix, pm, supervisor, rdTeam, rdMember, rdLead, qaTeam, qaMember, qaLead, opTeam, opMember, opLead } = ctx;
  const s = hotfix.stageIds;
  return [
    // 0: draft -> pendingBusinessApproval
    async () => {
      const t = await findTransition(hotfix.version.id, s.draft, "submit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW_SUBMIT" });
    },
    // 1: pendingBusinessApproval -> pendingRdTriage
    async () => {
      const approval = await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: supervisor.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingBusinessApproval, "businessApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
    // 2: pendingRdTriage -> pendingRdClaim -> rdInProgress
    async () => {
      await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: rdTeam.id, actorId: supervisor.id, reasonCode: "PREVIEW_ASSIGN_RD" });
      const assignT = await findTransition(hotfix.version.id, s.pendingRdTriage, "rdAssign");
      await executeIssueTransition({ issueId: issue.id, transitionId: assignT.id, actorId: supervisor.id, reasonCode: "PREVIEW" });
      const claimT = await findTransition(hotfix.version.id, s.pendingRdClaim, "rdClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: claimT.id, actorId: rdMember.id, reasonCode: "PREVIEW" });
    },
    // 3: rdInProgress -> pendingRdLeadApproval
    async () => {
      await prisma.issueFieldValue.create({ data: { issueId: issue.id, fieldKey: "rdFixVersion", fieldLabel: "修正版本", fieldValue: "v1.0.0-preview" } });
      await answerRiskChecks(issue.id, "pendingRdLeadApproval", rdMember.id, "NO");
      const t = await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: rdMember.id, reasonCode: "PREVIEW" });
    },
    // 4: pendingRdLeadApproval -> pendingQaTriage
    async () => {
      const approval = await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: rdLead.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: rdLead.id, reasonCode: "PREVIEW" });
    },
    // 5: pendingQaTriage -> pendingQaClaim -> qaInProgress
    async () => {
      await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: qaTeam.id, actorId: supervisor.id, reasonCode: "PREVIEW_ASSIGN_QA" });
      const assignT = await findTransition(hotfix.version.id, s.pendingQaTriage, "qaAssign");
      await executeIssueTransition({ issueId: issue.id, transitionId: assignT.id, actorId: supervisor.id, reasonCode: "PREVIEW" });
      const claimT = await findTransition(hotfix.version.id, s.pendingQaClaim, "qaClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: claimT.id, actorId: qaMember.id, reasonCode: "PREVIEW" });
    },
    // 6: qaInProgress -> pendingQaLeadApproval
    async () => {
      await prisma.issueFieldValue.create({ data: { issueId: issue.id, fieldKey: "qaTestResult", fieldLabel: "QA 測試結果", fieldValue: "通過" } });
      await answerRiskChecks(issue.id, "pendingQaLeadApproval", qaMember.id, "NO");
      const t = await findTransition(hotfix.version.id, s.qaInProgress, "qaSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: qaMember.id, reasonCode: "PREVIEW" });
    },
    // 7: pendingQaLeadApproval -> pendingOpTriage
    async () => {
      const approval = await findActiveApproval(issue.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: qaLead.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingQaLeadApproval, "qaLeadApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: qaLead.id, reasonCode: "PREVIEW" });
    },
    // 8: pendingOpTriage -> pendingOpClaim -> opPreparing
    async () => {
      await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: opTeam.id, actorId: supervisor.id, reasonCode: "PREVIEW_ASSIGN_OP" });
      const assignT = await findTransition(hotfix.version.id, s.pendingOpTriage, "opAssign");
      await executeIssueTransition({ issueId: issue.id, transitionId: assignT.id, actorId: supervisor.id, reasonCode: "PREVIEW" });
      const claimT = await findTransition(hotfix.version.id, s.pendingOpClaim, "opClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: claimT.id, actorId: opMember.id, reasonCode: "PREVIEW" });
    },
    // 9: opPreparing -> pendingDeploymentApproval
    async () => {
      await prisma.evidence.create({ data: { issueId: issue.id, type: "Log", title: "部署前檢查", url: "http://example.invalid/checklist" } });
      await answerRiskChecks(issue.id, "pendingDeploymentApproval", opMember.id, "NO");
      const t = await findTransition(hotfix.version.id, s.opPreparing, "opSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: opMember.id, reasonCode: "PREVIEW" });
    },
    // 10: pendingDeploymentApproval -> opDeploying
    async () => {
      const approval = await findActiveApproval(issue.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: opLead.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingDeploymentApproval, "opLeadApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: opLead.id, reasonCode: "PREVIEW" });
    },
    // 11: opDeploying -> opCompleted
    async () => {
      const t = await findTransition(hotfix.version.id, s.opDeploying, "opDeployComplete");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: opMember.id, reasonCode: "PREVIEW" });
    },
    // 12: opCompleted -> pendingReporterConfirmation
    async () => {
      const t = await findTransition(hotfix.version.id, s.opCompleted, "reporterConfirmOpen");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
    // 13: pendingReporterConfirmation -> reporterConfirming
    async () => {
      const t = await findTransition(hotfix.version.id, s.pendingReporterConfirmation, "reporterClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
    // 14: reporterConfirming -> closed
    async () => {
      await prisma.comment.create({ data: { issueId: issue.id, authorRole: "PM", authorName: "王小明", body: "確認完成，可結案。" } });
      const t = await findTransition(hotfix.version.id, s.reporterConfirming, "reporterClose");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
  ];
}

// STEP INDEX 對照表（執行完該 index 之後所處的關卡）：
//   0 pendingBusinessApproval / 1 pendingRdTriage / 2 rdInProgress /
//   3 pendingRdLeadApproval / 4 pendingQaTriage / 5 qaInProgress /
//   6 pendingQaLeadApproval / 7 pendingOpTriage / 8 opPreparing /
//   9 pendingDeploymentApproval / 10 opDeploying / 11 opCompleted /
//   12 pendingReporterConfirmation / 13 reporterConfirming / 14 closed
async function advanceTo(ctx: Ctx, issue: { id: string }, targetStepIndex: number) {
  const steps = buildSteps(ctx, issue);
  for (let i = 0; i <= targetStepIndex; i++) {
    await steps[i]();
  }
}

async function createHotfixIssue(key: string, title: string, ctx: Ctx) {
  const issue = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-${key}`, issueType: "Hotfix", title, workflowStatus: "n/a" },
  });
  await startIssueWorkflow({ issueId: issue.id, workflowVersionId: ctx.hotfix.version.id, actorId: ctx.admin.id, reasonCode: "PREVIEW_START" });
  return issue;
}

async function backdateOpenHistory(issueId: string, days: number) {
  const openRow = await prisma.issueWorkflowStageHistory.findFirst({ where: { issueId, exitedAt: null }, orderBy: { executedAt: "desc" } });
  if (!openRow) throw new Error(`找不到 Issue「${issueId}」目前開放的歷程列，無法回填停留天數`);
  await prisma.issueWorkflowStageHistory.update({
    where: { id: openRow.id },
    data: { executedAt: new Date(Date.now() - days * 86_400_000) },
  });
}

async function main() {
  console.log("=== 建立治理儀表板 Preview／Smoke 展示資料 ===");

  console.log("[1/4] 套用 baseline seed（原有 7 位使用者＋19 筆舊制案件）...");
  execSync("npx tsx prisma/seed.ts", { cwd: process.cwd(), stdio: "inherit" });

  console.log("[2/4] 建立 RD／QA／OP 團隊與人員、發布 Hotfix v1 流程...");
  const admin = await createUser("PreviewAdmin", "Admin");
  const pm = await createUser("PreviewPM", "PM");
  const supervisor = await createUser("PreviewSupervisor", "DMS主管");
  await prisma.userSupervisorAssignment.create({
    data: { userId: pm.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });

  const rdTeam = await createTeam("RD 維運團隊");
  const rdMember = await createUser("PreviewRdMember", "RD");
  const rdLead = await createUser("PreviewRdLead", "RD");
  await addMember(rdTeam.id, rdMember.id, "MEMBER");
  await addMember(rdTeam.id, rdLead.id, "LEAD");

  const qaTeam = await createTeam("QA 驗證團隊");
  const qaMember = await createUser("PreviewQaMember", "QA");
  const qaLead = await createUser("PreviewQaLead", "QA");
  await addMember(qaTeam.id, qaMember.id, "MEMBER");
  await addMember(qaTeam.id, qaLead.id, "LEAD");

  const opTeam = await createTeam("OP 部署團隊");
  const opMember = await createUser("PreviewOpMember", "OP");
  const opLead = await createUser("PreviewOpLead", "OP");
  await addMember(opTeam.id, opMember.id, "MEMBER");
  await addMember(opTeam.id, opLead.id, "LEAD");

  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "PREVIEW_BUILD_HOTFIX_V1", keySuffix: RUN_TAG });

  const ctx: Ctx = { hotfix, admin, pm, supervisor, rdTeam, rdMember, rdLead, qaTeam, qaMember, qaLead, opTeam, opMember, opLead };

  console.log("[3/4] 建立展示用 Hotfix 案件（依需求 6 節清單各狀態）...");

  const rd1 = await createHotfixIssue("RD-01", "登入頁面驗證碼顯示異常", ctx);
  await advanceTo(ctx, rd1, 2); // RD 修正中

  const rd2 = await createHotfixIssue("RD-02", "訂單列表分頁載入緩慢", ctx);
  await advanceTo(ctx, rd2, 2); // RD 修正中

  const rdApproval = await createHotfixIssue("RD-03", "付款金額計算錯誤", ctx);
  await advanceTo(ctx, rdApproval, 3); // 待 RD 主管核准

  const qaVerify = await createHotfixIssue("QA-01", "報表匯出格式錯誤", ctx);
  await advanceTo(ctx, qaVerify, 5); // QA 驗證中

  const qaRelease = await createHotfixIssue("QA-02", "會員點數異動未同步", ctx);
  await advanceTo(ctx, qaRelease, 6); // 待 QA 主管核准（QA 放行）

  const opDeploy = await createHotfixIssue("OP-01", "推播通知延遲逾時", ctx);
  await advanceTo(ctx, opDeploy, 8); // OP 部署準備中（待 OP 上版）

  const confirming = await createHotfixIssue("CF-01", "客服工單自動轉派失敗", ctx);
  await advanceTo(ctx, confirming, 13); // 開單人確認中（正式環境確認）

  const riskYes = await createHotfixIssue("RISK-01", "客戶資料匯出權限異常", ctx);
  await advanceTo(ctx, riskYes, 2); // RD 修正中
  await prisma.stageRiskCheck.create({
    data: { issueId: riskYes.id, stageKey: "rdInProgress", assessmentRound: 1, checkKey: "PREVIEW_DEMO_RISK", answer: "YES", detail: "涉及個資匯出，需資安複核", answeredByUserId: rdMember.id, answeredAt: new Date() },
  });

  const riskUnknown = await createHotfixIssue("RISK-02", "第三方金流介接逾時", ctx);
  await advanceTo(ctx, riskUnknown, 5); // QA 驗證中
  await prisma.stageRiskCheck.create({
    data: { issueId: riskUnknown.id, stageKey: "qaInProgress", assessmentRound: 1, checkKey: "PREVIEW_DEMO_RISK", answer: "UNKNOWN", detail: "待確認是否影響對帳作業", answeredByUserId: qaMember.id, answeredAt: new Date() },
  });

  const stale = await createHotfixIssue("STALE-01", "舊版 API 相容性問題", ctx);
  await advanceTo(ctx, stale, 2); // RD 修正中
  await backdateOpenHistory(stale.id, 8); // 停留超過 7 天

  const repeatedReturn = await createHotfixIssue("RETURN-01", "庫存扣減出現負值", ctx);
  await advanceTo(ctx, repeatedReturn, 3); // 待 RD 主管核准
  for (let i = 0; i < 2; i++) {
    const approval = await findActiveApproval(repeatedReturn.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: rdLead.id, decision: "REJECTED", decisionReasonCode: "NEEDS_MORE_WORK" });
    const rejectT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingRdLeadApproval, "rdLeadReject");
    await returnIssueToStage({ issueId: repeatedReturn.id, transitionId: rejectT.id, actorId: rdLead.id, reasonCode: "NEEDS_MORE_WORK" });
    if (i === 0) {
      const resubmitT = await findTransition(hotfix.version.id, hotfix.stageIds.rdInProgress, "rdSubmit");
      await executeIssueTransition({ issueId: repeatedReturn.id, transitionId: resubmitT.id, actorId: rdMember.id, reasonCode: "PREVIEW_RESUBMIT" });
    }
  }
  // 結束時停在 rdInProgress，returnCount=2（重複退回）。

  const cancelled = await createHotfixIssue("CANCEL-01", "誤植的緊急需求", ctx);
  const cancelT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "cancelDraft");
  await cancelIssueWorkflow({ issueId: cancelled.id, transitionId: cancelT.id, actorId: admin.id, reasonCode: "PREVIEW_CANCEL" });

  console.log("[4/4] 完成。");
  console.log(`  RD 修正中：${rd1.issueKey}, ${rd2.issueKey}, ${riskYes.issueKey}（有風險）, ${stale.issueKey}（停留過久）`);
  console.log(`  待 RD 主管核准：${rdApproval.issueKey}`);
  console.log(`  QA 驗證中：${qaVerify.issueKey}, ${riskUnknown.issueKey}（風險待確認）`);
  console.log(`  待 QA 主管核准（QA 放行）：${qaRelease.issueKey}`);
  console.log(`  OP 部署準備中（待 OP 上版）：${opDeploy.issueKey}`);
  console.log(`  開單人確認中（正式環境確認）：${confirming.issueKey}`);
  console.log(`  重複退回（現停 RD 修正中）：${repeatedReturn.issueKey}`);
  console.log(`  已取消：${cancelled.issueKey}`);
  console.log(`  Team：${rdTeam.name} / ${qaTeam.name} / ${opTeam.name}`);
}

main()
  .catch((err) => {
    console.error("建立 Preview 展示資料時發生錯誤：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
