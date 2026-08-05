// RCA 逾期狀態唯一正式判斷來源：以 RcaActionItem 逐筆的 plannedCompletionDate／status 為準，
// 不得用 Issue.dueDate 近似（RCA Issue 本身通常不會填 dueDate）。
//
// 逾期定義：至少一筆 RcaActionItem 符合
//   plannedCompletionDate < now
//   且 status 不是 COMPLETED
//   且 status 不是 RISK_EXCEPTION（風險例外視為已有正式覆蓋，不計入逾期）
//
// 清單頁與統計卡必須呼叫同一個函式、同一次查詢結果，不得各自重算出不同答案。
// 一次查詢全部 RcaActionItem 後在記憶體依 rcaIssueId 分組，避免對每筆 RCA 各自查一次
// （N+1）。

import { prisma } from "../prisma";

export interface RcaOverdueSummary {
  rcaIssueId: string;
  isOverdue: boolean;
  overdueCount: number;
  earliestOverdueDate: string | null;
  latestPlannedDate: string | null;
  completedCount: number;
  totalCount: number;
}

function emptySummary(rcaIssueId: string): RcaOverdueSummary {
  return { rcaIssueId, isOverdue: false, overdueCount: 0, earliestOverdueDate: null, latestPlannedDate: null, completedCount: 0, totalCount: 0 };
}

export async function loadRcaOverdueSummaries(rcaIssueIds: readonly string[], now: Date = new Date()): Promise<Map<string, RcaOverdueSummary>> {
  const result = new Map<string, RcaOverdueSummary>();
  for (const id of rcaIssueIds) result.set(id, emptySummary(id));
  if (rcaIssueIds.length === 0) return result;

  const items = await prisma.rcaActionItem.findMany({
    where: { rcaIssueId: { in: [...rcaIssueIds] } },
    select: { rcaIssueId: true, plannedCompletionDate: true, status: true },
  });

  for (const item of items) {
    const summary = result.get(item.rcaIssueId);
    if (!summary) continue;
    summary.totalCount += 1;
    if (item.status === "COMPLETED") summary.completedCount += 1;
    if (!item.plannedCompletionDate) continue;
    const planned = item.plannedCompletionDate;
    if (!summary.latestPlannedDate || planned.getTime() > new Date(summary.latestPlannedDate).getTime()) {
      summary.latestPlannedDate = planned.toISOString();
    }
    const isItemOverdue = planned.getTime() < now.getTime() && item.status !== "COMPLETED" && item.status !== "RISK_EXCEPTION";
    if (isItemOverdue) {
      summary.overdueCount += 1;
      summary.isOverdue = true;
      if (!summary.earliestOverdueDate || planned.getTime() < new Date(summary.earliestOverdueDate).getTime()) {
        summary.earliestOverdueDate = planned.toISOString();
      }
    }
  }

  return result;
}

export async function loadRcaOverdueSummary(rcaIssueId: string, now: Date = new Date()): Promise<RcaOverdueSummary> {
  const map = await loadRcaOverdueSummaries([rcaIssueId], now);
  return map.get(rcaIssueId) ?? emptySummary(rcaIssueId);
}
