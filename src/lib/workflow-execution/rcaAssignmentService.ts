// RCA 根因分析與改善結案流程：承接／指派主責人／根因分析送出／技術審查／完整性審查／
// 條件式管理階層確認／改善執行／改善佐證／驗證與資安確認／RCA 結案 的寫入服務層。
//
// 沿用既有 M2-B 執行引擎（executeIssueTransitionInTx／returnIssueToStageInTx／
// requireActorEligibleForStage／decideApprovalRecord／IssueFieldValue／AuditLog），完全
// 比照 incidentAssignmentService.ts 既有寫法，不建立第二套流程引擎。
//
// 責任解析：
//   - pendingRcaTeamClaim／pendingTechnicalReview／pendingRcaClosureConfirmation：
//     Issue.assignedTeamId（RCA 建立時直接帶入來源 Incident 的技術處理團隊，見
//     rca-ui/rcaCreation.ts）的 active Team Lead——沿用通用 requiredMembershipRole 機制。
//   - pendingRcaOwnerAssignment：同上（負責單位主管指派主責人）。
//   - rcaAnalysisInProgress／improvementInProgress／pendingImprovementEvidence：責任人是
//     「RCA 主責人」本人（IssueFieldValue 記錄），不是整個負責單位團隊，比照 Incident
//     inHandling 的 executor 模式。
//   - pendingSecurityIntegrityReview／pendingVerificationConfirmation：走正式 ApprovalRecord，
//     approverTeamId 固定解析為 domain=SECURITY（見 approvalService.ts 的
//     APPROVAL_TEAM_RESOLUTION_BY_DOMAIN），不依賴 Issue.assignedTeamId。
//   - pendingManagementConfirmation：條件式（見 rcaManagementReviewService.ts）。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { getIssueOrThrow, getStageOrThrow, assertReasonCodeProvided, throwIfInvalid } from "./validation";
import { requireActorEligibleForStage, requireExecutionCapability } from "./access";
import { executeIssueTransitionInTx, executeIssueTransition, returnIssueToStageInTx } from "./transitionService";
import { decideApprovalRecord } from "../approvalService";
import { RCA_CAUSE_TYPES, RCA_ANALYSIS_METHODS } from "../constants";

function isRcaCauseType(value: string): boolean {
  return (RCA_CAUSE_TYPES as readonly string[]).includes(value);
}
import { WorkflowExecutionStateError, WorkflowExecutionAccessDeniedError } from "./types";
import { evaluateRcaManagementConfirmationRequirement } from "../rca-ui/rcaManagementReviewService";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

export const RCA_OWNER_FIELD_KEY = "rcaOwnerUserId";
const RCA_OWNER_ASSIGNED_BY_FIELD_KEY = "rcaOwnerAssignedByUserId";

async function writeField(client: Client, issueId: string, fieldKey: string, fieldLabel: string, fieldValue: string) {
  await client.issueFieldValue.upsert({
    where: { issueId_fieldKey: { issueId, fieldKey } },
    create: { issueId, fieldKey, fieldLabel, fieldValue },
    update: { fieldValue },
  });
}

