import Link from "next/link";
import StatusBadge from "./StatusBadge";
import { issueTypeShortLabel } from "@/lib/constants";

export interface IssueRow {
  id: string;
  issueKey: string;
  issueType: string;
  systemName: string;
  environment: string;
  title: string;
  workflowStatus: string;
  statusLight: string;
  blockReason: string;
  waitingRole: string;
  ownerName: string;
  dueDate: string | null;
  needRca: boolean;
  needRiskException: boolean;
  evidenceStatus: string;
  nextStep: string;
  alertLevel: string;
  firstResponseAt: string | null;
}

function overdueDays(dueDate: string | null): number {
  if (!dueDate) return 0;
  const diff = Date.now() - new Date(dueDate).getTime();
  return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
}

export default function IssueTable({ issues }: { issues: IssueRow[] }) {
  if (issues.length === 0) {
    return <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">目前沒有符合條件的工單。</div>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">狀態燈號</th>
            <th className="px-3 py-2">工單編號</th>
            <th className="px-3 py-2">工單類型</th>
            <th className="px-3 py-2">系統名稱</th>
            <th className="px-3 py-2">環境</th>
            <th className="px-3 py-2">標題</th>
            <th className="px-3 py-2">目前流程關卡</th>
            <th className="px-3 py-2">卡關原因</th>
            <th className="px-3 py-2">等待角色</th>
            <th className="px-3 py-2">負責人</th>
            <th className="px-3 py-2">到期日</th>
            <th className="px-3 py-2">逾期天數</th>
            <th className="px-3 py-2">需 RCA</th>
            <th className="px-3 py-2">需風險例外</th>
            <th className="px-3 py-2">佐證狀態</th>
            <th className="px-3 py-2">下一步建議</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {issues.map((it) => {
            const od = overdueDays(it.dueDate);
            const pulse = it.statusLight === "Red" && it.alertLevel === "Critical" && !it.firstResponseAt;
            return (
              <tr key={it.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2">
                  <StatusBadge light={it.statusLight} pulse={pulse} size="sm" />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/issues/${it.id}`} className="font-medium text-primary hover:underline">
                    {it.issueKey}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issueTypeShortLabel(it.issueType)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.systemName || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.environment || "—"}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-gray-800">{it.title}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.workflowStatus}</td>
                <td className="max-w-[180px] truncate px-3 py-2 text-warning-text">{it.blockReason || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.waitingRole || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.ownerName || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.dueDate ? new Date(it.dueDate).toLocaleDateString("zh-TW") : "—"}</td>
                <td className={`whitespace-nowrap px-3 py-2 ${od > 0 ? "font-semibold text-gov-red" : "text-gray-400"}`}>{od > 0 ? `${od} 天` : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.needRca ? "是" : "否"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.needRiskException ? "是" : "否"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.evidenceStatus}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-gray-600">{it.nextStep || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
