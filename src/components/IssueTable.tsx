import Link from "next/link";
import StatusBadge from "./StatusBadge";
import { issueTypeShortLabel } from "@/lib/constants";
import { formatDate } from "@/lib/datetime";

// RD/QA/OP 接單流程新增：操作按鈕文案集中對照，避免各處各自硬編碼中文字串。
const ACTION_BUTTON_LABEL: Record<string, string> = {
  CLAIM: "接單",
  ASSIGN_MEMBER: "指派成員",
  ENTER_WORK: "進入處理",
  APPROVE: "審核",
  CONFIRM_CLOSE: "確認結案",
};

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
  // RD/QA/OP 接單流程新增（皆為 optional，僅新流程 Hotfix 工單會有值，其餘工單類型／舊流程
  // 一律 undefined，畫面顯示「—」，不影響既有欄位與既有工單類型的顯示行為）。
  assignedTeamName?: string;
  executorName?: string;
  stageEnteredAt?: string | null;
  actionKind?: string;
  actionHref?: string;
}

function overdueDays(dueDate: string | null): number {
  if (!dueDate) return 0;
  const diff = Date.now() - new Date(dueDate).getTime();
  return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
}

function dwellDays(stageEnteredAt: string | null | undefined): number | null {
  if (!stageEnteredAt) return null;
  const diff = Date.now() - new Date(stageEnteredAt).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
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
            <th className="px-3 py-2">目前階段</th>
            <th className="px-3 py-2">承接團隊</th>
            <th className="px-3 py-2">執行人</th>
            <th className="px-3 py-2">卡關原因</th>
            <th className="px-3 py-2">等待角色</th>
            <th className="px-3 py-2">負責人</th>
            <th className="px-3 py-2">到期日</th>
            <th className="px-3 py-2">逾期天數</th>
            <th className="px-3 py-2">停留天數</th>
            <th className="px-3 py-2">需 RCA</th>
            <th className="px-3 py-2">需風險例外</th>
            <th className="px-3 py-2">佐證狀態</th>
            <th className="px-3 py-2">下一步建議</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {issues.map((it) => {
            const od = overdueDays(it.dueDate);
            const dwell = dwellDays(it.stageEnteredAt);
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
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.assignedTeamName ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.executorName ?? "—"}</td>
                <td className="max-w-[180px] truncate px-3 py-2 text-warning-text">{it.blockReason || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.waitingRole || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.ownerName || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(it.dueDate)}</td>
                <td className={`whitespace-nowrap px-3 py-2 ${od > 0 ? "font-semibold text-gov-red" : "text-gray-400"}`}>{od > 0 ? `${od} 天` : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-500">{dwell !== null ? `${dwell} 天` : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.needRca ? "是" : "否"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.needRiskException ? "是" : "否"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{it.evidenceStatus}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-gray-600">{it.nextStep || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {it.actionHref && it.actionKind ? (
                    <Link href={it.actionHref} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover">
                      {ACTION_BUTTON_LABEL[it.actionKind] ?? it.actionKind}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
