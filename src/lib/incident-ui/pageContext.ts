// Incident 事件通報流程：詳情頁共用的資料組裝層，比照 src/lib/hotfix-ui/pageContext.ts
// 既有慣例（只做唯讀查詢＋組裝 ViewModel，不做任何寫入、不構成授權邊界）。與 Hotfix 版本
// 分開維護，不修改或匯入 HotfixPageContext，符合「不修改 Hotfix 功能」的範圍限制；底層
// 沿用完全相同的通用引擎（getIssueWorkflowRuntime／getEligibleApproverUserIds）。

import { prisma } from "../prisma";
import { getIssueWorkflowRuntime, type IssueWorkflowRuntime } from "../workflowExecutionService";
import { getEligibleApproverUserIds } from "../approvalService";
import { incidentNineStageIndexOfStageKey } from "./incidentStage";
import { INCIDENT_FIELD } from "./incidentFieldRegistry";
import type { Issue, User } from "@prisma/client";

export class IncidentPageNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentPageNotApplicableError";
  }
}

export interface IncidentTicketBasicInfoData {
  issueKey: string;
  reporterName: string;
  teamName: string | null;
  environment: string;
  title: string;
  description: string;
  systemName: string;
  formalSeverity: string | null;
  /** 通報人初步影響感受（IMPACT_FEELING_OPTIONS 之一），僅供受理窗口參考，不是正式等級猜測。 */
  suggestedImpactLevel: string | null;
  incidentType: string | null;
  occurredAt: string | null;
}

export interface IncidentPageContext {
  issue: Issue;
  actor: User;
  runtime: Extract<IssueWorkflowRuntime, { onVersionedWorkflow: true }>;
  nineStageIndex: number | null;
  ticketBasicInfo: IncidentTicketBasicInfoData;
}

export async function loadIncidentPageContext(issueId: string, actor: User): Promise<IncidentPageContext> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new IncidentPageNotApplicableError("找不到此工單");
  if (issue.issueType !== "Incident") throw new IncidentPageNotApplicableError("此工單不是 Incident 類型");

  const runtime = await getIssueWorkflowRuntime(issueId, actor.id);
  if (!runtime.onVersionedWorkflow) {
    throw new IncidentPageNotApplicableError("此 Incident 工單尚未啟動 Workflow 引擎");
  }

  const stageKey = runtime.currentStage.stageKey;
  const nineStageIndex = incidentNineStageIndexOfStageKey(stageKey);

  const team = issue.assignedTeamId ? await prisma.team.findUnique({ where: { id: issue.assignedTeamId } }) : null;
  const fieldRows = await prisma.issueFieldValue.findMany({
    where: { issueId, fieldKey: { in: ["incidentFormalSeverity", INCIDENT_FIELD.suggestedImpactLevel, "incidentType", "incidentOccurredAt"] } },
  });
  const fieldByKey = new Map(fieldRows.map((row) => [row.fieldKey, row.fieldValue]));

  const ticketBasicInfo: IncidentTicketBasicInfoData = {
    issueKey: issue.issueKey,
    reporterName: issue.reporter,
    teamName: team?.name ?? null,
    environment: issue.environment,
    title: issue.title,
    description: issue.description,
    systemName: issue.systemName,
    formalSeverity: fieldByKey.get("incidentFormalSeverity") ?? null,
    suggestedImpactLevel: fieldByKey.get(INCIDENT_FIELD.suggestedImpactLevel) ?? null,
    incidentType: fieldByKey.get("incidentType") ?? null,
    occurredAt: fieldByKey.get("incidentOccurredAt") ?? null,
  };

  return { issue, actor, runtime, nineStageIndex, ticketBasicInfo };
}

export interface IncidentApprovalReviewViewData {
  approvalRecordId: string;
  requestedByName: string;
  requestedAt: string;
  isResponsible: boolean;
  expectedApproverLabel: string | null;
}

// pendingClosureConfirmation 走既有 ApprovalRecord／getEligibleApproverUserIds 通用引擎
// （approverTeamId＝Issue.assignedTeamId＝事件受理團隊，見 incidentAssignmentService.ts
// 說明），isResponsible 判斷邏輯比照 hotfix-ui/pageContext.ts 既有 buildApprovalReviewViewData。
export async function buildIncidentApprovalReviewViewData(ctx: IncidentPageContext): Promise<IncidentApprovalReviewViewData | null> {
  const record = ctx.runtime.pendingApproval;
  if (!record) return null;

  const [requestedBy, expectedApprover] = await Promise.all([
    prisma.user.findUnique({ where: { id: record.requestedByUserId } }),
    record.expectedApproverUserId ? prisma.user.findUnique({ where: { id: record.expectedApproverUserId } }) : Promise.resolve(null),
  ]);

  let isResponsible: boolean;
  if (record.decision !== "PENDING") {
    isResponsible = false;
  } else if (record.expectedApproverUserId !== null) {
    isResponsible = record.expectedApproverUserId === ctx.actor.id;
  } else {
    const eligibleApprovers = await getEligibleApproverUserIds(record);
    isResponsible = eligibleApprovers.includes(ctx.actor.id) && ctx.actor.id !== record.requestedByUserId;
  }

  return {
    approvalRecordId: record.id,
    requestedByName: requestedBy?.name ?? "（未知）",
    requestedAt: record.requestedAt.toISOString(),
    isResponsible,
    expectedApproverLabel: expectedApprover ? expectedApprover.name : record.expectedApproverUserId === null ? "事件受理團隊的主管（LEAD）" : null,
  };
}
