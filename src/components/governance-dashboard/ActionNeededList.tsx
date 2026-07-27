// 治理儀表板 UI 收斂：現在需要處理（C 節）。首頁核心清單，讓主管一眼看出「誰要處理
// 哪一件」。列表本身已由 metrics.computeActionNeededList 依「高風險／風險待確認 >
// 待主管核准 > 停留最久 > 重複退回 > 一般進行中」排序，本元件只負責顯示。

import Link from "next/link";
import { stagePhaseOf } from "@/lib/governance-dashboard/stagePhase";
import { RISK_STATUS_LABEL, RISK_STATUS_TONE, returnBadgeLabel } from "@/lib/governance-dashboard/labels";
import { deriveSuggestedAction } from "@/lib/governance-dashboard/metrics";
import type { GovernanceIssueRow } from "@/lib/governance-dashboard/types";

export default function ActionNeededList({
  issues,
  staleDaysThreshold,
}: {
  issues: GovernanceIssueRow[];
  staleDaysThreshold: number;
}) {
  if (issues.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
        目前沒有進行中的案件需要處理。
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
            <th className="px-3 py-2">目前階段</th>
            <th className="px-3 py-2">等待角色／責任 Team</th>
            <th className="px-3 py-2">已停留時間</th>
            <th className="px-3 py-2">風險／例外</th>
            <th className="px-3 py-2">待核准狀態</th>
            <th className="px-3 py-2">建議動作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {issues.map((issue) => {
            const phase = stagePhaseOf(issue.currentStage);
            const returnBadge = returnBadgeLabel(issue);
            return (
              <tr key={issue.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/issues/${issue.id}`} className="font-medium text-primary hover:underline">
                    {issue.issueKey}
                  </Link>
                </td>
                <td className="max-w-[200px] truncate px-3 py-2 text-gray-800">{issue.title}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.currentStage?.label ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {phase ?? "—"}
                  {issue.assignedTeamName ? <span className="text-gray-400"> · {issue.assignedTeamName}</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {issue.dwellDays !== null ? `${issue.dwellDays} 天` : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={`font-medium ${RISK_STATUS_TONE[issue.riskStatus]}`}>
                    {RISK_STATUS_LABEL[issue.riskStatus]}
                  </span>
                  {returnBadge ? <span className="ml-1.5 text-xs text-gov-red">・{returnBadge}</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.pendingApproval ? "待核准" : "—"}</td>
                <td className="max-w-[200px] px-3 py-2 text-gray-700">{deriveSuggestedAction(issue, staleDaysThreshold)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
