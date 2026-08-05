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
import { executeIssueTransitionInTx, executeIssueTransition, returnIssueToStageInTx } from "./transitionService";
import { decideApprovalRecord } from "../approvalService";
import { createRcaFromIncidentInTx } from "../rca-ui/rcaCreation";
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
// 第二階段：走正式 ApprovalRecord（approvalType=INCIDENT_RCA_DECISION_CONFIRMATION，
// approverTeamId 固定解析為 domain=SECURITY 團隊，見 approvalService.ts 的
// APPROVAL_TEAM_RESOLUTION_BY_DOMAIN），取代第一階段的 capability-gated 暫行實作。
// 「是否需要 RCA」語意上是資安推動小組完成本關卡審查的結論，不是同意／駁回他人的送件，
// 因此一律以 decision=APPROVED 記錄完成審查，needRca／原因另存 IssueFieldValue（供
// RCA 建立與 Incident 結案關卡的 RCA 未結案 gate 使用）；決策授權（僅資安推動小組
// active Team Lead 可執行）完全交給 decideApprovalRecord 既有信任邊界，不再自行判斷。
// ---------------------------------------------------------------------------

export interface ConfirmIncidentRcaDecisionInput {
  issueId: string;
  actorId: string;
  needRca: boolean;
  reason?: string;
  reasonCode: string;
}

export async function confirmIncidentRcaDecision(input: ConfirmIncidentRcaDecisionInput) {
  const issues: string[] = [];
  if (!input.needRca && !input.reason?.trim()) issues.push("判定不需要 RCA 時必須填寫原因");
  if (issues.length > 0) throw new WorkflowExecutionStateError(issues.join("；"));

  const issue = await getIssueOrThrow(prisma, input.issueId);
  if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  requireStage(stage, "pendingRcaDecision");

  const record = await prisma.approvalRecord.findFirst({
    where: { issueId: issue.id, approvalType: "INCIDENT_RCA_DECISION_CONFIRMATION", relatedStageKey: "pendingRcaDecision", recordStatus: "ACTIVE", decision: "PENDING" },
    orderBy: { revisionNo: "desc" },
  });
  if (!record) throw new WorkflowExecutionStateError("找不到待處理的 RCA 啟動判定核准紀錄，請重新整理頁面");

  await writeField(prisma, issue.id, "incidentNeedRca", "是否需要 RCA", input.needRca ? "是" : "否");
  if (input.reason?.trim()) await writeField(prisma, issue.id, "incidentRcaDecisionReason", "RCA 判定原因", input.reason.trim());

  await decideApprovalRecord({ approvalRecordId: record.id, actorUserId: input.actorId, decision: "APPROVED", decisionComment: input.needRca ? "需要 RCA" : input.reason?.trim() });

  if (input.needRca) {
    await prisma.$transaction((tx) =>
      createRcaFromIncidentInTx(tx, { incidentIssueId: issue.id, actorId: input.actorId, reasonCode: input.reasonCode || "RCA_CREATED_FROM_INCIDENT" }),
    );
  }

  const transition = await findForwardTransition(prisma, stage.id);
  return executeIssueTransition({ issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode || "INCIDENT_RCA_DECISION_CONFIRMED" });
}

// ---------------------------------------------------------------------------
// 9. 事件結案（pendingClosureConfirmation → closed）
//
// 一個 Incident 可以關聯多筆 RCA（INCIDENT_TO_RCA，1:N）；只要有任何一筆有效關聯的 RCA
// 尚未到達 rcaClosed 終點，就一律 fail closed 擋下事件結案動作——關閉第一筆 RCA 不得連帶
// 關閉 Incident，必須「全部」關聯 RCA 都結案才放行（見任務規格第十七節）。沒有任何關聯
// RCA（needRca≠是，或核准當下判定不需要 RCA）時視為無阻擋，直接放行。
// ---------------------------------------------------------------------------

export class IncidentRcaNotClosedError extends Error {
  constructor(pendingCount: number) {
    super(`此事件關聯 ${pendingCount} 筆 RCA 尚未結案，全部關聯 RCA 結案前不得確認事件結案。`);
    this.name = "IncidentRcaNotClosedError";
  }
}

export async function assertIncidentClosableWithoutRcaBlock(issueId: string): Promise<void> {
  const relations = await prisma.issueRelation.findMany({
    where: { sourceIssueId: issueId, relationType: "INCIDENT_TO_RCA", removedAt: null },
    select: { targetIssueId: true },
  });
  if (relations.length === 0) return;

  const rcaIssues = await prisma.issue.findMany({
    where: { id: { in: relations.map((r) => r.targetIssueId) } },
    select: { workflowStatus: true },
  });
  const pendingCount = rcaIssues.filter((r) => r.workflowStatus !== "rcaClosed").length;
  if (pendingCount > 0) throw new IncidentRcaNotClosedError(pendingCount);
}
