// RCA 流程：詳情頁共用的資料組裝層，比照 src/lib/incident-ui/pageContext.ts 既有慣例（只做
// 唯讀查詢＋組裝 ViewModel，不做任何寫入、不構成授權邊界）。底層沿用完全相同的通用引擎
// （getIssueWorkflowRuntime／getEligibleApproverUserIds）。

import { prisma } from "../prisma";
import { getIssueWorkflowRuntime, type IssueWorkflowRuntime } from "../workflowExecutionService";
import { getEligibleApproverUserIds } from "../approvalService";
import { rcaStageIndexOfStageKey } from "./rcaStage";
import { RCA_OWNER_FIELD_KEY, readRcaField } from "../workflow-execution/rcaAssignmentService";
import {
  RCA_SOURCE_INCIDENT_KEY_FIELD,
  RCA_SOURCE_INCIDENT_NAME_FIELD,
  RCA_SOURCE_INCIDENT_SEVERITY_FIELD,
  RCA_SOURCE_INCIDENT_SUMMARY_FIELD,
} from "./rcaCreation";
import type { Issue, User } from "@prisma/client";

export class RcaPageNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RcaPageNotApplicableError";
  }
}

export interface RcaTicketBasicInfoData {
  issueKey: string;
  title: string;
  description: string;
  systemName: string;
  environment: string;
  responsibleTeamName: string | null;
  ownerName: string | null;
  sourceIncidentKey: string | null;
  sourceIncidentName: string | null;
  sourceIncidentSeverity: string | null;
  sourceIncidentSummary: string | null;
}

export interface RcaPageContext {
  issue: Issue;
  actor: User;
  runtime: Extract<IssueWorkflowRuntime, { onVersionedWorkflow: true }>;
  stageIndex: number | null;
  ticketBasicInfo: RcaTicketBasicInfoData;
}

export async function loadRcaPageContext(issueId: string, actor: User): Promise<RcaPageContext> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new RcaPageNotApplicableError("找不到此工單");
  if (issue.issueType !== "RCA") throw new RcaPageNotApplicableError("此工單不是 RCA 類型");

  const runtime = await getIssueWorkflowRuntime(issueId, actor.id);
  if (!runtime.onVersionedWorkflow) {
    throw new RcaPageNotApplicableError("此 RCA 工單尚未啟動 Workflow 引擎");
  }

  const stageIndex = rcaStageIndexOfStageKey(runtime.currentStage.stageKey);

  const [team, ownerUserId, fieldRows] = await Promise.all([
    issue.assignedTeamId ? prisma.team.findUnique({ where: { id: issue.assignedTeamId } }) : Promise.resolve(null),
    readRcaField(prisma, issueId, RCA_OWNER_FIELD_KEY),
    prisma.issueFieldValue.findMany({
      where: { issueId, fieldKey: { in: [RCA_SOURCE_INCIDENT_KEY_FIELD, RCA_SOURCE_INCIDENT_NAME_FIELD, RCA_SOURCE_INCIDENT_SEVERITY_FIELD, RCA_SOURCE_INCIDENT_SUMMARY_FIELD] } },
    }),
  ]);
  const ownerUser = ownerUserId ? await prisma.user.findUnique({ where: { id: ownerUserId } }) : null;
  const fieldByKey = new Map(fieldRows.map((row) => [row.fieldKey, row.fieldValue]));

  const ticketBasicInfo: RcaTicketBasicInfoData = {
    issueKey: issue.issueKey,
    title: issue.title,
    description: issue.description,
    systemName: issue.systemName,
    environment: issue.environment,
    responsibleTeamName: team?.name ?? null,
    ownerName: ownerUser?.name ?? null,
    sourceIncidentKey: fieldByKey.get(RCA_SOURCE_INCIDENT_KEY_FIELD) ?? null,
    sourceIncidentName: fieldByKey.get(RCA_SOURCE_INCIDENT_NAME_FIELD) ?? null,
    sourceIncidentSeverity: fieldByKey.get(RCA_SOURCE_INCIDENT_SEVERITY_FIELD) ?? null,
    sourceIncidentSummary: fieldByKey.get(RCA_SOURCE_INCIDENT_SUMMARY_FIELD) ?? null,
  };

  return { issue, actor, runtime, stageIndex, ticketBasicInfo };
}

