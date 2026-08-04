// Incident 事件通報流程新增：承接／分級／指派處理單位／技術主管接單指派／初步處置／
// 恢復結果確認／RCA 啟動判定／事件結案 的寫入服務層。
//
// 沿用既有 M2-B 執行引擎（executeIssueTransitionInTx／returnIssueToStage／
// requireActorEligibleForStage／IssueFieldValue／AuditLog），不建立第二套流程引擎。
//
// 責任團隊分兩種解析方式：
//   1. 事件受理窗口（pendingIntake／pendingClassification／pendingUnitAssignment／
//      pendingRecoveryConfirmation／pendingClosureConfirmation）：責任團隊全程就是
//      Issue.assignedTeamId（受理窗口接單時寫入、全程未再變動），沿用既有
//      requiredMembershipRole／requireActorEligibleForStage 通用機制。
//   2. 技術處理團隊（pendingTechLeadClaim／inHandling）與資安推動小組
//      （pendingRcaDecision）：責任團隊與 Issue.assignedTeamId 無關（後者全程是受理窗口），
//      因此這兩個關卡的 WorkflowStage.requiredMembershipRole 刻意留空，改由本檔案自行解析
//      責任團隊／執行人並在寫入前顯式檢查資格——比照 assignmentService.ts 對「指派執行人」
//      這類非 assignedTeamId 資格判斷的既有做法。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { getIssueOrThrow, getStageOrThrow, assertReasonCodeProvided, throwIfInvalid } from "./validation";
import { requireActorEligibleForStage, requireExecutionCapability } from "./access";
import { executeIssueTransitionInTx, returnIssueToStageInTx } from "./transitionService";
import { WorkflowExecutionStateError, WorkflowExecutionAccessDeniedError } from "./types";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

export const INCIDENT_TECHNICAL_TEAM_FIELD_KEY = "incidentTechnicalTeamId";
export const INCIDENT_EXECUTOR_FIELD_KEY = "incidentExecutorUserId";
const EXECUTOR_ASSIGNED_BY_FIELD_KEY = "incidentExecutorAssignedByUserId";
const EXECUTOR_ASSIGNED_AT_FIELD_KEY = "incidentExecutorAssignedAt";

const SEVERITY_VALUES = ["高", "中", "低"];
const RECOVERY_RESULT_VALUES = ["已恢復", "部分恢復", "已控制", "尚未恢復"];
const RECOVERY_FAILED_RESULT = "尚未恢復";

async function writeField(client: Client, issueId: string, fieldKey: string, fieldLabel: string, fieldValue: string) {
  await client.issueFieldValue.upsert({
    where: { issueId_fieldKey: { issueId, fieldKey } },
    create: { issueId, fieldKey, fieldLabel, fieldValue },
    update: { fieldValue },
  });
}

export async function readIncidentField(client: Client, issueId: string, fieldKey: string): Promise<string | null> {
  const row = await client.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId, fieldKey } } });
  return row?.fieldValue || null;
}

async function findForwardTransition(client: Client, fromStageId: string) {
  const t = await client.workflowTransition.findFirst({ where: { fromStageId, transitionType: "FORWARD" } });
  if (!t) throw new WorkflowExecutionStateError("此關卡沒有可用的 FORWARD Transition，資料異常");
  return t;
}

async function findReturnTransition(client: Client, fromStageId: string, actionKey: string) {
  const t = await client.workflowTransition.findFirst({ where: { fromStageId, transitionType: "RETURN", actionKey } });
  if (!t) throw new WorkflowExecutionStateError(`此關卡沒有 actionKey=${actionKey} 的 RETURN Transition，資料異常`);
  return t;
}

async function requireLeadOfTeam(client: Client, actorId: string, teamId: string, deniedMessage: string) {
  await requireExecutionCapability(actorId, "issue.edit", client);
  const membership = await client.teamMember.findFirst({ where: { teamId, userId: actorId, isActive: true } });
  if (!membership || membership.membershipRole !== "LEAD") {
    throw new WorkflowExecutionAccessDeniedError(deniedMessage);
  }
}

function requireStage(stage: { stageKey: string }, expected: string) {
  if (stage.stageKey !== expected) {
    throw new WorkflowExecutionStateError(`目前關卡「${stage.stageKey}」非「${expected}」，請重新整理頁面`);
  }
}

