// 治理儀表板第四輪：RCA／改善追蹤（四區塊版型 B 區）。
//
// 目前資料模型只有 RCA 這個 issueType、沒有正式 CAPA（根因分類／改善措施／責任人／
// 預計完成日皆非既有欄位）——只顯示既有欄位（工單編號／標題／責任人／預計完成日），
// 沒有欄位的一律顯示「—」，不發明假資料。狀態依現有欄位可靠推導：已完成／已超過
// 預計日期／進行中，「未開始」「待確認」在目前資料模型下無法可靠區分，不強行硬湊。

import Link from "next/link";
import type { GovernanceIssueRow } from "@/lib/governance-dashboard/types";

function deriveRcaStatus(row: GovernanceIssueRow): { label: string; tone: string } {
  if (row.lifecycleStatus === "COMPLETED") return { label: "已完成", tone: "text-gov-green" };
  if (row.lifecycleStatus === "CANCELLED") return { label: "已完成", tone: "text-gov-green" };
  if (row.dueDate && row.dueDate.getTime() < Date.now()) return { label: "已超過預計日期", tone: "text-gov-red" };
  return { label: "進行中", tone: "text-gov-blue" };
}

export default function RcaCapaTracker({ entries }: { entries: GovernanceIssueRow[] }) {
  return (
    <div id="rca-tracker" className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold text-gray-600">RCA／改善追蹤</h3>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-400">
          目前沒有進行中的 RCA 案件。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500">
                <th className="px-2 py-1.5">事件／問題</th>
                <th className="px-2 py-1.5">根因分類</th>
                <th className="px-2 py-1.5">改善措施</th>
                <th className="px-2 py-1.5">責任人</th>
                <th className="px-2 py-1.5">預計完成日</th>
                <th className="px-2 py-1.5">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((row) => {
                const status = deriveRcaStatus(row);
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="max-w-[220px] truncate px-2 py-1.5">
                      <Link href={`/issues/${row.id}`} className="font-medium text-primary hover:underline">
                        {row.issueKey}
                      </Link>
                      <span className="ml-1.5 text-gray-600">{row.title}</span>
                    </td>
                    <td className="px-2 py-1.5 text-gray-400">—</td>
                    <td className="px-2 py-1.5 text-gray-400">—</td>
                    <td className="px-2 py-1.5 text-gray-600">{row.ownerName ?? "—"}</td>
                    <td className="px-2 py-1.5 text-gray-600">{row.dueDate ? row.dueDate.toISOString().slice(0, 10) : "—"}</td>
                    <td className={`px-2 py-1.5 font-medium ${status.tone}`}>{status.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 text-right">
        <Link href="/issues?issueType=RCA" className="text-xs text-gray-400 underline hover:text-primary">
          查看全部 RCA
        </Link>
      </div>
    </div>
  );
}
