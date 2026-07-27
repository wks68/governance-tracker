// Hotfix 操作畫面收斂 Preview／Smoke 展示資料建置腳本。
//
// 目的：獨立於治理儀表板 Preview（governance_dashboard_preview.ts）之外，建立一份
// 聚焦「Hotfix Issue 明細頁操作畫面」的展示 DB——涵蓋 RD 修正中／待 RD 主管核准
// （RD 自測）／QA 驗證中／待 QA 主管核准（QA 放行確認）／OP 部署中／正式環境確認中／
// 已退回／有風險／風險待釐清／已取消／已完成，並為每個角色（PM／RD／RD 主管／QA／
// QA 主管／OP／OP 主管／Admin）各建立一位可登入使用者，供角色別畫面驗收。
//
// 一律透過真正的執行引擎（workflowExecutionService／approvalService，非直接寫
// raw row）推進案件；風險檢核改用 M2-B/Hotfix UI 新增的 submitStageRiskCheckAnswer
// 服務函式填答（見 src/lib/workflow-execution/requirementService.ts），示範真正的
// 使用者填答路徑，而不是像治理儀表板 Preview 那樣直接寫 StageRiskCheck row。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 使用方式（單一指令，DB 路徑已由頂層 .gitignore 的 `*.db` 規則排除，不會被 commit）：
//   npm run hotfix-ui:preview        # 重建 preview DB 並灌入展示資料
//   npm run dev:hotfix-ui-preview    # 啟動 dev server 指向該 DB
//
// 直接執行本檔（略過上面兩個 npm script）：
//   rm -f prisma/hotfix-ui-preview.db
//   DATABASE_URL="file:./hotfix-ui-preview.db" npx prisma migrate deploy
//   DATABASE_URL="file:./hotfix-ui-preview.db" node_modules/.bin/tsx scripts/hotfix_ui_preview.ts

import "./lib/assertSafeTestDatabase";

import { prisma } from "../src/lib/prisma";
import { decideApprovalRecord } from "../src/lib/approvalService";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import {
  startIssueWorkflow,
  executeIssueTransition,
  returnIssueToStage,
  cancelIssueWorkflow,
  setIssueAssignedTeamAtTriage,
  submitStageRiskCheckAnswer,
} from "../src/lib/workflowExecutionService";

const RUN_TAG = "hfui";

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

