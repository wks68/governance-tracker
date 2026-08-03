// 本輪三項修正的 targeted verify：
//   A. OP 上版部署單移除三個重複欄位（預計操作時間／操作造成的預計影響時間（分鐘）／影響範圍）
//   B. 已登入使用者存取 /login 的 Server Redirect Guard（靜態檢查；實際行為另見 Browser script）
//   C. OP 執行人完成上版後，責任正確移交 OP 主管，OP 主管確認後正確移交原申請人
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 執行方式：
//   touch /path/to/scratch.db && DATABASE_URL="file:/path/to/scratch.db" npx prisma migrate deploy
//   DATABASE_URL="file:/path/to/scratch.db" npx tsx scripts/hotfix_op_handoff_login_guard-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { createIssueForActor } from "../src/lib/issueCreation";
import { decideApprovalRecord } from "../src/lib/approvalService";
import {
  executeIssueTransition,
  claimIssueForTeam,
  assignIssueExecutor,
  submitStageRiskCheckAnswer,
  getIssueWorkflowRuntime,
  evaluateCurrentActorTask,
} from "../src/lib/workflowExecutionService";
import { saveExecutionFieldValues, OP_DEPLOY_FIELDS, validateExecutionSubmission } from "../src/lib/hotfix-ui/executionFields";
import { getRiskCheckTemplate } from "../src/lib/riskCheckTemplates";
import { listActionableTasksForActor } from "../src/lib/workflow-execution/actionabilityService";
import { listWorkflowTaskNotificationsForActor } from "../src/lib/workflow-execution/notificationService";
import { resolveHotfixListAction } from "../src/lib/hotfix-list/viewModel";
import { saveClosureSummary } from "../src/lib/hotfix-ui/closureService";
import { setTeamDomain } from "../src/lib/team-applicant/teamManagementService";
import type { TeamDomain } from "../src/lib/constants";