export async function readRcaField(client: Client, issueId: string, fieldKey: string): Promise<string | null> {
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

function requireStage(stage: { stageKey: string }, expected: string) {
  if (stage.stageKey !== expected) {
    throw new WorkflowExecutionStateError(`目前關卡「${stage.stageKey}」非「${expected}」，請重新整理頁面`);
  }
}

// ---------------------------------------------------------------------------
// 2. RCA 負責單位主管承接（pendingRcaTeamClaim → pendingRcaOwnerAssignment）
// ---------------------------------------------------------------------------

export interface RcaTeamClaimInput {
  issueId: string;
  actorId: string;
  reasonCode: string;
}

export async function rcaTeamClaim(input: RcaTeamClaimInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingRcaTeamClaim");
    await requireActorEligibleForStage(tx, input.actorId, issue, stage);

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: "RCA 負責單位主管已承接", actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 3. 指派 RCA 主責人（pendingRcaOwnerAssignment → rcaAnalysisInProgress）
// ---------------------------------------------------------------------------

export interface AssignRcaOwnerInput {
  issueId: string;
  actorId: string;
  ownerUserId: string;
  reasonCode: string;
}

export async function assignRcaOwner(input: AssignRcaOwnerInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!input.ownerUserId) issues.push("ownerUserId 不得為空");
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingRcaOwnerAssignment");
    await requireActorEligibleForStage(tx, input.actorId, issue, stage);

    if (!issue.assignedTeamId) throw new WorkflowExecutionStateError("RCA 尚未指派負責單位");
    const ownerMembership = await tx.teamMember.findFirst({ where: { teamId: issue.assignedTeamId, userId: input.ownerUserId, isActive: true } });
    if (!ownerMembership) throw new WorkflowExecutionAccessDeniedError("RCA 主責人必須是負責單位的 active 成員");
    const ownerUser = await tx.user.findUnique({ where: { id: input.ownerUserId } });
    if (!ownerUser || !ownerUser.isActive) throw new WorkflowExecutionAccessDeniedError("指派對象帳號不存在或已停用");

    await writeField(tx, issue.id, RCA_OWNER_FIELD_KEY, "RCA 主責人", input.ownerUserId);
    await writeField(tx, issue.id, RCA_OWNER_ASSIGNED_BY_FIELD_KEY, "指派主管", input.actorId);

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: `指派 RCA 主責人：「${ownerUser.name}」`, actorUserId: input.actorId, reasonCode: input.reasonCode, toValue: input.ownerUserId },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 4. 根因分析與改善計畫送出（rcaAnalysisInProgress → pendingTechnicalReview）
// ---------------------------------------------------------------------------

export interface SubmitRcaAnalysisInput {
  issueId: string;
  actorId: string;
  directCause: string;
  rootCause: string;
  controlFailurePoint: string;
  causeType: string;
  analysisMethods: string[];
  rcaConclusion: string;
  actualImpact: string;
  verificationMethod: string;
  reasonCode: string;
}

export async function submitRcaAnalysis(input: SubmitRcaAnalysisInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!input.directCause.trim()) issues.push("直接原因不得為空");
    if (!input.rootCause.trim()) issues.push("根本原因不得為空");
    if (!input.rcaConclusion.trim()) issues.push("RCA 結論不得為空");
    if (!input.actualImpact.trim()) issues.push("實際影響不得為空");
    if (!isRcaCauseType(input.causeType)) issues.push(`原因類型必須是既有值域之一（${RCA_CAUSE_TYPES.join("／")}）`);
    if (input.analysisMethods.length === 0 || input.analysisMethods.some((m) => !RCA_ANALYSIS_METHODS.includes(m as (typeof RCA_ANALYSIS_METHODS)[number]))) {
      issues.push("分析方法至少選擇一項既有值域");
    }
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "rcaAnalysisInProgress");

    const ownerUserId = await readRcaField(tx, issue.id, RCA_OWNER_FIELD_KEY);
    if (!ownerUserId || ownerUserId !== input.actorId) {
      throw new WorkflowExecutionAccessDeniedError("僅指派的 RCA 主責人本人可填寫並送出根因分析與改善計畫");
    }

    const actionItemCount = await tx.rcaActionItem.count({ where: { rcaIssueId: issue.id } });
    if (actionItemCount === 0) {
      throw new WorkflowExecutionStateError("送出根因分析前，至少需要建立一項矯正或預防措施");
    }

    await writeField(tx, issue.id, "rcaDirectCause", "直接原因", input.directCause.trim());
    await writeField(tx, issue.id, "rcaRootCause", "根本原因", input.rootCause.trim());
    if (input.controlFailurePoint.trim()) await writeField(tx, issue.id, "rcaControlFailurePoint", "控制失效點", input.controlFailurePoint.trim());
    await writeField(tx, issue.id, "rcaCauseType", "原因類型", input.causeType);
    await writeField(tx, issue.id, "rcaAnalysisMethods", "分析方法", input.analysisMethods.join("、"));
    await writeField(tx, issue.id, "rcaConclusion", "RCA 結論", input.rcaConclusion.trim());
    await writeField(tx, issue.id, "rcaActualImpact", "實際影響", input.actualImpact.trim());
    if (input.verificationMethod.trim()) await writeField(tx, issue.id, "rcaVerificationMethod", "驗證方法", input.verificationMethod.trim());

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: "送出根因分析與改善計畫", actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 5. 負責單位主管技術審查（pendingTechnicalReview → pendingSecurityIntegrityReview，
//    或 RETURN 回 rcaAnalysisInProgress）——走正式 ApprovalRecord（approverTeamId＝
//    Issue.assignedTeamId），與 Incident RCA 啟動判定同一套通用機制。
// ---------------------------------------------------------------------------

