// 治理儀表板 MVP 新增：流程瓶頸（Plan 第二節第 4 項）。
//
// 系統沒有正式 SLA 欄位，一律稱「停留超過 X 天」，不得稱「逾期」。天數一律來自
// IssueWorkflowStageHistory 目前開放列推算（見 queries.ts），不使用 workflowStatus
// 或 Issue.stageEnteredAt。

import Link from "next/link";
import clsx from "clsx";
import EmptyDashboardState from "./EmptyDashboardState";
import { withGovernanceFilterOverride } from "@/lib/governance-dashboard/filters";
import { STALE_DAYS_OPTIONS } from "@/lib/governance-dashboard/types";
import type { GovernanceBottleneckSummary, GovernanceDashboardFilters } from "@/lib/governance-dashboard/types";

export default function BottleneckList({
  bottleneck,
  filters,
}: {
  bottleneck: GovernanceBottleneckSummary;
  filters: GovernanceDashboardFilters;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-700">停留超過：</span>
        {STALE_DAYS_OPTIONS.map((days) => (
          <Link
            key={days}
            href={withGovernanceFilterOverride(filters, { staleDaysThreshold: days })}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs font-medium",
              filters.staleDaysThreshold === days
                ? "border-primary bg-primary text-white"
                : "border-gray-300 text-gray-600 hover:border-primary hover:text-primary",
            )}
          >
            {days} 天（{bottleneck.thresholdCounts[days]} 件）
          </Link>
        ))}
      </div>

      {bottleneck.longestDwelling.length === 0 ? (
        <EmptyDashboardState message="目前沒有可計算停留時間的進行中案件。" />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500">
                <th className="px-3 py-2">工單編號</th>
                <th className="px-3 py-2">標題</th>
                <th className="px-3 py-2">目前關卡</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">停留天數</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bottleneck.longestDwelling.map((issue) => (
                <tr key={issue.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link href={`/issues/${issue.id}`} className="font-medium text-primary hover:underline">
                      {issue.issueKey}
                    </Link>
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-gray-800">{issue.title}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.currentStage?.label ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.assignedTeamName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-gov-yellow">{issue.dwellDays} 天</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
