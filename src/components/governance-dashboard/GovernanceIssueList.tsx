// 治理儀表板 MVP 新增：下鑽清單（Plan 第二節第 8 項）。
//
// 顯示 Issue key、標題、流程、目前階段、Team、停留時間、風險、待核准狀態。本清單與
// 頁面上方所有卡片共用同一份「已套用目前篩選條件」的 rows（見 viewModel.ts），因此
// KPI／Stage／Team／風險卡片顯示的數字與本清單筆數必然一致。

import Link from "next/link";
import type { GovernanceIssueRow } from "@/lib/governance-dashboard/types";
import { LIFECYCLE_STATUS_LABEL, RISK_STATUS_LABEL, RISK_STATUS_TONE } from "@/lib/governance-dashboard/labels";

export default function GovernanceIssueList({ issues }: { issues: GovernanceIssueRow[] }) {
  if (issues.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        目前沒有符合篩選條件的案件。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">工單編號</th>
            <th className="px-3 py-2">標題</th>
            <th className="px-3 py-2">流程</th>
            <th className="px-3 py-2">狀態</th>
            <th className="px-3 py-2">目前階段</th>
            <th className="px-3 py-2">Team</th>
            <th className="px-3 py-2">停留時間</th>
            <th className="px-3 py-2">風險</th>
            <th className="px-3 py-2">待核准</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {issues.map((issue) => (
            <tr key={issue.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2">
                <Link href={`/issues/${issue.id}`} className="font-medium text-primary hover:underline">
                  {issue.issueKey}
                </Link>
              </td>
              <td className="max-w-[220px] truncate px-3 py-2 text-gray-800">{issue.title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.workflowDefinition?.name ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{LIFECYCLE_STATUS_LABEL[issue.lifecycleStatus]}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.currentStage?.label ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.assignedTeamName ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                {issue.dwellDays !== null ? `${issue.dwellDays} 天` : "—"}
              </td>
              <td className={`whitespace-nowrap px-3 py-2 font-medium ${RISK_STATUS_TONE[issue.riskStatus]}`}>
                {RISK_STATUS_LABEL[issue.riskStatus]}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.pendingApproval ? "是" : "否"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
