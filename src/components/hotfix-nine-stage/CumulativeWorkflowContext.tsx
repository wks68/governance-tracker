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

// 建立 Hotfix 當下（同一個 transaction）一律連續寫入這幾種技術紀錄：IssueCreated（建立
// 工單）→ ISSUE_CREATED_AUTO_START（啟動流程）→ HOTFIX_TICKET_SUBMITTED（自動推進到第 2
// 關）。畫面上這些純屬「建立並送出」这一個業務動作的技術副產物，不應各自成一筆歷程。
// 只依「同一 actor＋同一組已知技術代碼＋時間緊鄰」聚合，不相關事件（例如日後的 RD／QA／OP
// 簽核）技術代碼不在此集合內，時間也相差甚遠，不會被誤併。
const CREATION_CHAIN_CODES = new Set(["IssueCreated", "ISSUE_CREATED_AUTO_START", "HOTFIX_TICKET_SUBMITTED"]);
const CREATION_CLUSTER_WINDOW_MS = 5 * 60 * 1000;

interface RawTimelineEntry {
  id: string;
  timestamp: number;
  actorId: string | null;
  actorName: string;
  stageLabel: string;
  technicalCode: string;
  technicalLabel: string;
  primary: string;
  meta: string;
  detail?: string | null;
  richDetails?: Array<{ label: string; value: string }>;
  fieldChanges?: Array<{ label: string; before: string; after: string }>;
  technicalGroup?: RawTimelineEntry[];
}

// 只依真實資料語意聚合：建立工單／自動啟動流程／自動送出核准這幾個技術事件，只要確實落在
// 建立 Hotfix 這筆交易起算的短時間窗內、且是同一 actor，就視為同一個業務動作——即使實際寫入
// 順序與 timestamp 精度導致它們不是連續相鄰（例如「送出核准」的 AuditLog 可能晚於已建立的
// PENDING ApprovalRecord 才寫入），一律以「整個時間窗」逐筆判斷，不是只看開頭連續片段，
// 才不會漏併同一次交易稍後才落地的技術紀錄。時間窗外、或 actor 不同的事件一律維持原樣，不
// 相關事件（例如日後才發生的 RD／QA／OP 簽核，技術代碼相同也因時間相差甚遠而不受影響）。
// 找不到 IssueCreated 這個錨點時完全不做任何合併，維持原始歷程逐筆顯示。
function collapseCreationCluster(ascending: RawTimelineEntry[], issue: { issueKey: string; title: string }): RawTimelineEntry[] {
  if (ascending.length === 0 || ascending[0].technicalCode !== "IssueCreated") return ascending;

  const first = ascending[0];
  const windowEnd = first.timestamp + CREATION_CLUSTER_WINDOW_MS;

  const creationGroup: RawTimelineEntry[] = [];
  const stageEntryPrecursors: RawTimelineEntry[] = [];
  let approvalCandidate: RawTimelineEntry | null = null;
  const untouched: RawTimelineEntry[] = [];

  for (const item of ascending) {
    const withinWindow = item.timestamp <= windowEnd;
    if (withinWindow && item.actorId === first.actorId && CREATION_CHAIN_CODES.has(item.technicalCode)) {
      creationGroup.push(item);
      continue;
    }
    if (withinWindow && !approvalCandidate && item.id.startsWith("approval-")) {
      approvalCandidate = item;
      continue;
    }
    // 「送出核准」的 AuditLog 只是待核准紀錄本身的前導技術副本，實際狀態一律以
    // approvalCandidate（ApprovalRecord）為準；併入其技術明細，不獨立顯示成第三筆。
    if (withinWindow && item.technicalCode === "WORKFLOW_STAGE_ENTRY") {
      stageEntryPrecursors.push(item);
      continue;
    }
    untouched.push(item);
  }

  if (creationGroup.length === 0) return ascending;

  const submitted = creationGroup.some((item) => item.technicalCode === "HOTFIX_TICKET_SUBMITTED");
  const createdAtText = formatDateTime(new Date(first.timestamp));

  const creationEntry: RawTimelineEntry = {
    id: "creation-summary",
    timestamp: first.timestamp,
    actorId: first.actorId,
    actorName: first.actorName,
    stageLabel: first.stageLabel,
    technicalCode: "HOTFIX_CREATED_SUBMITTED",
    technicalLabel: submitted ? "建立並送出 Hotfix" : "建立 Hotfix",
    primary: submitted
      ? `建立並送出 Hotfix：建立者 ${first.actorName}，Hotfix 單號 ${issue.issueKey}，標題「${issue.title}」，建立時間 ${createdAtText}，已送交直屬主管簽核。`
      : `建立 Hotfix：建立者 ${first.actorName}，Hotfix 單號 ${issue.issueKey}，標題「${issue.title}」，建立時間 ${createdAtText}。`,
    meta: first.meta,
    technicalGroup: creationGroup,
  };

  const result: RawTimelineEntry[] = [creationEntry];

  if (approvalCandidate) {
    result.push({
      ...approvalCandidate,
      id: "creation-summary-approval",
      primary: `進入${approvalCandidate.stageLabel}：目前階段 ${approvalCandidate.stageLabel}，等待核准，進入時間 ${formatDateTime(new Date(approvalCandidate.timestamp))}。`,
      technicalGroup: [approvalCandidate, ...stageEntryPrecursors],
    });
  } else if (stageEntryPrecursors.length > 0) {
    creationEntry.technicalGroup = [...creationGroup, ...stageEntryPrecursors];
  }

  return [...result, ...untouched];
}

