import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/datetime";
import {
  RD_FIX_FIELDS,
  QA_VERIFY_FIELDS,
  OP_DEPLOY_FIELDS,
  OP_RESULT_FIELDS,
  displayExecutionValue,
  type ExecutionFieldDef,
} from "@/lib/hotfix-ui/executionFields";
import type { HotfixPageContext } from "@/lib/hotfix-ui/pageContext";
import WorkflowHistoryTimeline, { type WorkflowHistoryEntry } from "./WorkflowHistoryTimeline";
import { getHistoryPlainText, isRichTextValue } from "@/lib/rich-text/value";

const APPROVAL_LABELS: Record<string, string> = {
  pendingBusinessApproval: "申請人直屬主管簽核",
  pendingRdLeadApproval: "RD 主管簽核",
  pendingQaLeadApproval: "QA 主管簽核",
  pendingDeploymentApproval: "OP 上版前確認",
  opCompleted: "OP 主管上版後確認",
};

const FIELD_DEFS: Record<string, readonly ExecutionFieldDef[]> = {
  pendingRdLeadApproval: RD_FIX_FIELDS,
  pendingQaLeadApproval: QA_VERIFY_FIELDS,
  pendingDeploymentApproval: OP_DEPLOY_FIELDS,
  opCompleted: OP_RESULT_FIELDS,
};

function decisionLabel(decision: string): string {
  if (decision === "APPROVED") return "同意";
  if (decision === "REJECTED") return "駁回";
  if (decision === "CANCELLED") return "取消";
  return "等待核准";
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  IssueCreated: "建立工單",
  IssueWorkflowStarted: "啟動簽核流程",
  StatusChange: "更新流程狀態",
  IssueClaimedByTeam: "承接目前關卡",
  IssueExecutorAssigned: "指派執行人",
  IssueExecutorReassigned: "重新指派執行人",
  FieldChange: "更新工作內容",
  ApprovalRequested: "送出簽核",
  ApprovalApproved: "完成簽核",
  IssueWorkflowAdvanced: "推進流程",
  IssueWorkflowStageCompleted: "完成流程",
  SUBMIT_FOR_APPROVAL: "送出主管簽核",
  PREVIEW_SUBMIT: "送出主管簽核",
  ASSIGN_EXECUTOR: "指派執行人",
};

function parseFieldChanges(summary: string): Array<{ label: string; before: string; after: string }> {
  const source = summary.replace(/^更新欄位：/, "");
  const changes: Array<{ label: string; before: string; after: string }> = [];
  const pattern = /([^：；]+)：「([\s\S]*?)」→「([\s\S]*?)」(?=；[^：；]+：「|$)/g;
  for (const match of source.matchAll(pattern)) {
    changes.push({
      label: getHistoryPlainText(match[1]) || "欄位異動",
      before: getHistoryPlainText(match[2]) || "（空白）",
      after: getHistoryPlainText(match[3]) || "（空白）",
    });
  }
  return changes;
}