// ---------------------------------------------------------------------------
// 2. 承接與補件（pendingIntake）
//
// 「承接」直接沿用既有 claimService.claimIssueForTeam（CLAIM_STAGE_DOMAIN 已新增
// pendingIntake→INCIDENT 對照，見 hotfixDomainMap.ts），不另外包一層。
// 「退回補件」（RETURN → reported）在承接發生前 Issue.assignedTeamId 仍是 null，比照
// claimService.evaluateClaimEligibility 同一套「LEAD＋領域相符」資格判斷，不使用
// Issue.assignedTeamId 為基礎的通用機制（此時尚無意義）。
// ---------------------------------------------------------------------------

export interface RequestIncidentSupplementInput {
  issueId: string;
  actorId: string;
  reasonCode: string;
}

export async function requestIncidentSupplement(input: RequestIncidentSupplementInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingIntake");
    if (issue.assignedTeamId) throw new WorkflowExecutionStateError("此事件已被承接，請改用一般退回動作");

    await requireExecutionCapability(input.actorId, "issue.edit", tx);
    const eligibleTeam = await tx.team.findFirst({
      where: { domain: "INCIDENT", isActive: true, members: { some: { userId: input.actorId, isActive: true, membershipRole: "LEAD" } } },
    });
    if (!eligibleTeam) throw new WorkflowExecutionAccessDeniedError("僅事件受理窗口團隊的 active Team Lead 可退回補件");

    const transition = await findReturnTransition(tx, stage.id, "requestSupplement");
    return returnIssueToStageInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 3. 影響確認與分級（pendingClassification → pendingUnitAssignment）
// ---------------------------------------------------------------------------

export interface ClassifyIncidentInput {
  issueId: string;
  actorId: string;
  formalSeverity: string;
  adjustReason?: string;
  reasonCode: string;
}

export async function classifyIncident(input: ClassifyIncidentInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!SEVERITY_VALUES.includes(input.formalSeverity)) issues.push("正式事件等級必須是高／中／低");
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingClassification");
    await requireActorEligibleForStage(tx, input.actorId, issue, stage);

    const suggested = await readIncidentField(tx, issue.id, "incidentSuggestedSeverity");
    if (suggested && suggested !== input.formalSeverity && !input.adjustReason?.trim()) {
      throw new WorkflowExecutionStateError("正式事件等級與通報人建議等級不同時，必須填寫調整原因");
    }

    await writeField(tx, issue.id, "incidentFormalSeverity", "正式事件等級", input.formalSeverity);
    if (input.adjustReason?.trim()) {
      await writeField(tx, issue.id, "incidentSeverityAdjustReason", "等級調整原因", input.adjustReason.trim());
    }
    await tx.issue.update({ where: { id: issue.id }, data: { riskLevel: input.formalSeverity } });

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: `完成影響確認與分級：正式事件等級「${input.formalSeverity}」`, actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 4. 指派處理單位（pendingUnitAssignment → pendingTechLeadClaim）
// ---------------------------------------------------------------------------

export interface AssignIncidentUnitInput {
  issueId: string;
  actorId: string;
  technicalTeamId: string;
  reasonCode: string;
}

export async function assignIncidentTechnicalUnit(input: AssignIncidentUnitInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!input.technicalTeamId) issues.push("technicalTeamId 不得為空");
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingUnitAssignment");
    await requireActorEligibleForStage(tx, input.actorId, issue, stage);

    const team = await tx.team.findUnique({ where: { id: input.technicalTeamId } });
    if (!team || !team.isActive) throw new WorkflowExecutionStateError("找不到可指派的處理技術單位");

    await writeField(tx, issue.id, INCIDENT_TECHNICAL_TEAM_FIELD_KEY, "主要處理技術單位", team.id);

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: `指派主要處理技術單位：「${team.name}」`, actorUserId: input.actorId, reasonCode: input.reasonCode, toValue: team.id },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 5. 技術主管接單與指派（pendingTechLeadClaim → inHandling，或 RETURN 回 pendingUnitAssignment）
// ---------------------------------------------------------------------------

export interface TechLeadClaimAndAssignInput {
  issueId: string;
  actorId: string;
  executorUserId: string;
  reasonCode: string;
}