function toDisplayEntry(item: RawTimelineEntry): WorkflowHistoryEntry {
  const group = item.technicalGroup ?? [item];
  return {
    id: item.id,
    primary: item.primary,
    meta: item.meta,
    detail: item.detail ?? null,
    richDetails: item.richDetails,
    fieldChanges: item.fieldChanges,
    technical: group.map((raw) => ({
      label: raw.technicalLabel,
      code: raw.technicalCode,
      occurredAt: formatDateTime(new Date(raw.timestamp)),
      actor: raw.actorName,
      stage: raw.stageLabel,
    })),
  };
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

  const timeline: RawTimelineEntry[] = [];
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
      actorId: record.approver?.id ?? record.requestedBy.id,
      actorName,
      stageLabel,
      technicalCode: `APPROVAL_${record.decision}`,
      technicalLabel: `${stageLabel}－${decisionLabel(record.decision)}`,
      primary: `Hotfix（${issue.issueKey}）「${issue.title}」執行「${stageLabel}－${decisionLabel(record.decision)}」，執行人：${actorName}，團隊：${teamName}，流程階段：${stageLabel}。`,
      meta: `${formatDateTime(happenedAt)} · ${actorName}`,
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
      actorId: row.actorUserId,
      actorName,
      stageLabel: row.toStage.label,
      technicalCode: row.reasonCode || row.transitionType,
      technicalLabel: action,
      primary: `Hotfix（${issue.issueKey}）「${issue.title}」執行「${action}」，執行人：${actorName}，團隊：${teamName}，流程階段：${row.toStage.label}。`,
      meta: `${formatDateTime(row.executedAt)} · ${actorName}`,
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
      actorId: event.actorUserId,
      actorName: event.actor?.name ?? "系統",
      stageLabel,
      technicalCode: event.reasonCode || event.actionType,
      technicalLabel: actionLabel,
      primary: `Hotfix（${issue.issueKey}）「${issue.title}」執行「${actionLabel}」，執行人：${event.actor?.name ?? "系統"}，團隊：${teamName}，流程階段：${stageLabel}。`,
      meta: `${formatDateTime(event.createdAt)} · ${event.actor?.name ?? "系統"}`,
      detail: fieldChanges.length ? null : getHistoryPlainText(event.summary),
      fieldChanges,
    });
  }

  const ascending = timeline.sort((left, right) => left.timestamp - right.timestamp);
  const collapsed = collapseCreationCluster(ascending, issue);
  const entries = collapsed.sort((left, right) => right.timestamp - left.timestamp).map(toDisplayEntry);
  return <WorkflowHistoryTimeline entries={entries} />;
}