export interface RcaApprovalReviewViewData {
  approvalRecordId: string;
  approvalType: string;
  requestedByName: string;
  requestedAt: string;
  isResponsible: boolean;
  expectedApproverLabel: string | null;
}

// 比照 incident-ui/pageContext.ts 的 buildIncidentApprovalReviewViewData，服務
// pendingTechnicalReview／pendingSecurityIntegrityReview／pendingVerificationConfirmation／
// pendingRcaClosureConfirmation 四個「同一時間只會有一筆待決 ApprovalRecord」的關卡。
// pendingManagementConfirmation（可能先後有副部長／部長兩筆）另有專屬邏輯，見
// buildRcaManagementConfirmationViewData，不使用本函式。
export async function buildRcaApprovalReviewViewData(ctx: RcaPageContext): Promise<RcaApprovalReviewViewData | null> {
  const record = ctx.runtime.pendingApproval;
  if (!record || record.relatedStageKey === "pendingManagementConfirmation") return null;

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
    approvalType: record.approvalType,
    requestedByName: requestedBy?.name ?? "（未知）",
    requestedAt: record.requestedAt.toISOString(),
    isResponsible,
    expectedApproverLabel: expectedApprover ? expectedApprover.name : record.expectedApproverUserId === null ? "負責單位主管" : null,
  };
}

export interface RcaManagementConfirmationViewData {
  vp: RcaApprovalReviewViewData | null;
  director: RcaApprovalReviewViewData | null;
}

async function toReviewViewData(record: NonNullable<Awaited<ReturnType<typeof prisma.approvalRecord.findFirst>>>, actor: User): Promise<RcaApprovalReviewViewData> {
  const [requestedBy, expectedApprover] = await Promise.all([
    prisma.user.findUnique({ where: { id: record.requestedByUserId } }),
    record.expectedApproverUserId ? prisma.user.findUnique({ where: { id: record.expectedApproverUserId } }) : Promise.resolve(null),
  ]);
  let isResponsible: boolean;
  if (record.decision !== "PENDING") {
    isResponsible = false;
  } else if (record.expectedApproverUserId !== null) {
    isResponsible = record.expectedApproverUserId === actor.id;
  } else {
    const eligibleApprovers = await getEligibleApproverUserIds(record);
    isResponsible = eligibleApprovers.includes(actor.id) && actor.id !== record.requestedByUserId;
  }
  return {
    approvalRecordId: record.id,
    approvalType: record.approvalType,
    requestedByName: requestedBy?.name ?? "（未知）",
    requestedAt: record.requestedAt.toISOString(),
    isResponsible,
    expectedApproverLabel: expectedApprover?.name ?? (record.approvalType === "RCA_DIRECTOR_APPROVAL" ? "DMS 部長" : "DMS 副部長"),
  };
}

export async function buildRcaManagementConfirmationViewData(ctx: RcaPageContext): Promise<RcaManagementConfirmationViewData | null> {
  if (ctx.runtime.currentStage.stageKey !== "pendingManagementConfirmation") return null;
  const [vpRecord, directorRecord] = await Promise.all([
    prisma.approvalRecord.findFirst({ where: { issueId: ctx.issue.id, approvalType: "RCA_VP_CONFIRMATION", relatedStageKey: "pendingManagementConfirmation" }, orderBy: { revisionNo: "desc" } }),
    prisma.approvalRecord.findFirst({ where: { issueId: ctx.issue.id, approvalType: "RCA_DIRECTOR_APPROVAL", relatedStageKey: "pendingManagementConfirmation" }, orderBy: { revisionNo: "desc" } }),
  ]);
  return {
    vp: vpRecord ? await toReviewViewData(vpRecord, ctx.actor) : null,
    director: directorRecord ? await toReviewViewData(directorRecord, ctx.actor) : null,
  };
}