export async function techLeadClaimAndAssignExecutor(input: TechLeadClaimAndAssignInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!input.executorUserId) issues.push("executorUserId 不得為空");
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingTechLeadClaim");

    const technicalTeamId = await readIncidentField(tx, issue.id, INCIDENT_TECHNICAL_TEAM_FIELD_KEY);
    if (!technicalTeamId) throw new WorkflowExecutionStateError("尚未指派主要處理技術單位，無法接單");
    await requireLeadOfTeam(tx, input.actorId, technicalTeamId, "僅指派技術單位的 active Team Lead 可接單並指派實際處理人員");

    const executorMembership = await tx.teamMember.findFirst({ where: { teamId: technicalTeamId, userId: input.executorUserId, isActive: true } });
    if (!executorMembership) throw new WorkflowExecutionAccessDeniedError("指派對象必須是處理技術單位的 active 成員");
    const executorUser = await tx.user.findUnique({ where: { id: input.executorUserId } });
    if (!executorUser || !executorUser.isActive) throw new WorkflowExecutionAccessDeniedError("指派對象帳號不存在或已停用");

    const now = new Date().toISOString();
    await writeField(tx, issue.id, INCIDENT_EXECUTOR_FIELD_KEY, "實際處理人員", input.executorUserId);
    await writeField(tx, issue.id, EXECUTOR_ASSIGNED_BY_FIELD_KEY, "指派主管", input.actorId);
    await writeField(tx, issue.id, EXECUTOR_ASSIGNED_AT_FIELD_KEY, "指派時間", now);

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: `技術主管接單並指派實際處理人員：「${executorUser.name}」`, actorUserId: input.actorId, reasonCode: input.reasonCode, toValue: input.executorUserId },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

export interface TechLeadReturnInput {
  issueId: string;
  actorId: string;
  reasonCode: string;
}

export async function techLeadReturnForReassignment(input: TechLeadReturnInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingTechLeadClaim");

    const technicalTeamId = await readIncidentField(tx, issue.id, INCIDENT_TECHNICAL_TEAM_FIELD_KEY);
    if (!technicalTeamId) throw new WorkflowExecutionStateError("尚未指派主要處理技術單位");
    await requireLeadOfTeam(tx, input.actorId, technicalTeamId, "僅指派技術單位的 active Team Lead 可退回重新指派");

    const transition = await findReturnTransition(tx, stage.id, "techLeadReturn");
    return returnIssueToStageInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 6. 初步處置與服務恢復（inHandling → pendingRecoveryConfirmation）
// ---------------------------------------------------------------------------

export interface SubmitIncidentHandlingInput {
  issueId: string;
  actorId: string;
  initialHandling: string;
  recoveryMeasures: string;
  recoveryTime?: string;
  recoveryResult: string;
  evidence?: string;
  reasonCode: string;
}

export async function submitIncidentHandling(input: SubmitIncidentHandlingInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!input.initialHandling.trim()) issues.push("初步處置不得為空");
    if (!input.recoveryMeasures.trim()) issues.push("復原措施不得為空");
    if (!RECOVERY_RESULT_VALUES.includes(input.recoveryResult)) issues.push("恢復結果必須是已恢復／部分恢復／已控制／尚未恢復");
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "inHandling");

    const executorUserId = await readIncidentField(tx, issue.id, INCIDENT_EXECUTOR_FIELD_KEY);
    if (!executorUserId || executorUserId !== input.actorId) {
      throw new WorkflowExecutionAccessDeniedError("僅指派的實際處理人員本人可填寫並送出初步處置與恢復結果");
    }

    await writeField(tx, issue.id, "incidentInitialHandling", "初步處置", input.initialHandling.trim());
    await writeField(tx, issue.id, "incidentRecoveryMeasures", "復原措施", input.recoveryMeasures.trim());
    if (input.recoveryTime?.trim()) await writeField(tx, issue.id, "incidentRecoveryTime", "服務恢復時間", input.recoveryTime.trim());
    await writeField(tx, issue.id, "incidentRecoveryResult", "恢復結果", input.recoveryResult);
    if (input.evidence?.trim()) await writeField(tx, issue.id, "incidentRecoveryEvidence", "佐證／連結", input.evidence.trim());

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: `送出初步處置與服務恢復：恢復結果「${input.recoveryResult}」`, actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 7. 恢復結果確認（pendingRecoveryConfirmation → pendingRcaDecision，或 RETURN 回 inHandling）
// ---------------------------------------------------------------------------

