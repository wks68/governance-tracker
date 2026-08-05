// RCA 流程：流程歷程，比照 src/components/incident-nine-stage/IncidentWorkflowHistory.tsx
// 既有慣例，查詢同一張 IssueWorkflowStageHistory，只做 stageKey → 正式關卡名稱正規化。

import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/datetime";
import WorkflowHistoryTimeline, { type WorkflowHistoryEntry } from "@/components/hotfix-nine-stage/WorkflowHistoryTimeline";
import { rcaStageIndexOfStageKey, rcaStageLabelOfIndex } from "@/lib/rca-ui/rcaStage";

function stageDisplayLabel(stageKey: string): string {
  const index = rcaStageIndexOfStageKey(stageKey);
  return index !== null ? rcaStageLabelOfIndex(index) : stageKey;
}

const TRANSITION_VERB: Record<string, string> = {
  FORWARDED: "推進至",
  RETURNED: "退回至",
  CANCELLED: "取消，轉入",
};

export default async function RcaWorkflowHistory({ issueId }: { issueId: string }) {
  const rows = await prisma.issueWorkflowStageHistory.findMany({
    where: { issueId },
    orderBy: { executedAt: "desc" },
    include: { fromStage: true, toStage: true },
  });
  if (rows.length === 0) return null;

  const actorIds = Array.from(new Set(rows.map((row) => row.actorUserId)));
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } } }) : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));

  const entries: WorkflowHistoryEntry[] = rows.map((row) => {
    const actorName = actorNames.get(row.actorUserId) ?? "系統使用者";
    const verb = TRANSITION_VERB[row.transitionType] ?? "更新至";
    const fromLabel = row.fromStage ? stageDisplayLabel(row.fromStage.stageKey) : null;
    const toLabel = stageDisplayLabel(row.toStage.stageKey);
    return {
      id: row.id,
      primary: `${actorName} ${verb}「${toLabel}」`,
      meta: `${formatDateTime(row.executedAt)} · ${actorName}`,
      detail: [fromLabel ? `${fromLabel} → ${toLabel}` : `進入 ${toLabel}`, row.reasonCode ? `原因／意見：${row.reasonCode}` : null].filter(Boolean).join("\n"),
      technical: [],
    };
  });

  return <WorkflowHistoryTimeline entries={entries} />;
}
