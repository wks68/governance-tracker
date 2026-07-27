// 治理儀表板 MVP 新增：RETURN 監控（Plan 第二節第 5 項）。

import Link from "next/link";
import EmptyDashboardState from "./EmptyDashboardState";
import { withGovernanceFilterOverride } from "@/lib/governance-dashboard/filters";
import type { GovernanceDashboardFilters, GovernanceReturnOverview as ReturnOverviewData } from "@/lib/governance-dashboard/types";

export default function ReturnOverview({
  overview,
  filters,
}: {
  overview: ReturnOverviewData;
  filters: GovernanceDashboardFilters;
}) {
  if (overview.totalReturns === 0) {
    return <EmptyDashboardState message="目前沒有 RETURN 紀錄。" />;
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href={withGovernanceFilterOverride(filters, { returnOnly: true })}
          className="block rounded-md border border-gray-200 p-3 hover:border-primary"
        >
          <div className="text-sm text-gray-500">有 RETURN 紀錄的案件</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{overview.issuesWithReturn}</div>
        </Link>
        <div className="rounded-md border border-gray-200 p-3">
          <div className="text-sm text-gray-500">RETURN 總次數</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{overview.totalReturns}</div>
        </div>
        <Link
          href={withGovernanceFilterOverride(filters, { repeatedReturnOnly: true })}
          className="block rounded-md border border-gray-200 p-3 hover:border-primary"
        >
          <div className="text-sm text-gray-500">重複 RETURN 案件</div>
          <div className="mt-1 text-xl font-semibold text-gov-red">{overview.repeatedReturnIssues}</div>
        </Link>
      </div>

      {overview.topReturnStages.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-gray-500">主要退回關卡</div>
          <ul className="space-y-1 text-sm">
            {overview.topReturnStages.map((s) => (
              <li key={s.stageId} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-gray-50">
                <span className="text-gray-700">{s.stageLabel}</span>
                <span className="text-gray-500">{s.count} 次</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