export interface ConfirmIncidentRecoveryInput {
  issueId: string;
  actorId: string;
  confirmResult: string;
  reasonCode: string;
}

export async function confirmIncidentRecovery(input: ConfirmIncidentRecoveryInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!RECOVERY_RESULT_VALUES.includes(input.confirmResult)) issues.push("確認結果必須是已恢復／部分恢復／已控制／尚未恢復");
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingRecoveryConfirmation");
    await requireActorEligibleForStage(tx, input.actorId, issue, stage);

    await writeField(tx, issue.id, "incidentRecoveryConfirmResult", "恢復結果確認", input.confirmResult);

    const passed = input.confirmResult !== RECOVERY_FAILED_RESULT;
    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: `恢復結果確認：「${input.confirmResult}」（${passed ? "通過" : "未通過，退回處理"}）`, actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );

    if (passed) {
      const transition = await findForwardTransition(tx, stage.id);
      return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
    }
    const transition = await findReturnTransition(tx, stage.id, "recoveryRejected");
    return returnIssueToStageInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 8. RCA 啟動判定（pendingRcaDecision → pendingClosureConfirmation）
//
// 資安推動小組的確認不經 ApprovalRecord 正式核准治理層：既有 approvalService 的團隊核准
// 資格解析（resolveExpectedAuthorityForCreation）固定以 Issue.assignedTeamId 作為核准責任
// 團隊，但本關卡的責任團隊是資安推動小組（與受理窗口 assignedTeamId 不同），要支援「approver
// team ≠ Issue.assignedTeamId」需要調整 approvalService 這個信任邊界核心模組的團隊解析邏輯
// ——影響面已超出本輪 Incident 基礎切片，且屬於高風險變更，故本輪改以與 Hotfix 既有
// TRIAGE／CLAIM 資格判斷同一等級的 capability-gated 動作實作（是否為資安推動小組 active
// Team Lead），未來如需要正式 ApprovalRecord／Bell 通知／核准歷程，留給 RCA 回合視需要
// 一併擴充 approvalService 後再串接，不在本輪臆測或搭建半套邏輯。
// ---------------------------------------------------------------------------

export interface ConfirmIncidentRcaDecisionInput {
  issueId: string;
  actorId: string;
  needRca: boolean;
  reason?: string;
  reasonCode: string;
}

export async function confirmIncidentRcaDecision(input: ConfirmIncidentRcaDecisionInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!input.needRca && !input.reason?.trim()) issues.push("判定不需要 RCA 時必須填寫原因");
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingRcaDecision");

    const securityTeam = await tx.team.findFirst({ where: { domain: "SECURITY", isActive: true, members: { some: { userId: input.actorId, isActive: true, membershipRole: "LEAD" } } } });
    if (!securityTeam) {
      throw new WorkflowExecutionAccessDeniedError("僅資安推動小組的 active Team Lead 可完成 RCA 啟動判定");
    }

    await writeField(tx, issue.id, "incidentNeedRca", "是否需要 RCA", input.needRca ? "是" : "否");
    if (input.reason?.trim()) await writeField(tx, issue.id, "incidentRcaDecisionReason", "RCA 判定原因", input.reason.trim());

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: `RCA 啟動判定：${input.needRca ? "需要 RCA" : "不需要 RCA"}`, actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 9. 事件結案（pendingClosureConfirmation → closed）
//
// 需要 RCA 時，本輪 Incident 基礎切片尚未建立 RCA workflow，因此一律視為「RCA 尚未結案」，
// fail closed 擋下結案動作——符合任務規格「RCA 未完成前不得關閉事件」，不臆測 RCA 完成。
// RCA 回合會在此加入「關聯 RCA 已結案」的實際判斷。
// ---------------------------------------------------------------------------

export class IncidentRcaNotClosedError extends Error {
  constructor() {
    super("此事件判定需要 RCA，RCA 尚未結案前不得確認事件結案。");
    this.name = "IncidentRcaNotClosedError";
  }
}

export async function assertIncidentClosableWithoutRcaBlock(issueId: string): Promise<void> {
  const needRca = await readIncidentField(prisma, issueId, "incidentNeedRca");
  if (needRca === "是") throw new IncidentRcaNotClosedError();
}
