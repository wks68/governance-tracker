// Incident 事件通報流程：事件結案（pendingClosureConfirmation → closed）。
//
// 走既有 ApprovalRecord／decideApprovalRecord／executeIssueTransition 通用引擎（與 Hotfix
// 主管簽核完全同一條路徑，approverTeamId＝Issue.assignedTeamId＝事件受理團隊），額外疊加
// 「需要 RCA 時 RCA 未結案不得確認結案」的業務規則（見 incidentAssignmentService.ts 的
// assertIncidentClosableWithoutRcaBlock 說明：本輪 Incident 基礎切片尚未建立 RCA workflow，
// 一律視為未結案，fail closed）。

import { decideApprovalRecord } from "../approvalService";
import { executeIssueTransition } from "../workflowExecutionService";
import { assertIncidentClosableWithoutRcaBlock, IncidentRcaNotClosedError } from "../workflow-execution/incidentAssignmentService";
import { prisma } from "../prisma";
import { WorkflowExecutionStateError } from "../workflow-execution/types";

export { IncidentRcaNotClosedError };

export interface ConfirmIncidentClosureInput {
  issueId: string;
  approvalRecordId: string;
  actorId: string;
}

export async function confirmIncidentClosure(input: ConfirmIncidentClosureInput) {
  await assertIncidentClosableWithoutRcaBlock(input.issueId);

  const issue = await prisma.issue.findUnique({ where: { id: input.issueId } });
  if (!issue || !issue.currentWorkflowStageId) throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow");
  const stage = await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId } });
  if (!stage || stage.stageKey !== "pendingClosureConfirmation") {
    throw new WorkflowExecutionStateError(`目前關卡「${stage?.stageKey}」非「待事件結案確認」，請重新整理頁面`);
  }

  await decideApprovalRecord({ approvalRecordId: input.approvalRecordId, actorUserId: input.actorId, decision: "APPROVED" });

  const transition = await prisma.workflowTransition.findFirst({ where: { fromStageId: stage.id, transitionType: "FORWARD" } });
  if (!transition) throw new WorkflowExecutionStateError("此關卡沒有可用的 FORWARD Transition，資料異常");

  return executeIssueTransition({ issueId: input.issueId, transitionId: transition.id, actorId: input.actorId, reasonCode: "INCIDENT_CLOSURE_CONFIRMED" });
}