async function decideAndAdvance(opts: {
  issueId: string;
  actorId: string;
  stageKey: string;
  approvalType: string;
  approved: boolean;
  comment?: string;
  returnActionKey: string;
  reasonCode: string;
}) {
  const issue = await getIssueOrThrow(prisma, opts.issueId);
  if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  requireStage(stage, opts.stageKey);

  const record = await prisma.approvalRecord.findFirst({
    where: { issueId: issue.id, approvalType: opts.approvalType, relatedStageKey: opts.stageKey, recordStatus: "ACTIVE", decision: "PENDING" },
    orderBy: { revisionNo: "desc" },
  });
  if (!record) throw new WorkflowExecutionStateError("找不到待處理的核准紀錄，請重新整理頁面");

  await decideApprovalRecord({
    approvalRecordId: record.id,
    actorUserId: opts.actorId,
    decision: opts.approved ? "APPROVED" : "REJECTED",
    decisionComment: opts.comment,
    decisionReasonCode: opts.approved ? undefined : opts.reasonCode,
  });

  if (opts.approved) {
    const transition = await findForwardTransition(prisma, stage.id);
    return executeIssueTransition({ issueId: issue.id, transitionId: transition.id, actorId: opts.actorId, reasonCode: opts.reasonCode });
  }
  const transition = await findReturnTransition(prisma, stage.id, opts.returnActionKey);
  return prisma.$transaction((tx) => returnIssueToStageInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: opts.actorId, reasonCode: opts.reasonCode }));
}

export interface DecideRcaReviewInput {
  issueId: string;
  actorId: string;
  approved: boolean;
  comment?: string;
  reasonCode: string;
}

export async function decideRcaTechnicalReview(input: DecideRcaReviewInput) {
  if (!input.approved && !input.reasonCode.trim()) throw new WorkflowExecutionStateError("技術審查退回時必須填寫退回原因");
  return decideAndAdvance({
    issueId: input.issueId,
    actorId: input.actorId,
    stageKey: "pendingTechnicalReview",
    approvalType: "RCA_TECHNICAL_REVIEW",
    approved: input.approved,
    comment: input.comment,
    returnActionKey: "technicalReviewReject",
    reasonCode: input.reasonCode,
  });
}

// ---------------------------------------------------------------------------
// 6. 資安推動小組完整性審查（pendingSecurityIntegrityReview → pendingManagementConfirmation，
//    或 RETURN 回 rcaAnalysisInProgress）
// ---------------------------------------------------------------------------

export interface DecideRcaSecurityIntegrityReviewInput extends DecideRcaReviewInput {
  // 資安推動小組於完整性審查當下一併判斷是否符合「須經 DMS 部長核准」的額外條件（見任務
  // 規格第十六節：跨單位廣泛營運影響／對外或客戶可見／法遵或個資通報義務／高稽核關注／
  // 高風險例外／經指定須經部長／符合程序4.7.3其他條件）。只在「正式事件等級＝高」時才有
  // 意義（見 rcaManagementReviewService.ts 的 evaluateRcaManagementConfirmationRequirement）。
  requiresDirectorEscalation?: boolean;
}

export async function decideRcaSecurityIntegrityReview(input: DecideRcaSecurityIntegrityReviewInput) {
  if (!input.approved && !input.reasonCode.trim()) throw new WorkflowExecutionStateError("完整性審查退回時必須填寫退回原因");
  if (input.approved && typeof input.requiresDirectorEscalation === "boolean") {
    await writeField(
      prisma,
      input.issueId,
      "rcaDirectorEscalationRequired",
      "是否須經部長核准",
      input.requiresDirectorEscalation ? "是" : "否",
    );
  }
  return decideAndAdvance({
    issueId: input.issueId,
    actorId: input.actorId,
    stageKey: "pendingSecurityIntegrityReview",
    approvalType: "RCA_SECURITY_INTEGRITY_REVIEW",
    approved: input.approved,
    comment: input.comment,
    returnActionKey: "securityIntegrityReject",
    reasonCode: input.reasonCode,
  });
}

