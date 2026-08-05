// RCA 矯正／預防措施（RcaActionItem）CRUD 與驗證服務層。每一項措施各自獨立追蹤責任單位／
// 責任人／預定與實際完成日期／完成狀態／佐證／驗證方法與結果／展延原因／風險例外，
// 比照任務規格第十五節，不塞進單一大 JSON 字串。
//
// 建立／編輯僅允許 RCA 主責人本人，於 rcaAnalysisInProgress／improvementInProgress／
// pendingImprovementEvidence 三個關卡（分析規劃中、執行中、佐證提交前，都還可能新增或調整
// 措施）；驗證（verificationStatus／verifierUserId／verifiedAt／verificationNote）僅允許
// 資安推動小組（domain=SECURITY 的 active Team Lead 或成員）於 pendingVerificationConfirmation
// 關卡填寫，比照既有「不同角色在不同關卡各自負責自己那組欄位」慣例。

import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { getIssueOrThrow, getStageOrThrow } from "./validation";
import { RCA_ACTION_ITEM_TYPES, RCA_ACTION_ITEM_STATUSES, RCA_VERIFICATION_STATUSES } from "../constants";
import { WorkflowExecutionStateError, WorkflowExecutionAccessDeniedError } from "./types";
import { RCA_OWNER_FIELD_KEY, readRcaField } from "./rcaAssignmentService";

const OWNER_EDITABLE_STAGES = ["rcaAnalysisInProgress", "improvementInProgress", "pendingImprovementEvidence"];

function includesValue<T extends readonly string[]>(list: T, value: string): boolean {
  return (list as readonly string[]).includes(value);
}

async function requireRcaOwnerAtEditableStage(issueId: string, actorId: string) {
  const issue = await getIssueOrThrow(prisma, issueId);
  if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  if (!OWNER_EDITABLE_STAGES.includes(stage.stageKey)) {
    throw new WorkflowExecutionStateError(`目前關卡「${stage.stageKey}」不允許新增或編輯改善措施`);
  }
  const ownerUserId = await readRcaField(prisma, issue.id, RCA_OWNER_FIELD_KEY);
  if (!ownerUserId || ownerUserId !== actorId) {
    throw new WorkflowExecutionAccessDeniedError("僅 RCA 主責人本人可新增或編輯改善措施");
  }
  return { issue, stage };
}

export interface CreateRcaActionItemInput {
  rcaIssueId: string;
  actorId: string;
  type: string;
  description: string;
  ownerTeamId: string;
  ownerUserId?: string;
  plannedCompletionDate: string;
  verificationMethod?: string;
  reasonCode: string;
}

