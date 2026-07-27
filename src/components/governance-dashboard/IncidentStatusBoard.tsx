// 治理儀表板第四輪：事件通報狀態（四區塊版型 C 區）。
//
// 目前 Incident 這個 issueType 尚未有新版 Workflow，「目前階段」一律用既有 legacy
// 模型的顯示標籤（queries.ts 的 preWorkflowStatusLabel，沿用 src/lib/workflow.ts 既有
// 步驟名稱，不是本模組自創）。沒有正式 SLA 欄位，只顯示「已處理時間」（依 dwellDays
// 換算，不得顯示成不存在的 SLA 倒數）。

import Link from "next/link";
import type { GovernanceIssueRow } from "@/lib/governance-dashboard/types";

export default function IncidentStatusBoard({ entries }: { entries: GovernanceIssueRow[] }) {
  return (
    <div id="incident-board" className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold text-gray-600">事件通報狀態</h3>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-400">
          目前沒有處理中的事件通報。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500">
                <th className="px-2 py-1.5">事件編號</th>
                <th className="px-2 py-1.5">系統</th>
                <th className="px-2 py-1.5">分級</th>
                <th className="px-2 py-1.5">目前階段</th>
                <th className="px-2 py-1.5">已處理時間</th>
                <th className="px-2 py-1.5">責任人／單位</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <Link href={`/issues/${row.id}`} className="font-medium text-primary hover:underline">
                      {row.issueKey}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-gray-600">{row.systemName ?? "—"}</td>
                  <td className="px-2 py-1.5 text-gray-600">{row.priority ?? "—"}</td>
                  <td className="px-2 py-1.5 text-gray-600">{row.currentStage?.label ?? row.preWorkflowStatusLabel ?? "—"}</td>
                  <td className="px-2 py-1.5 text-gray-600">{row.dwellDays !== null ? `${row.dwellDays} 天` : "—"}</td>
                  <td className="px-2 py-1.5 text-gray-600">{row.ownerName ?? row.assignedTeamName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 text-right">
        <Link href="/issues?issueType=Incident" className="text-xs text-gray-400 underline hover:text-primary">
          查看全部事件
        </Link>
      </div>
    </div>
  );
}
