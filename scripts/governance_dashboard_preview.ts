// 治理儀表板 Preview／Smoke 展示資料建置腳本。
//
// 目的：正式 dev.db 目前沒有新版 Workflow runtime 資料（Hotfix v1 尚未實際發布給正式
// 案件使用），無法用來展示收斂後的治理儀表板畫面，也無法驗證「新版案件為 0」以外的
// 情境。本腳本在一個獨立、可重複產生的 scratch DB 上建立完整展示資料：發布 Hotfix v1
// WorkflowVersion，並透過真正的執行引擎（M2-B workflowExecutionService，而非直接寫
// raw row）把數筆 Issue 推進到各種需要展示的狀態（RD 修正中／待 RD 主管核准／QA 驗證
// 中／待 QA 主管核准／OP 部署準備中／開單人確認中／有風險／風險待確認／停留過久／
// 重複退回／已取消），並額外發布 RCA／RiskException 兩個簡化 WorkflowVersion，各建立
// 一筆進行中案件，證明治理儀表板對 issueType 是通用的、不是寫死給 Hotfix 專用；外加
// 原有舊制案件（prisma/seed.ts，19 筆，維持舊制不變、不啟動新版 Workflow）。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 使用方式（單一指令，DB 路徑固定在本 worktree 下、已由頂層 .gitignore 的 `*.db`
// 規則排除，不會被 commit）：
//   npm run governance:preview        # 重建 preview DB 並灌入展示資料
//   npm run dev:governance-preview    # 啟動 dev server 指向該 DB，開 http://localhost:3000/governance
//
// 直接執行本檔（略過上面兩個 npm script）：
//   touch prisma/governance-preview.db
//   DATABASE_URL="file:./governance-preview.db" npx prisma migrate deploy
//   DATABASE_URL="file:./governance-preview.db" node_modules/.bin/tsx scripts/governance_dashboard_preview.ts
//
// 注意：Prisma（CLI 與執行期 Client 皆同）對 sqlite 的相對路徑一律以 schema.prisma
// 所在目錄（prisma/）為基準解析，不是以執行指令當下的工作目錄為基準——因此上面這裡
// 是 "file:./governance-preview.db"，不是 "file:./prisma/governance-preview.db"
// （後者會被誤解析成 prisma/prisma/governance-preview.db）。

import "./lib/assertSafeTestDatabase";

import { execSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { decideApprovalRecord } from "../src/lib/approvalService";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { createWorkflowDefinition, createDraftVersion, addWorkflowStage, addWorkflowTransition, publishWorkflowVersion } from "../src/lib/workflowService";
import {
  startIssueWorkflow,
  executeIssueTransition,
  returnIssueToStage,
  cancelIssueWorkflow,
  setIssueAssignedTeamAtTriage,
} from "../src/lib/workflowExecutionService";

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
  const { getRiskCheckTemplate } = await import("../src/lib/riskCheckTemplates");
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

// Category B 展示案件：完全不呼叫 startIssueWorkflow，直接以 legacy 模型建立
// （workflowVersionId／currentWorkflowStageId 皆為 null，workflowStatus 為該
// issueType 在 src/lib/workflow.ts 既有 WORKFLOW_STEPS 的某個未結案步驟）。這正是
// 「已建立 Hotfix 工單，但治理儀表板 Hotfix 數量仍顯示 0」根因修正對應的真實案例：
// 該 issueType 目前沒有已發布的新版 Workflow 可供自動啟動時，工單一律長這樣。
async function createPreWorkflowIssue(key: string, title: string, issueType: string, workflowStatus: string, createdDaysAgo = 0) {
  return prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-${key}`,
      issueType,
      title,
      workflowStatus,
      createdAt: new Date(Date.now() - createdDaysAgo * 86_400_000),
    },
  });
}

// 供 RCA／RiskException 展示用的極簡雙關卡流程（open→closed，1 條 FORWARD），
// 只是要證明治理儀表板對 issueType 是通用讀取、不是寫死 Hotfix 專屬邏輯——不需要
// Hotfix v1 那種 20 關卡的完整度。
async function buildSimpleWorkflow(issueType: string, name: string, actorId: string) {
  const definition = await createWorkflowDefinition({
    key: `${RUN_TAG}-simple-${issueType.toLowerCase()}`,
    name,
    description: `Preview 展示用最小流程（${issueType}）`,
    issueType,
    actorId,
    reasonCode: "PREVIEW_BUILD_SIMPLE",
  });
  const version = await createDraftVersion({ workflowDefinitionId: definition.id, actorId, reasonCode: "PREVIEW_BUILD_SIMPLE" });
  const openStage = await addWorkflowStage({
    workflowVersionId: version.id,
    stageKey: "open",
    label: "處理中",
    stageType: "WORK",
    sortOrder: 0,
    isStart: true,
    isEnd: false,
    actorId,
    reasonCode: "PREVIEW_BUILD_SIMPLE",
  });
  const closedStage = await addWorkflowStage({
    workflowVersionId: version.id,
    stageKey: "closed",
    label: "結案",
    stageType: "CLOSURE",
    sortOrder: 1,
    isStart: false,
    isEnd: true,
    terminalOutcome: "COMPLETED",
    actorId,
    reasonCode: "PREVIEW_BUILD_SIMPLE",
  });
  await addWorkflowTransition({
    workflowVersionId: version.id,
    fromStageId: openStage.id,
    toStageId: closedStage.id,
    transitionType: "FORWARD",
    actionKey: "close",
    label: "結案",
    requireReason: false,
    actorId,
    reasonCode: "PREVIEW_BUILD_SIMPLE",
  });
  const published = await publishWorkflowVersion({ versionId: version.id, actorId, reasonCode: "PREVIEW_BUILD_SIMPLE" });
  return { definition, version: published, openStageId: openStage.id };
}

async function createSimpleInProgressIssue(key: string, title: string, issueType: string, workflowVersionId: string, adminId: string) {
  const issue = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-${key}`, issueType, title, workflowStatus: "n/a" },
  });
  await startIssueWorkflow({ issueId: issue.id, workflowVersionId, actorId: adminId, reasonCode: "PREVIEW_START" });
  return issue;
}