export async function createRcaActionItem(input: CreateRcaActionItemInput) {
  if (!includesValue(RCA_ACTION_ITEM_TYPES, input.type)) throw new WorkflowExecutionStateError("措施類型必須是矯正措施或預防措施");
  if (!input.description.trim()) throw new WorkflowExecutionStateError("措施內容不得為空");
  if (!input.ownerTeamId) throw new WorkflowExecutionStateError("措施責任單位不得為空");
  if (!input.plannedCompletionDate.trim()) throw new WorkflowExecutionStateError("預定完成日期不得為空");

  const { issue } = await requireRcaOwnerAtEditableStage(input.rcaIssueId, input.actorId);

  return prisma.$transaction(async (tx) => {
    const sequence = (await tx.rcaActionItem.count({ where: { rcaIssueId: issue.id } })) + 1;
    const item = await tx.rcaActionItem.create({
      data: {
        rcaIssueId: issue.id,
        sequence,
        type: input.type,
        description: input.description.trim(),
        ownerTeamId: input.ownerTeamId,
        ownerUserId: input.ownerUserId || null,
        plannedCompletionDate: new Date(input.plannedCompletionDate),
        status: "PLANNED",
        verificationMethod: input.verificationMethod?.trim() || null,
        verificationStatus: "PENDING",
      },
    });
    await writeAuditLog(
      { entityType: "Issue", entityId: issue.id, actionType: "FieldChange", summary: `新增改善措施 #${sequence}：${input.description.trim()}`, actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );
    return item;
  });
}

export interface UpdateRcaActionItemProgressInput {
  actionItemId: string;
  actorId: string;
  status: string;
  actualCompletionDate?: string;
  evidenceSummary?: string;
  extensionReason?: string;
  reasonCode: string;
}

export async function updateRcaActionItemProgress(input: UpdateRcaActionItemProgressInput) {
  if (!includesValue(RCA_ACTION_ITEM_STATUSES, input.status)) throw new WorkflowExecutionStateError("措施狀態不在合法值域");

  const item = await prisma.rcaActionItem.findUnique({ where: { id: input.actionItemId } });
  if (!item) throw new WorkflowExecutionStateError("找不到此改善措施");
  await requireRcaOwnerAtEditableStage(item.rcaIssueId, input.actorId);

  if (input.status === "COMPLETED" && !input.actualCompletionDate?.trim()) {
    throw new WorkflowExecutionStateError("狀態設為已完成時，實際完成日期不得為空");
  }
  if (input.status === "EXTENDED" && !input.extensionReason?.trim()) {
    throw new WorkflowExecutionStateError("狀態設為展延時，必須填寫展延原因");
  }
  if (input.status === "RISK_EXCEPTION" && !input.extensionReason?.trim()) {
    throw new WorkflowExecutionStateError("狀態設為風險例外時，必須填寫風險例外原因");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.rcaActionItem.update({
      where: { id: item.id },
      data: {
        status: input.status,
        actualCompletionDate: input.actualCompletionDate?.trim() ? new Date(input.actualCompletionDate) : item.actualCompletionDate,
        evidenceSummary: input.evidenceSummary?.trim() || item.evidenceSummary,
        extensionReason: input.extensionReason?.trim() || item.extensionReason,
      },
    });
    await writeAuditLog(
      { entityType: "Issue", entityId: item.rcaIssueId, actionType: "FieldChange", summary: `改善措施 #${item.sequence} 狀態更新為「${input.status}」`, actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );
    return updated;
  });
}

export interface VerifyRcaActionItemInput {
  actionItemId: string;
  actorId: string;
  verificationStatus: string;
  verificationNote?: string;
  reasonCode: string;
}

export async function verifyRcaActionItem(input: VerifyRcaActionItemInput) {
  if (!includesValue(RCA_VERIFICATION_STATUSES, input.verificationStatus) || input.verificationStatus === "PENDING") {
    throw new WorkflowExecutionStateError("驗證結果必須是通過／不通過／不適用");
  }
  if (input.verificationStatus === "NOT_APPLICABLE" && !input.verificationNote?.trim()) {
    throw new WorkflowExecutionStateError("驗證結果為不適用時，必須填寫原因");
  }

  const item = await prisma.rcaActionItem.findUnique({ where: { id: input.actionItemId } });
  if (!item) throw new WorkflowExecutionStateError("找不到此改善措施");

  const issue = await getIssueOrThrow(prisma, item.rcaIssueId);
  if (!issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  if (stage.stageKey !== "pendingVerificationConfirmation") {
    throw new WorkflowExecutionStateError("僅能在待專業驗證與資安確認關卡填寫驗證結果");
  }

  const membership = await prisma.teamMember.findFirst({
    where: { userId: input.actorId, isActive: true, team: { domain: "SECURITY", isActive: true } },
  });
  if (!membership) throw new WorkflowExecutionAccessDeniedError("僅資安推動小組成員可填寫改善措施驗證結果");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.rcaActionItem.update({
      where: { id: item.id },
      data: {
        verificationStatus: input.verificationStatus,
        verifierUserId: input.actorId,
        verifiedAt: new Date(),
        verificationNote: input.verificationNote?.trim() || null,
      },
    });
    await writeAuditLog(
      { entityType: "Issue", entityId: item.rcaIssueId, actionType: "FieldChange", summary: `改善措施 #${item.sequence} 驗證結果：「${input.verificationStatus}」`, actorUserId: input.actorId, reasonCode: input.reasonCode },
      tx,
    );
    return updated;
  });
}

export async function listRcaActionItems(rcaIssueId: string) {
  return prisma.rcaActionItem.findMany({ where: { rcaIssueId }, orderBy: { sequence: "asc" } });
}