// ---------------------------------------------------------------------------
// 7. 條件式管理階層確認（pendingManagementConfirmation → improvementInProgress）——見
//    rca-ui/rcaManagementReviewService.ts。本函式只負責「進入本關卡時視需要動態建立
//    RCA_VP_CONFIRMATION／RCA_DIRECTOR_APPROVAL」與「全部所需決議通過後才放行到下一關」。
// ---------------------------------------------------------------------------

export async function ensureRcaManagementConfirmationRequirements(issueId: string, actorId: string, reasonCode: string) {
  const issue = await getIssueOrThrow(prisma, issueId);
  if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  requireStage(stage, "pendingManagementConfirmation");
  return evaluateRcaManagementConfirmationRequirement({ issueId, stageId: stage.id, actorId, reasonCode });
}

export interface DecideRcaManagementConfirmationInput {
  issueId: string;
  actorId: string;
  approvalType: "RCA_VP_CONFIRMATION" | "RCA_DIRECTOR_APPROVAL";
  approved: boolean;
  comment?: string;
  reasonCode: string;
}

export async function decideRcaManagementConfirmation(input: DecideRcaManagementConfirmationInput) {
  if (!input.approved && !input.reasonCode.trim()) throw new WorkflowExecutionStateError("駁回時必須填寫原因");

  const issue = await getIssueOrThrow(prisma, input.issueId);
  if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  requireStage(stage, "pendingManagementConfirmation");

  const record = await prisma.approvalRecord.findFirst({
    where: { issueId: issue.id, approvalType: input.approvalType, relatedStageKey: "pendingManagementConfirmation", recordStatus: "ACTIVE", decision: "PENDING" },
    orderBy: { revisionNo: "desc" },
  });
  if (!record) throw new WorkflowExecutionStateError("找不到待處理的管理階層確認紀錄，請重新整理頁面");

  await decideApprovalRecord({
    approvalRecordId: record.id,
    actorUserId: input.actorId,
    decision: input.approved ? "APPROVED" : "REJECTED",
    decisionComment: input.comment,
    decisionReasonCode: input.approved ? undefined : input.reasonCode,
  });

  if (!input.approved) {
    const transition = await findReturnTransition(prisma, stage.id, "securityIntegrityReject");
    return prisma.$transaction((tx) => returnIssueToStageInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode }));
  }

  // 副部長核准通過後，必須先讓 evaluateRcaManagementConfirmationRequirement 依
  // rcaDirectorEscalationRequired 判斷「是否還要動態建立部長核准紀錄」，再重新計算尚待決議
  // 筆數——否則副部長剛核准的當下，部長紀錄還沒建立，會被誤判為「已無待處理項目」而提早放行。
  await evaluateRcaManagementConfirmationRequirement({ issueId: issue.id, stageId: stage.id, actorId: input.actorId, reasonCode: input.reasonCode });

  const remainingPending = await prisma.approvalRecord.count({
    where: { issueId: issue.id, relatedStageKey: "pendingManagementConfirmation", recordStatus: "ACTIVE", decision: "PENDING" },
  });
  if (remainingPending > 0) {
    return prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  }

  const refreshedIssue = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  if (refreshedIssue.currentWorkflowStageId !== stage.id) {
    // evaluateRcaManagementConfirmationRequirement 在完全不需要管理階層確認時會自行前進，
    // 這裡只是保險：若因任何原因已經離開本關卡，不重複觸發 FORWARD Transition。
    return refreshedIssue;
  }
  const transition = await findForwardTransition(prisma, stage.id);
  return executeIssueTransition({ issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
}

// ---------------------------------------------------------------------------
// 8. 改善措施執行送出（improvementInProgress → pendingImprovementEvidence）
// ---------------------------------------------------------------------------

export interface SubmitImprovementProgressInput {
  issueId: string;
  actorId: string;
  reasonCode: string;
}

export async function submitImprovementProgress(input: SubmitImprovementProgressInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "improvementInProgress");

    const ownerUserId = await readRcaField(tx, issue.id, RCA_OWNER_FIELD_KEY);
    if (!ownerUserId || ownerUserId !== input.actorId) {
      throw new WorkflowExecutionAccessDeniedError("僅 RCA 主責人本人可送出改善措施執行進度");
    }

    const incompleteWithoutException = await tx.rcaActionItem.count({
      where: { rcaIssueId: issue.id, status: { notIn: ["COMPLETED", "RISK_EXCEPTION"] } },
    });
    if (incompleteWithoutException > 0) {
      throw new WorkflowExecutionStateError("尚有改善措施未完成且未建立風險例外，無法送出至佐證提交");
    }

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: "改善措施執行完畢，送出待佐證提交", actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 9. 改善佐證提交（pendingImprovementEvidence → pendingVerificationConfirmation）
// ---------------------------------------------------------------------------

export interface SubmitRcaEvidenceInput {
  issueId: string;
  actorId: string;
  evidenceSummary: string;
  reasonCode: string;
}

export async function submitRcaEvidence(input: SubmitRcaEvidenceInput) {
  return prisma.$transaction(async (tx) => {
    const issues: string[] = [];
    assertReasonCodeProvided(input.reasonCode, issues);
    if (!input.evidenceSummary.trim()) issues.push("改善佐證摘要不得為空");
    throwIfInvalid(issues);

    const issue = await getIssueOrThrow(tx, input.issueId);
    if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
    const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
    requireStage(stage, "pendingImprovementEvidence");

    const ownerUserId = await readRcaField(tx, issue.id, RCA_OWNER_FIELD_KEY);
    if (!ownerUserId || ownerUserId !== input.actorId) {
      throw new WorkflowExecutionAccessDeniedError("僅 RCA 主責人本人可提交改善佐證");
    }

    await writeField(tx, issue.id, "rcaEvidenceSummary", "改善佐證摘要", input.evidenceSummary.trim());

    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: "送出改善佐證", actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );

    const transition = await findForwardTransition(tx, stage.id);
    return executeIssueTransitionInTx(tx, { issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode });
  });
}