async function main() {
  console.log("=== 建立治理儀表板 Preview／Smoke 展示資料 ===");

  console.log("[1/4] 套用 baseline seed（原有 7 位使用者＋19 筆舊制案件，維持舊制不變）...");
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

  console.log("[3/4] 建立展示用 Hotfix 案件（涵蓋各種狀態）＋ RCA／RiskException 案件（證明多 issueType 通用）...");

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

  const completed = await createHotfixIssue("DONE-01", "首頁圖片載入逾時", ctx);
  await advanceTo(ctx, completed, 14); // 走完全程，結案（COMPLETED）

  // ---- Category B：尚未啟動新版 Workflow、但依 legacy 語意尚未結案的 Hotfix
  // （根因修正對應案例，見 createPreWorkflowIssue 說明），同時作為第二筆「停留超過
  // 7 天」案例（dwellDays 依 Issue.createdAt 估算，見 queries.ts）。 ----
  const preWorkflowHotfix = await createPreWorkflowIssue("PREWF-01", "客服回報付款頁面偶發白畫面", "Hotfix", "opened", 9);

  // ---- RCA（2 件）／RiskException（2 件）：各發布一個最小流程＋進行中案件，證明
  // 治理儀表板對 issueType 是通用讀取、不是寫死 Hotfix 專屬邏輯 ----
  const rcaWorkflow = await buildSimpleWorkflow("RCA", "RCA 根因分析流程（Preview）", admin.id);
  const rcaIssue1 = await createSimpleInProgressIssue("RCA-01", "登入逾時根因分析", "RCA", rcaWorkflow.version.id, admin.id);
  const rcaIssue2 = await createPreWorkflowIssue("RCA-02", "批次作業異常中斷根因分析", "RCA", "analyzing");

  const riskExceptionWorkflow = await buildSimpleWorkflow("RiskException", "風險例外處理流程（Preview）", admin.id);
  const riskExceptionIssue1 = await createSimpleInProgressIssue(
    "RISKEXC-01",
    "第三方 SDK 暫時使用過期憑證風險例外申請",
    "RiskException",
    riskExceptionWorkflow.version.id,
    admin.id,
  );
  const riskExceptionIssue2 = await createPreWorkflowIssue("RISKEXC-02", "舊版 TLS 協定暫時保留風險例外", "RiskException", "pendingApproval");

  // ---- 事件通報（3 件）：目前沒有已發布的 Incident 新版 Workflow，一律是
  // Category B，「目前階段」改用既有 legacy 模型顯示標籤（見
  // queries.ts preWorkflowStatusLabel）。 ----
  const incident1 = await createPreWorkflowIssue("INC-P01", "核心交易 API 回應時間異常升高", "Incident", "initialResponse");
  const incident2 = await createPreWorkflowIssue("INC-P02", "會員中心登入失敗率上升", "Incident", "reported");
  const incident3 = await createPreWorkflowIssue("INC-P03", "報表批次延遲影響對帳", "Incident", "rcaDecision");

  console.log("[4/4] 完成。");
  console.log(`  RD 修正中：${rd1.issueKey}, ${rd2.issueKey}, ${riskYes.issueKey}（有風險）, ${stale.issueKey}（停留過久）`);
  console.log(`  待 RD 主管核准：${rdApproval.issueKey}`);
  console.log(`  QA 驗證中：${qaVerify.issueKey}, ${riskUnknown.issueKey}（風險待確認）`);
  console.log(`  待 QA 主管核准（QA 放行）：${qaRelease.issueKey}`);
  console.log(`  OP 部署準備中（待 OP 上版）：${opDeploy.issueKey}`);
  console.log(`  開單人確認中（正式環境確認）：${confirming.issueKey}`);
  console.log(`  重複退回（現停 RD 修正中）：${repeatedReturn.issueKey}`);
  console.log(`  已取消：${cancelled.issueKey}`);
  console.log(`  已完成：${completed.issueKey}`);
  console.log(`  尚未啟動新版 Workflow 但尚未結案（開單／待處理＋停留過久）：${preWorkflowHotfix.issueKey}`);
  console.log(`  RCA 進行中：${rcaIssue1.issueKey}, ${rcaIssue2.issueKey}`);
  console.log(`  RiskException 進行中：${riskExceptionIssue1.issueKey}, ${riskExceptionIssue2.issueKey}`);
  console.log(`  事件通報處理中：${incident1.issueKey}, ${incident2.issueKey}, ${incident3.issueKey}`);
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
