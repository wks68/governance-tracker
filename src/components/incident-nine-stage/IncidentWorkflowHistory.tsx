// Incident 事件通報流程：流程歷程。查詢既有 IssueWorkflowStageHistory（與 Hotfix 完全同一張
// 表），只做「stageKey → 正式關卡名稱」的顯示正規化（沿用 incidentStage 模組現有的九階段
// 對照，不使用原始 WorkflowStage.label），不建立第二套歷程資料模型。範圍收斂：本輪不含
// Hotfix CumulativeWorkflowContext.tsx 的建立聚合／技術明細收合，之後如需要可再擴充。

import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/datetime";
import WorkflowHistoryTimeline, { type WorkflowHistoryEntry } from "@/components/hotfix-nine-stage/WorkflowHistoryTimeline";
import { incidentNineStageIndexOfStageKey, incidentNineStageLabelOfIndex } from "@/lib/incident-ui/incidentStage";

function stageDisplayLabel(stageKey: string): string {
  const index = incidentNineStageIndexOfStageKey(stageKey);
  return index !== null ? incidentNineStageLabelOfIndex(index) : stageKey;
}

const TRANSITION_VERB: Record<string, string> = {
  FORWARDED: "推進至",
  RETURNED: "退回至",
  CANCELLED: "取消，轉入",
};

export default async function IncidentWorkflowHistory({ issueId }: { issueId: string }) {
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