function readSnapshot(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as { values?: Record<string, unknown> };
    if (!parsed.values || typeof parsed.values !== "object") return {};
    return Object.fromEntries(Object.entries(parsed.values).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export default async function CumulativeWorkflowContext({ ctx, legacyIssueId }: { ctx?: HotfixPageContext; legacyIssueId?: string }) {
  const issueId = ctx?.issue.id ?? legacyIssueId;
  if (!issueId) return null;

  const [issue, records, snapshots, history, auditEvents] = await Promise.all([
    prisma.issue.findUnique({
      where: { id: issueId },
      include: { assignedTeam: true, currentWorkflowStage: true },
    }),
    prisma.approvalRecord.findMany({
      where: { issueId },
      orderBy: [{ requestedAt: "asc" }, { revisionNo: "asc" }],
      include: { requestedBy: true, approver: true, approverTeam: true },
    }),
    prisma.issueFieldValue.findMany({ where: { issueId } }),
    prisma.issueWorkflowStageHistory.findMany({
      where: { issueId },
      orderBy: { executedAt: "asc" },
      include: { fromStage: true, toStage: true, assignedTeamAfter: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: "Issue", entityId: issueId },
      orderBy: { createdAt: "asc" },
      include: { actor: true },
    }),
  ]);
  if (!issue) return null;

  const actorIds = Array.from(new Set(history.map((row) => row.actorUserId)));
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } } }) : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  const snapshotByRecord = new Map<string, Record<string, string>>();
  const currentValues = Object.fromEntries(
    snapshots.filter((row) => !row.fieldKey.startsWith("workflowSubmission:")).map((row) => [row.fieldKey, row.fieldValue]),
  );
  for (const row of snapshots.filter((item) => item.fieldKey.startsWith("workflowSubmission:"))) {
    const recordId = row.fieldKey.split(":").at(-1);
    if (recordId) snapshotByRecord.set(recordId, readSnapshot(row.fieldValue));
  }

  const timeline: Array<WorkflowHistoryEntry & { timestamp: number }> = [];
  for (const record of records) {
    const stageLabel = APPROVAL_LABELS[record.relatedStageKey] ?? "主管簽核";
    const actorName = record.approver?.name ?? record.requestedBy.name;
    const teamName = record.approverTeam?.name ?? issue.assignedTeam?.name ?? "尚未指派";
    const values = snapshotByRecord.get(record.id) ?? currentValues;
    const detailFields = (FIELD_DEFS[record.relatedStageKey] ?? []).filter((field) => values[field.key]?.trim());
    const detailParts = detailFields.filter((field) => !field.richText).map((field) => `${field.label}：${displayExecutionValue(values[field.key])}`);
    const richDetails = detailFields.filter((field) => field.richText).map((field) => ({
      label: field.label,
      value: isRichTextValue(values[field.key]) ? values[field.key] : getHistoryPlainText(values[field.key]),
    }));
    if (record.decisionComment?.trim()) detailParts.unshift(`簽核意見：${record.decisionComment.trim()}`);
    const happenedAt = record.decidedAt ?? record.requestedAt;
    timeline.push({
      id: `approval-${record.id}`,
      timestamp: happenedAt.getTime(),
      primary: `Hotfix（${issue.issueKey}）「${issue.title}」執行「${stageLabel}－${decisionLabel(record.decision)}」，執行人：${actorName}，團隊：${teamName}，流程階段：${stageLabel}。`,
      meta: `${formatDateTime(happenedAt)} · ${actorName}`,
      technicalCode: `APPROVAL_${record.decision}`,
      detail: getHistoryPlainText(detailParts.join("\n")) || null,
      richDetails,
    });
  }

  for (const row of history) {
    const actorName = actorNames.get(row.actorUserId) ?? "系統使用者";
    const teamName = row.assignedTeamAfter?.name ?? issue.assignedTeam?.name ?? "尚未指派";
    const action = row.fromStage ? `${row.fromStage.label}前往${row.toStage.label}` : `進入${row.toStage.label}`;
    timeline.push({
      id: `history-${row.id}`,
      timestamp: row.executedAt.getTime(),
      primary: `Hotfix（${issue.issueKey}）「${issue.title}」執行「${action}」，執行人：${actorName}，團隊：${teamName}，流程階段：${row.toStage.label}。`,
      meta: `${formatDateTime(row.executedAt)} · ${actorName}`,
      technicalCode: row.reasonCode || row.transitionType,
    });
  }

  for (const event of auditEvents) {
    const stageEntry = [...history].reverse().find((row) => row.executedAt <= event.createdAt);
    const stageLabel = stageEntry?.toStage.label ?? issue.currentWorkflowStage?.label ?? "Hotfix 建立工單";
    const teamName = stageEntry?.assignedTeamAfter?.name ?? issue.assignedTeam?.name ?? "尚未指派";
    const actionLabel = AUDIT_ACTION_LABELS[event.actionType] ?? "更新工單紀錄";
    const fieldChanges = event.actionType === "FieldChange" ? parseFieldChanges(event.summary) : [];
    timeline.push({
      id: `event-${event.id}`,
      timestamp: event.createdAt.getTime(),
      primary: `Hotfix（${issue.issueKey}）「${issue.title}」執行「${actionLabel}」，執行人：${event.actor?.name ?? "系統"}，團隊：${teamName}，流程階段：${stageLabel}。`,
      meta: `${formatDateTime(event.createdAt)} · ${event.actor?.name ?? "系統"}`,
      technicalCode: event.reasonCode || event.actionType,
      detail: fieldChanges.length ? null : getHistoryPlainText(event.summary),
      fieldChanges,
    });
  }

  const entries = timeline.sort((left, right) => right.timestamp - left.timestamp).map(({ timestamp: _timestamp, ...entry }) => entry);
  return <WorkflowHistoryTimeline entries={entries} />;
}