// ---------------------------------------------------------------------------
// 10. 專業驗證與資安確認（pendingVerificationConfirmation → pendingRcaClosureConfirmation，
//     或 RETURN 回 improvementInProgress）
// ---------------------------------------------------------------------------

export async function decideRcaVerification(input: DecideRcaReviewInput) {
  if (!input.approved && !input.reasonCode.trim()) throw new WorkflowExecutionStateError("驗證不通過時必須填寫原因");

  const issue = await getIssueOrThrow(prisma, input.issueId);
  if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  requireStage(stage, "pendingVerificationConfirmation");

  const unverified = await prisma.rcaActionItem.count({
    where: { rcaIssueId: issue.id, status: { notIn: ["RISK_EXCEPTION"] }, verificationStatus: { in: ["PENDING", "FAILED"] } },
  });
  if (input.approved && unverified > 0) {
    throw new WorkflowExecutionStateError("尚有改善措施未完成驗證或驗證不通過，且未建立風險例外，無法通過驗證與資安確認");
  }

  return decideAndAdvance({
    issueId: input.issueId,
    actorId: input.actorId,
    stageKey: "pendingVerificationConfirmation",
    approvalType: "RCA_SECURITY_VERIFICATION_CONFIRMATION",
    approved: input.approved,
    comment: input.comment,
    returnActionKey: "verificationReject",
    reasonCode: input.reasonCode,
  });
}

// ---------------------------------------------------------------------------
// 11. RCA 結案確認（pendingRcaClosureConfirmation → rcaClosed）
// ---------------------------------------------------------------------------

export interface ConfirmRcaClosureInput {
  issueId: string;
  actorId: string;
  comment?: string;
  reasonCode: string;
}

export async function confirmRcaClosure(input: ConfirmRcaClosureInput) {
  const issue = await getIssueOrThrow(prisma, input.issueId);
  if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  requireStage(stage, "pendingRcaClosureConfirmation");

  const record = await prisma.approvalRecord.findFirst({
    where: { issueId: issue.id, approvalType: "RCA_CLOSURE_CONFIRMATION", relatedStageKey: "pendingRcaClosureConfirmation", recordStatus: "ACTIVE", decision: "PENDING" },
    orderBy: { revisionNo: "desc" },
  });
  if (!record) throw new WorkflowExecutionStateError("找不到待處理的 RCA 結案確認紀錄，請重新整理頁面");

  await decideApprovalRecord({ approvalRecordId: record.id, actorUserId: input.actorId, decision: "APPROVED", decisionComment: input.comment });

  const transition = await findForwardTransition(prisma, stage.id);
  return executeIssueTransition({ issueId: issue.id, transitionId: transition.id, actorId: input.actorId, reasonCode: input.reasonCode || "RCA_CLOSURE_CONFIRMED" });
}