// 透過真正的 submitStageRiskCheckAnswer 服務函式填答（不是直接寫 raw row），
// 示範實際使用者操作路徑；aggregateAnswer 全部一致時可一次填完整個模板。
async function answerAllRiskChecks(issueId: string, stageKey: string, actorId: string, answer: "YES" | "NO" | "UNKNOWN") {
  const { getRiskCheckTemplate } = await import("../src/lib/riskCheckTemplates");
  const template = getRiskCheckTemplate(stageKey);
  if (!template) throw new Error(`stageKey「${stageKey}」無風險檢核模板`);
  for (const item of template) {
    await submitStageRiskCheckAnswer({ issueId, stageKey, checkKey: item.checkKey, answer, actorId });
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

// 依序推進 Issue 的每一步（每個 step 執行後所處的關卡列於右側註解）。與治理儀表板
// Preview 的 buildSteps 同一套推進順序（各自獨立維護一份，兩個 Preview 腳本互不
// 依賴，避免跨功能耦合）。
function buildSteps(ctx: Ctx, issue: { id: string }) {
  const { hotfix, pm, supervisor, rdTeam, rdMember, rdLead, qaTeam, qaMember, qaLead, opTeam, opMember, opLead } = ctx;
  const s = hotfix.stageIds;
  return [
    async () => {
      const t = await findTransition(hotfix.version.id, s.draft, "submit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW_SUBMIT" });
    },
    async () => {
      const approval = await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: supervisor.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingBusinessApproval, "businessApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
    async () => {
      await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: rdTeam.id, actorId: supervisor.id, reasonCode: "PREVIEW_ASSIGN_RD" });
      const assignT = await findTransition(hotfix.version.id, s.pendingRdTriage, "rdAssign");
      await executeIssueTransition({ issueId: issue.id, transitionId: assignT.id, actorId: supervisor.id, reasonCode: "PREVIEW" });
      const claimT = await findTransition(hotfix.version.id, s.pendingRdClaim, "rdClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: claimT.id, actorId: rdMember.id, reasonCode: "PREVIEW" });
    },
    // 3: rdInProgress -> pendingRdLeadApproval（先填欄位＋風險檢核，再提交）
    async () => {
      await prisma.issueFieldValue.create({ data: { issueId: issue.id, fieldKey: "rdFixVersion", fieldLabel: "修正版本", fieldValue: "v1.0.0-preview" } });
      await answerAllRiskChecks(issue.id, "pendingRdLeadApproval", rdMember.id, "NO");
      const t = await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: rdMember.id, reasonCode: "PREVIEW" });
    },
    async () => {
      const approval = await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: rdLead.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: rdLead.id, reasonCode: "PREVIEW" });
    },
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
      await answerAllRiskChecks(issue.id, "pendingQaLeadApproval", qaMember.id, "NO");
      const t = await findTransition(hotfix.version.id, s.qaInProgress, "qaSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: qaMember.id, reasonCode: "PREVIEW" });
    },
    async () => {
      const approval = await findActiveApproval(issue.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: qaLead.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingQaLeadApproval, "qaLeadApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: qaLead.id, reasonCode: "PREVIEW" });
    },
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
      await answerAllRiskChecks(issue.id, "pendingDeploymentApproval", opMember.id, "NO");
      const t = await findTransition(hotfix.version.id, s.opPreparing, "opSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: opMember.id, reasonCode: "PREVIEW" });
    },
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
    async () => {
      const t = await findTransition(hotfix.version.id, s.opCompleted, "reporterConfirmOpen");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
    // 13: pendingReporterConfirmation -> reporterConfirming
    async () => {
      const t = await findTransition(hotfix.version.id, s.pendingReporterConfirmation, "reporterClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
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

async function main() {
  console.log("=== 建立 Hotfix 操作畫面 Preview／Smoke 展示資料 ===");

  console.log("[1/3] 建立 RD／QA／OP 團隊與人員、發布 Hotfix v1 流程...");
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

  console.log("[2/3] 建立展示用 Hotfix 案件（涵蓋操作畫面需要的各種狀態）...");

  const rdFixing = await createHotfixIssue("RD-FIX", "登入頁面驗證碼顯示異常", ctx);
  await advanceTo(ctx, rdFixing, 2); // RD 修正中

  const rdSelfTest = await createHotfixIssue("RD-SELFTEST", "付款金額計算錯誤", ctx);
  await advanceTo(ctx, rdSelfTest, 3); // 待 RD 主管核准（RD 自測 bucket）

  const qaVerify = await createHotfixIssue("QA-VERIFY", "報表匯出格式錯誤", ctx);
  await advanceTo(ctx, qaVerify, 5); // QA 驗證中

  const qaRelease = await createHotfixIssue("QA-RELEASE", "會員點數異動未同步", ctx);
  await advanceTo(ctx, qaRelease, 6); // 待 QA 主管核准（QA 放行確認）

  const opDeploying = await createHotfixIssue("OP-DEPLOY", "推播通知延遲逾時", ctx);
  await advanceTo(ctx, opDeploying, 10); // OP 部署中

  const confirming = await createHotfixIssue("PROD-CONFIRM", "客服工單自動轉派失敗", ctx);
  await advanceTo(ctx, confirming, 13); // 正式環境確認中

  const returned = await createHotfixIssue("RETURNED", "庫存扣減出現負值", ctx);
  await advanceTo(ctx, returned, 3); // 先到待 RD 主管核准
  {
    const approval = await findActiveApproval(returned.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: rdLead.id, decision: "REJECTED", decisionReasonCode: "NEEDS_MORE_WORK" });
    const rejectT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingRdLeadApproval, "rdLeadReject");
    await returnIssueToStage({ issueId: returned.id, transitionId: rejectT.id, actorId: rdLead.id, reasonCode: "NEEDS_MORE_WORK" });
  }
  // 結束時停在 rdInProgress，且歷程上有一筆 RETURNED——「已退回」展示案例。

  const riskYes = await createHotfixIssue("RISK-YES", "客戶資料匯出權限異常", ctx);
  await advanceTo(ctx, riskYes, 2); // RD 修正中
  await prisma.issueFieldValue.create({ data: { issueId: riskYes.id, fieldKey: "rdFixVersion", fieldLabel: "修正版本", fieldValue: "v1.0.1-preview" } });
  {
    const { getRiskCheckTemplate } = await import("../src/lib/riskCheckTemplates");
    const template = getRiskCheckTemplate("pendingRdLeadApproval")!;
    for (const item of template) {
      const answer = item.checkKey === "involvesSensitiveOrPersonalData" ? "YES" : "NO";
      await submitStageRiskCheckAnswer({ issueId: riskYes.id, stageKey: "pendingRdLeadApproval", checkKey: item.checkKey, answer, detail: answer === "YES" ? "涉及個資匯出，需資安複核" : undefined, actorId: rdMember.id });
    }
  }
  // 停在 rdInProgress，風險檢核已全數填答且其中一項為「是（有風險）」——「有風險」展示案例。

  const riskUnknown = await createHotfixIssue("RISK-UNKNOWN", "第三方金流介接逾時", ctx);
  await advanceTo(ctx, riskUnknown, 5); // QA 驗證中
  await prisma.issueFieldValue.create({ data: { issueId: riskUnknown.id, fieldKey: "qaTestResult", fieldLabel: "QA 測試結果", fieldValue: "部分通過" } });
  {
    const { getRiskCheckTemplate } = await import("../src/lib/riskCheckTemplates");
    const template = getRiskCheckTemplate("pendingQaLeadApproval")!;
    for (const item of template) {
      const answer = item.checkKey === "hasUnknownRisk" ? "UNKNOWN" : "NO";
      await submitStageRiskCheckAnswer({ issueId: riskUnknown.id, stageKey: "pendingQaLeadApproval", checkKey: item.checkKey, answer, detail: answer === "UNKNOWN" ? "待確認是否影響對帳作業" : undefined, actorId: qaMember.id });
    }
  }
  // 停在 qaInProgress，其中一項風險檢核答案為「不確定」且尚未釐清——「風險待釐清」展示案例。

  const cancelled = await createHotfixIssue("CANCELLED", "誤植的緊急需求", ctx);
  const cancelT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "cancelDraft");
  await cancelIssueWorkflow({ issueId: cancelled.id, transitionId: cancelT.id, actorId: admin.id, reasonCode: "PREVIEW_CANCEL" });

  const completed = await createHotfixIssue("COMPLETED", "首頁圖片載入逾時", ctx);
  await advanceTo(ctx, completed, 14); // 走完全程，結案（COMPLETED）——「已完成，不可再操作」展示案例。

  console.log("[3/3] 完成。");
  console.log(`  RD 修正中：${rdFixing.issueKey}`);
  console.log(`  待 RD 主管核准（RD 自測）：${rdSelfTest.issueKey}`);
  console.log(`  QA 驗證中：${qaVerify.issueKey}`);
  console.log(`  待 QA 主管核准（QA 放行確認）：${qaRelease.issueKey}`);
  console.log(`  OP 部署中：${opDeploying.issueKey}`);
  console.log(`  正式環境確認中：${confirming.issueKey}`);
  console.log(`  已退回（現停 RD 修正中）：${returned.issueKey}`);
  console.log(`  有風險（現停 RD 修正中，待提交）：${riskYes.issueKey}`);
  console.log(`  風險待釐清（現停 QA 驗證中，待提交）：${riskUnknown.issueKey}`);
  console.log(`  已取消：${cancelled.issueKey}`);
  console.log(`  已完成（不可再操作）：${completed.issueKey}`);
  console.log("");
  console.log("  可登入測試角色（email／密碼皆比照既有 login 流程，以下為姓名）：");
  console.log(`    PM／開單人：${pm.id === pm.id ? "PreviewPM" : ""}`);
  console.log("    RD 執行人：PreviewRdMember／RD 主管：PreviewRdLead");
  console.log("    QA 執行人：PreviewQaMember／QA 主管：PreviewQaLead");
  console.log("    OP 執行人：PreviewOpMember／OP 主管：PreviewOpLead");
  console.log("    Admin：PreviewAdmin");
}

main()
  .catch((err) => {
    console.error("建立 Hotfix UI Preview 展示資料時發生錯誤：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