const RUN = `ophg-${Date.now().toString(36)}`;
let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`); }
}
function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

async function createUser(name: string, role: string) {
  const user = await prisma.user.create({ data: { name: `${RUN}-${name}`, email: `${RUN}-${name}@example.invalid`, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}
async function addMember(teamId: string, userId: string, membershipRole: "LEAD" | "MEMBER") {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
}
async function createTeam(name: string, domain: TeamDomain, actorId: string) {
  const team = await prisma.team.create({ data: { name: `${RUN}-${name}` } });
  await setTeamDomain({ teamId: team.id, domain, actorId, reasonCode: "V" });
  return team;
}
async function findTransition(versionId: string, fromStageId: string, actionKey: string) {
  return prisma.workflowTransition.findFirstOrThrow({ where: { workflowVersionId: versionId, fromStageId, actionKey } });
}
async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  return prisma.approvalRecord.findFirstOrThrow({ where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" } });
}
async function answerAll(issueId: string, stageKey: string, actorId: string) {
  for (const item of getRiskCheckTemplate(stageKey) ?? []) {
    await submitStageRiskCheckAnswer({ issueId, stageKey, checkKey: item.checkKey, answer: "NO", actorId });
  }
}

async function main() {
  console.log("\n=== A. OP 上版部署單移除三個重複欄位 ===");
  const opFormSource = source("src/components/hotfix-nine-stage/OpDeploymentForms.tsx");
  check("[A1] OP_DEPLOY_FIELDS 不再包含三個重複欄位", !OP_DEPLOY_FIELDS.some((f) => ["opOperationPlannedAt", "opOperationImpactMinutes", "opOperationImpactScope"].includes(f.key)));
  check("[A2] 「實際操作標的」仍保留", OP_DEPLOY_FIELDS.some((f) => f.key === "opOperationTargets"));
  check("[A3] 表單不再 Render 三個重複欄位的中文標籤", !opFormSource.includes("預計操作時間") && !opFormSource.includes("操作造成的預計影響時間") && !/<label[^>]*>影響範圍/.test(opFormSource));
  check("[A4] 表單重置邏輯不再殘留三個欄位的空白預設值", !opFormSource.includes("opOperationPlannedAt") && !opFormSource.includes("opOperationImpactMinutes") && !opFormSource.includes("opOperationImpactScope"));
  check(
    "[A5] Server 驗證：不含三個重複欄位的上版計畫仍可正常送出（其餘必要欄位齊全）",
    validateExecutionSubmission("opPreparing", {
      opDeployEnvironment: "Production",
      opDeployPlannedAt: "2026-08-08T22:00",
      opImpactDurationMode: "無",
      opAnnouncementRequired: "否",
      opServiceOperationRequired: "是",
      opOperationTypes: JSON.stringify(["滾動重啟"]),
      opComponentTypes: JSON.stringify(["應用程式服務"]),
      opOperationTargets: "MyDMS Web Pod",
      opExpectedImpacts: JSON.stringify(["服務短暫中斷"]),
      opDeploySteps: "steps",
      opRollbackTrigger: "trigger",
      opRollbackPlan: "plan",
      opRollbackUnavailableMode: "不適用",
      opMonitoringMethod: "不適用",
      opMonitoringNotApplicableReason: "na",
    }).length === 0,
  );

  console.log("\n=== B. /login 已登入 Server Redirect Guard（靜態檢查） ===");
  const loginPageSource = source("src/app/login/page.tsx");
  check("[B1] 使用既有 getCurrentUser 解析 Session，未另建第二套判斷", loginPageSource.includes("getCurrentUser"));
  check("[B2] 已登入時在 Render 登入名單前呼叫 redirect()", /await getCurrentUser\(\)[\s\S]*if \(currentUser\) \{\s*redirect\(/.test(loginPageSource));
  check("[B3] 未使用 useEffect／setTimeout／window.location／suppressHydrationWarning 掩蓋", !/useEffect|setTimeout|window\.location|suppressHydrationWarning/.test(loginPageSource));
  check("[B4] next 參數僅接受站內相對路徑，防止 Open Redirect", loginPageSource.includes('!value.startsWith("/")') && loginPageSource.includes('value.startsWith("//")') && loginPageSource.includes('value.includes("://")'));
  check("[B5] 無有效 next 時回正式首頁 /governance", loginPageSource.includes('DEFAULT_POST_LOGIN_ROUTE = "/governance"'));
  check("[B6] 頁面仍為 force-dynamic，不會被靜態快取成登入名單", loginPageSource.includes('export const dynamic = "force-dynamic"'));

  console.log("\n=== C. OP 第 7 → 第 8 → 第 9 關責任交接 ===");
  const admin = await createUser("Admin", "Admin");
  const selena = await createUser("Reporter", "QA");
  const supervisor = await createUser("Supervisor", "DMS主管");
  await prisma.userSupervisorAssignment.create({ data: { userId: selena.id, supervisorUserId: supervisor.id, isActive: true, isPrimary: true, validFrom: new Date(Date.now() - 86_400_000), createdByUserId: admin.id } });
  const qaTeam = await createTeam("QA", "QA", admin.id);
  await addMember(qaTeam.id, selena.id, "MEMBER");
  const rdTeam = await createTeam("RD", "RD", admin.id);
  const rdLead = await createUser("RdLead", "RD");
  await addMember(rdTeam.id, rdLead.id, "LEAD");
  const rdMember = await createUser("RdMember", "RD");
  await addMember(rdTeam.id, rdMember.id, "MEMBER");
  const qaLead = await createUser("QaLead", "QA");
  await addMember(qaTeam.id, qaLead.id, "LEAD");
  const opTeam = await createTeam("OP", "OP", admin.id);
  const opLead = await createUser("OpLead", "OP");
  await addMember(opTeam.id, opLead.id, "LEAD");
  const opMember = await createUser("OpMember", "OP");
  await addMember(opTeam.id, opMember.id, "MEMBER");
  const outsiderOpLead = await createUser("OutsiderOpLead", "OP");

  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "OP_HANDOFF_VERIFY", keySuffix: RUN });
  const s = hotfix.stageIds;

  const fd = new FormData();
  fd.set("issueType", "Hotfix"); fd.set("title", "OP handoff verify"); fd.set("description", "verify");
  fd.set("systemName", "MyDMS"); fd.set("environment", "Production"); fd.set("riskLevel", "中");
  fd.set("dueDate", "2026-12-31"); fd.set("hotfixPriority", "HIGH"); fd.set("teamId", qaTeam.id); fd.set("applicantId", selena.id);
  const selenaUser = await prisma.user.findUniqueOrThrow({ where: { id: selena.id } });
  const issue = await createIssueForActor(selenaUser, fd, { submitForApproval: true });

  await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval")).id, actorUserId: supervisor.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.pendingBusinessApproval, "businessApprove")).id, actorId: supervisor.id, reasonCode: "V" });

  await claimIssueForTeam({ issueId: issue.id, teamId: rdTeam.id, actorId: rdLead.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: issue.id, executorUserId: rdMember.id, actorId: rdLead.id, reasonCode: "V" });
  await saveExecutionFieldValues({ issueId: issue.id, actorId: rdMember.id, values: { rdFixVersion: "v1", rdFixDescription: "x", rdSelfTestResult: "y", rdImpactScope: "z" } });
  await answerAll(issue.id, "pendingRdLeadApproval", rdMember.id);
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit")).id, actorId: rdMember.id, reasonCode: "V" });
  await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval")).id, actorUserId: rdLead.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadApprove")).id, actorId: rdLead.id, reasonCode: "V" });

  await claimIssueForTeam({ issueId: issue.id, teamId: qaTeam.id, actorId: qaLead.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: issue.id, executorUserId: selena.id, actorId: qaLead.id, reasonCode: "V" });
  await saveExecutionFieldValues({ issueId: issue.id, actorId: selena.id, values: { qaTestScope: "x", qaTestEnvironment: "y", qaTestResult: "驗證通過" } });
  await answerAll(issue.id, "pendingQaLeadApproval", selena.id);
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.qaInProgress, "qaSubmit")).id, actorId: selena.id, reasonCode: "V" });
  await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval")).id, actorUserId: qaLead.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.pendingQaLeadApproval, "qaLeadApprove")).id, actorId: qaLead.id, reasonCode: "V" });

  await claimIssueForTeam({ issueId: issue.id, teamId: opTeam.id, actorId: opLead.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: issue.id, executorUserId: opMember.id, actorId: opLead.id, reasonCode: "V" });
  await saveExecutionFieldValues({
    issueId: issue.id, actorId: opMember.id,
    values: { opDeployEnvironment: "Production", opImpactDurationMode: "無", opAnnouncementRequired: "否", opServiceOperationRequired: "否", opExpectedImpacts: JSON.stringify(["無明顯影響"]), opNoImpactJustification: "x", opDeploySteps: "a", opRollbackTrigger: "b", opRollbackPlan: "c", opRollbackUnavailableMode: "不適用", opMonitoringMethod: "不適用", opMonitoringNotApplicableReason: "na" },
  });
  await answerAll(issue.id, "pendingDeploymentApproval", opMember.id);
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.opPreparing, "opSubmit")).id, actorId: opMember.id, reasonCode: "V" });
  await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval")).id, actorUserId: opLead.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.pendingDeploymentApproval, "opLeadApprove")).id, actorId: opLead.id, reasonCode: "V" });

  // ---- Min 完成正式環境部署，第 7 → 第 8 關 ----
  const auditCountBeforeComplete = await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue.id } });
  const historyCountBeforeComplete = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue.id } });
  await saveExecutionFieldValues({ issueId: issue.id, actorId: opMember.id, values: { opActualStartedAt: "2026-08-01T02:00", opActualCompletedAt: "2026-08-01T02:10", opDeployResult: "完成", opIncidentStatus: "無", opRollbackActivated: "否", opPostMonitoringResult: "正常" } });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.opDeploying, "opDeployComplete")).id, actorId: opMember.id, reasonCode: "V" });

  const runtimeAtOpCompleted = await getIssueWorkflowRuntime(issue.id, admin.id);
  check("[C1] Min 完成 OP 上版後 Stage 進入第 8 關 opCompleted", runtimeAtOpCompleted.onVersionedWorkflow && runtimeAtOpCompleted.currentStage.stageKey === "opCompleted");

  const minTask = await evaluateCurrentActorTask(issue.id, opMember.id);
  check("[C2] 第 7 關責任不再 actionable：Min 不再取得 PROCESS／APPROVE", minTask?.action === "VIEW_ONLY");
  check("[C2b] Min 不再看到「等待角色：維運／Min」，改為主管角色", minTask?.waitingRoleLabel === "OP 主管");

  const opLeadTask = await evaluateCurrentActorTask(issue.id, opLead.id);
  check("[C3] 正式 OP 主管取得 APPROVE", opLeadTask?.action === "APPROVE");
  check("[C3b] 正式 OP 主管 isMineToApprove 為 true", opLeadTask?.isMineToApprove === true);

  const opCompletedApprovals = await prisma.approvalRecord.findMany({ where: { issueId: issue.id, relatedStageKey: "opCompleted" } });
  check("[C4] 僅建立一筆 opCompleted 的 PENDING ApprovalRecord", opCompletedApprovals.length === 1 && opCompletedApprovals[0].decision === "PENDING");
  check("[C4b] ApprovalRecord approverTeamId 指向正式 OP 團隊", opCompletedApprovals[0]?.approverTeamId === opTeam.id);

  const outsiderTask = await evaluateCurrentActorTask(issue.id, outsiderOpLead.id);
  check("[C4c] 非正式主管（同域但無 active 主管關係的 OP 成員）不得取得 APPROVE", outsiderTask?.action !== "APPROVE");

  const opLeadTasks = await listActionableTasksForActor(opLead.id);
  const opLeadHasThis = opLeadTasks.some((t) => t.issueId === issue.id);
  check("[C5] OP 主管『我的待辦』出現此筆", opLeadHasThis);
  const opLeadNotifications = await listWorkflowTaskNotificationsForActor(opLead.id);
  check("[C6] OP 主管 Bell 顯示此待辦", opLeadNotifications.some((n) => n.issueId === issue.id));
  const opLeadListAction = resolveHotfixListAction({ actionKind: opLeadTask?.action, actionHref: "#", detailHref: "#", terminal: false });
  check("[C7] OP 主管清單顯示紫色「待核准」", opLeadListAction.variant === "pending-approval");

  const minTasks = await listActionableTasksForActor(opMember.id);
  check("[C8] Min 的『我的待辦』不再包含此筆", !minTasks.some((t) => t.issueId === issue.id));
  const minNotifications = await listWorkflowTaskNotificationsForActor(opMember.id);
  check("[C9] Min 的 Bell 不再包含此筆", !minNotifications.some((n) => n.issueId === issue.id));
  const minListAction = resolveHotfixListAction({ actionKind: minTask?.action, actionHref: "#", detailHref: "#", terminal: false });
  check("[C10] Min 清單顯示為「檢視」", minListAction.variant === "view");

  check("[C11] CurrentHotfixFlowCard 依據回傳目前待辦「OP 上版結果確認中」", minTask?.businessStatusLabel === "OP 上版結果確認中");

  // ---- 重複 Submit 不建立重複 Approval／History／Notification ----
  const runtimeRetry = await getIssueWorkflowRuntime(issue.id, opMember.id);
  const forwardAllowedForMin = runtimeRetry.onVersionedWorkflow ? runtimeRetry.availableTransitions.some((t) => t.transition.transitionType === "FORWARD" && t.allowed) : false;
  check("[C12] 已完成第 7 關後，Min 對任何正向 Stage Transition 都不再具備 allowed 資格", !forwardAllowedForMin);
  const opCompletedApprovalsAfterRetryCheck = await prisma.approvalRecord.findMany({ where: { issueId: issue.id, relatedStageKey: "opCompleted" } });
  check("[C12b] 重複檢查後仍僅一筆 opCompleted ApprovalRecord（Idempotent）", opCompletedApprovalsAfterRetryCheck.length === 1);

  const auditCountAfterComplete = await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue.id } });
  const historyCountAfterComplete = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue.id } });
  check("[C13] 第 7→8 關新增了 History 與 Audit 紀錄（未刪除原始資料，只新增）", historyCountAfterComplete > historyCountBeforeComplete && auditCountAfterComplete > auditCountBeforeComplete);

  // ---- 找不到唯一正式 OP 主管時必須 fail closed，不留下半完成 Stage／Approval ----
  {
    const fd2 = new FormData();
    fd2.set("issueType", "Hotfix"); fd2.set("title", "OP handoff fail-closed verify"); fd2.set("description", "verify");
    fd2.set("systemName", "MyDMS"); fd2.set("environment", "Production"); fd2.set("riskLevel", "中");
    fd2.set("dueDate", "2026-12-31"); fd2.set("hotfixPriority", "HIGH"); fd2.set("teamId", qaTeam.id); fd2.set("applicantId", selena.id);
    const issue2 = await createIssueForActor(selenaUser, fd2, { submitForApproval: true });
    await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue2.id, "BUSINESS_APPROVAL", "pendingBusinessApproval")).id, actorUserId: supervisor.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue2.id, transitionId: (await findTransition(hotfix.version.id, s.pendingBusinessApproval, "businessApprove")).id, actorId: supervisor.id, reasonCode: "V" });
    await claimIssueForTeam({ issueId: issue2.id, teamId: rdTeam.id, actorId: rdLead.id, reasonCode: "V" });
    await assignIssueExecutor({ issueId: issue2.id, executorUserId: rdMember.id, actorId: rdLead.id, reasonCode: "V" });
    await saveExecutionFieldValues({ issueId: issue2.id, actorId: rdMember.id, values: { rdFixVersion: "v1", rdFixDescription: "x", rdSelfTestResult: "y", rdImpactScope: "z" } });
    await answerAll(issue2.id, "pendingRdLeadApproval", rdMember.id);
    await executeIssueTransition({ issueId: issue2.id, transitionId: (await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit")).id, actorId: rdMember.id, reasonCode: "V" });
    await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue2.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval")).id, actorUserId: rdLead.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue2.id, transitionId: (await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadApprove")).id, actorId: rdLead.id, reasonCode: "V" });
    await claimIssueForTeam({ issueId: issue2.id, teamId: qaTeam.id, actorId: qaLead.id, reasonCode: "V" });
    await assignIssueExecutor({ issueId: issue2.id, executorUserId: selena.id, actorId: qaLead.id, reasonCode: "V" });
    await saveExecutionFieldValues({ issueId: issue2.id, actorId: selena.id, values: { qaTestScope: "x", qaTestEnvironment: "y", qaTestResult: "驗證通過" } });
    await answerAll(issue2.id, "pendingQaLeadApproval", selena.id);
    await executeIssueTransition({ issueId: issue2.id, transitionId: (await findTransition(hotfix.version.id, s.qaInProgress, "qaSubmit")).id, actorId: selena.id, reasonCode: "V" });
    await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue2.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval")).id, actorUserId: qaLead.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue2.id, transitionId: (await findTransition(hotfix.version.id, s.pendingQaLeadApproval, "qaLeadApprove")).id, actorId: qaLead.id, reasonCode: "V" });
    await claimIssueForTeam({ issueId: issue2.id, teamId: opTeam.id, actorId: opLead.id, reasonCode: "V" });
    await assignIssueExecutor({ issueId: issue2.id, executorUserId: opMember.id, actorId: opLead.id, reasonCode: "V" });
    await saveExecutionFieldValues({
      issueId: issue2.id, actorId: opMember.id,
      values: { opDeployEnvironment: "Production", opImpactDurationMode: "無", opAnnouncementRequired: "否", opServiceOperationRequired: "否", opExpectedImpacts: JSON.stringify(["無明顯影響"]), opNoImpactJustification: "x", opDeploySteps: "a", opRollbackTrigger: "b", opRollbackPlan: "c", opRollbackUnavailableMode: "不適用", opMonitoringMethod: "不適用", opMonitoringNotApplicableReason: "na" },
    });
    await answerAll(issue2.id, "pendingDeploymentApproval", opMember.id);
    await executeIssueTransition({ issueId: issue2.id, transitionId: (await findTransition(hotfix.version.id, s.opPreparing, "opSubmit")).id, actorId: opMember.id, reasonCode: "V" });
    await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue2.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval")).id, actorUserId: opLead.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue2.id, transitionId: (await findTransition(hotfix.version.id, s.pendingDeploymentApproval, "opLeadApprove")).id, actorId: opLead.id, reasonCode: "V" });
    await saveExecutionFieldValues({ issueId: issue2.id, actorId: opMember.id, values: { opActualStartedAt: "2026-08-01T02:00", opActualCompletedAt: "2026-08-01T02:10", opDeployResult: "完成", opIncidentStatus: "無", opRollbackActivated: "否", opPostMonitoringResult: "正常" } });

    // 移除 OP 團隊唯一 LEAD 的 active 身分，模擬找不到正式 OP 主管。
    await prisma.teamMember.updateMany({ where: { teamId: opTeam.id, membershipRole: "LEAD" }, data: { isActive: false } });
    const historyBeforeFail = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue2.id } });
    const auditBeforeFail = await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue2.id } });

    let threw = false;
    try {
      await executeIssueTransition({ issueId: issue2.id, transitionId: (await findTransition(hotfix.version.id, s.opDeploying, "opDeployComplete")).id, actorId: opMember.id, reasonCode: "V" });
    } catch {
      threw = true;
    }
    check("[C14] 找不到唯一正式 OP 主管時，opDeployComplete 明確失敗（fail closed）", threw);
    const runtimeAfterFail = await getIssueWorkflowRuntime(issue2.id, admin.id);
    check("[C14b] 失敗後 Stage 仍停在 opDeploying，不留下無人負責的第 8 關", runtimeAfterFail.onVersionedWorkflow && runtimeAfterFail.currentStage.stageKey === "opDeploying");
    check("[C14c] 失敗後未建立 opCompleted 的 ApprovalRecord", (await prisma.approvalRecord.count({ where: { issueId: issue2.id, relatedStageKey: "opCompleted" } })) === 0);
    const historyAfterFail = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue2.id } });
    const auditAfterFail = await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue2.id } });
    check("[C14d] 失敗未留下半筆 Stage History 或 Audit（Transaction 完整 rollback）", historyAfterFail === historyBeforeFail && auditAfterFail === auditBeforeFail);
    const opMemberValuesAfterFail = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: issue2.id, fieldKey: "opDeployResult" } } });
    check("[C14e] Min 已填寫的部署結果資料未被清除，可重新提交", opMemberValuesAfterFail?.fieldValue === "完成");

    // 復原 LEAD 身分，供其餘回歸/未來重跑不受影響（僅此測試自建的 fixture）。
    await prisma.teamMember.updateMany({ where: { teamId: opTeam.id, membershipRole: "LEAD" }, data: { isActive: true } });
  }

  // ---- 第 8 → 第 9 關：OP 主管確認 ----
  await decideApprovalRecord({ approvalRecordId: opCompletedApprovals[0].id, actorUserId: opLead.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.opCompleted, "reporterConfirmOpen")).id, actorId: opLead.id, reasonCode: "V" });

  const runtimeAtReporterConfirm = await getIssueWorkflowRuntime(issue.id, admin.id);
  check("[C15] OP 主管確認後進入第 9 關 pendingReporterConfirmation", runtimeAtReporterConfirm.onVersionedWorkflow && runtimeAtReporterConfirm.currentStage.stageKey === "pendingReporterConfirmation");

  const opLeadTaskAfter = await evaluateCurrentActorTask(issue.id, opLead.id);
  check("[C15b] OP 主管待辦於確認後消失（不再 actionable）", opLeadTaskAfter?.action !== "APPROVE");

  const reporterTask = await evaluateCurrentActorTask(issue.id, selena.id);
  check("[C16] 原申請人取得第 9 關責任（CONFIRM_CLOSE）", reporterTask?.action === "CONFIRM_CLOSE");
  check("[C16b] 原申請人的等待角色顯示為「申請人」，非上一輪承接團隊 Lead", reporterTask?.waitingRoleLabel === "申請人");

  const minTaskAfterReporterStage = await evaluateCurrentActorTask(issue.id, opMember.id);
  check("[C16c] Min 不會在第 9 關重新取得責任", minTaskAfterReporterStage?.action !== "CONFIRM_CLOSE" && minTaskAfterReporterStage?.action !== "ASSIGN_MEMBER");

  const historyCountBeforeClose = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue.id } });
  await saveClosureSummary({ issueId: issue.id, actorId: selena.id, summary: "已確認上版成功，功能正常。", followUpNotes: "" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.pendingReporterConfirmation, "reporterClaim")).id, actorId: selena.id, reasonCode: "V" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, s.reporterConfirming, "reporterClose")).id, actorId: selena.id, reasonCode: "V" });
  const finalRuntime = await getIssueWorkflowRuntime(issue.id, admin.id);
  check("[C17] 原申請人確認結案後正式進入 closed（不得跳過或直接結案）", finalRuntime.onVersionedWorkflow && finalRuntime.currentStage.stageKey === "closed");
  const historyCountAfterClose = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue.id } });
  check("[C17b] 結案未刪除既有 History，只新增", historyCountAfterClose > historyCountBeforeClose);

  check("[C18] 全程未建立任何額外 Issue（未以子單／子任務作為核准入口）", (await prisma.issue.count({ where: { title: { contains: "OP handoff verify" } } })) === 1);

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
