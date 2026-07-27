// 治理儀表板 MVP 新增：Team 負載（Plan 第二節第 6 項）。

import Link from "next/link";
import EmptyDashboardState from "./EmptyDashboardState";
import { withGovernanceFilterOverride } from "@/lib/governance-dashboard/filters";
import type { GovernanceDashboardFilters, GovernanceTeamWorkloadEntry, StaleDaysOption } from "@/lib/governance-dashboard/types";

export default function TeamWorkloadTable({
  entries,
  filters,
  staleDaysThreshold,
}: {
  entries: GovernanceTeamWorkloadEntry[];
  filters: GovernanceDashboardFilters;
  staleDaysThreshold: StaleDaysOption;
}) {
  if (entries.length === 0) {
    return <EmptyDashboardState message="目前沒有已指派 Team 的案件。" />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">Team</th>
            <th className="px-3 py-2">進行中案件</th>
            <th className="px-3 py-2">待核准案件</th>
            <th className="px-3 py-2">停留超過門檻案件</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <tr key={entry.teamId} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{entry.teamName}</td>
              <td className="whitespace-nowrap px-3 py-2">
                <Link
                  href={withGovernanceFilterOverride(filters, { teamId: entry.teamId, lifecycleStatus: "IN_PROGRESS" })}
                  className="text-primary hover:underline"
                >
                  {entry.inProgress} 件
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <Link
                  href={withGovernanceFilterOverride(filters, { teamId: entry.teamId, pendingApprovalOnly: true })}
                  className="text-primary hover:underline"
                >
                  {entry.pendingApproval} 件
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <Link
                  href={withGovernanceFilterOverride(filters, { teamId: entry.teamId, staleDaysThreshold })}
                  className="text-gov-yellow hover:underline"
                >
                  {entry.stale} 件
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
