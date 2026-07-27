// 治理儀表板 MVP 新增：目前階段分布（Plan 第二節第 2 項）。
//
// 只計入新版 Workflow「進行中」案件（ViewModel.stageDistribution 已由
// metrics.computeStageDistribution 依此規則計算），完全依實際資料動態分組，不硬編碼
// 任何 Hotfix 階段名稱。

import Link from "next/link";
import EmptyDashboardState from "./EmptyDashboardState";
import { withGovernanceFilterOverride } from "@/lib/governance-dashboard/filters";
import type { GovernanceDashboardFilters, GovernanceStageDistributionEntry } from "@/lib/governance-dashboard/types";

export default function WorkflowStageDistribution({
  entries,
  filters,
}: {
  entries: GovernanceStageDistributionEntry[];
  filters: GovernanceDashboardFilters;
}) {
  if (entries.length === 0) {
    return <EmptyDashboardState message="目前沒有新版 Workflow 進行中案件，尚無階段分布資料。" />;
  }

  const maxCount = Math.max(...entries.map((e) => e.count));

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      {entries.map((entry) => (
        <Link
          key={entry.stage.id}
          href={withGovernanceFilterOverride(filters, { stageId: entry.stage.id })}
          className="block rounded-md p-2 hover:bg-gray-50"
        >
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-800">
              {entry.stage.label}
              <span className="ml-1.5 text-xs text-gray-400">
                {entry.stage.stageType}
                {entry.stage.assignedTeamName ? ` · ${entry.stage.assignedTeamName}` : ""}
              </span>
            </span>
            <span className="text-gray-600">{entry.count} 件</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-gray-100">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max(4, (entry.count / maxCount) * 100)}%` }}
            />
          </div>
        </Link>
      ))}
    </div>
  );
}
