// 治理儀表板 MVP 新增：最近異常（Plan 第二節第 7 項）。

import Link from "next/link";
import type { GovernanceIssueRow, GovernanceRecentExceptions as RecentExceptionsData } from "@/lib/governance-dashboard/types";

function ExceptionColumn({ title, issues, toneClass }: { title: string; issues: GovernanceIssueRow[]; toneClass: string }) {
  return (
    <div>
      <h3 className={`mb-2 text-sm font-semibold ${toneClass}`}>
        {title}（{issues.length}）
      </h3>
      {issues.length === 0 ? (
        <p className="text-sm text-gray-400">目前無此類異常。</p>
      ) : (
        <ul className="space-y-1.5">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Link
                href={`/issues/${issue.id}`}
                className="block rounded-md border border-gray-200 p-2 text-sm hover:border-primary hover:bg-gray-50"
              >
                <span className="font-medium text-gray-800">{issue.issueKey}</span>
                <span className="ml-1.5 text-gray-500">{issue.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RecentExceptions({ exceptions }: { exceptions: RecentExceptionsData }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <ExceptionColumn title="高風險" issues={exceptions.highRisk} toneClass="text-gov-red" />
      <ExceptionColumn title="Risk UNKNOWN" issues={exceptions.riskUnknown} toneClass="text-gov-yellow" />
      <ExceptionColumn title="待核准" issues={exceptions.pendingApproval} toneClass="text-gov-blue" />
      <ExceptionColumn title="重複 RETURN" issues={exceptions.repeatedReturn} toneClass="text-gov-red" />
      <ExceptionColumn title="CANCELLED" issues={exceptions.cancelled} toneClass="text-gov-gray" />
      <ExceptionColumn title="長時間停留" issues={exceptions.longDwelling} toneClass="text-gov-yellow" />
    </div>
  );
}
