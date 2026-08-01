import Link from "next/link";
import { issueTypeShortLabel } from "@/lib/constants";
import { formatDate } from "@/lib/datetime";
import { resolveHotfixPriority } from "@/lib/hotfix-ui/priority";
import { hotfixTitleForDisplay } from "@/lib/hotfix-ui/title";
import type { GovernanceRelationListSummary } from "@/lib/issue-relations/viewService";
import DataTableFrame from "@/components/ui/DataTableFrame";
import { EmptyState } from "@/components/ui/FeedbackState";

export interface IssueRow {
  id: string;
  issueKey: string;
  issueType: string;
  changeSubType?: string | null;
  systemName: string;
  title: string;
  workflowStatus: string;
  statusLight: string;
  waitingRole: string;
  reporterName: string;
  priority: string;
  hotfixPriority?: string | null;
  dueDate: string | null;
  assignedTeamName?: string;
  executorName?: string;
  actionKind?: string;
  actionHref?: string;
  detailHref: string;
  relationSummary?: GovernanceRelationListSummary;
}

function HotfixUrgencyBadge({ value, legacyPriority }: { value?: string | null; legacyPriority: string }) {
  const urgency = resolveHotfixPriority(value, legacyPriority);
  return (
    <span
      aria-label={`緊急程度：${urgency.label}。${urgency.description}`}
      title={urgency.description}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium ${urgency.badgeClass}`}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${urgency.dotClass}`} />
      {urgency.label}
    </span>
  );
}

function ActionCell({ issue }: { issue: IssueRow }) {
  return (
    <div className="flex items-center gap-2">
      <Link href={issue.detailHref} className="text-xs font-medium text-primary hover:underline">
        查看
      </Link>
      {issue.actionHref && issue.actionKind && (
        <Link href={issue.actionHref} className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-hover">
          前往處理
        </Link>
      )}
    </div>
  );
}

function QuarterlyRelations({ summary }: { summary?: GovernanceRelationListSummary }) {
  if (!summary || summary.hotfixCount === 0) {
    return <span className="text-xs text-gray-400">尚未關聯</span>;
  }
  return (
    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
      Hotfix {summary.hotfixCount}
    </span>
  );
}

export default function IssueTable({ issues, mode }: { issues: IssueRow[]; mode: "hotfix" | "quarterly" }) {
  if (issues.length === 0) {
    return <EmptyState title="目前沒有符合條件的事項" description="可調整搜尋或篩選條件後再試一次。" />;
  }

  if (mode === "hotfix") {
    return (
      <DataTableFrame label="Hotfix 清單資料表">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium text-gray-500">
              <th className="px-3 py-2">緊急程度</th>
              <th className="px-3 py-2">工單編號</th>
              <th className="px-3 py-2">工單類型</th>
              <th className="px-3 py-2">系統名稱</th>
              <th className="px-3 py-2">標題</th>
              <th className="px-3 py-2">申請人</th>
              <th className="px-3 py-2">到期日</th>
              <th className="px-3 py-2">目前階段</th>
              <th className="px-3 py-2">承接團隊</th>
              <th className="px-3 py-2">執行人</th>
              <th className="px-3 py-2">等待角色</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {issues.map((issue) => {
              const displayTitle = hotfixTitleForDisplay(issue.title);
              return (
                <tr key={issue.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2"><HotfixUrgencyBadge value={issue.hotfixPriority} legacyPriority={issue.priority} /></td>
                  <td className="whitespace-nowrap px-3 py-2"><Link href={issue.detailHref} className="font-medium text-primary hover:underline">{issue.issueKey}</Link></td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issueTypeShortLabel(issue.issueType)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.systemName || "—"}</td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-gray-800" title={displayTitle}><Link href={issue.detailHref} className="hover:text-primary hover:underline">{displayTitle}</Link></td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.reporterName || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(issue.dueDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.workflowStatus}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.assignedTeamName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.executorName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.waitingRole || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2"><ActionCell issue={issue} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataTableFrame>
    );
  }

  return (
    <DataTableFrame label="季度專案清單資料表">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">工單編號</th>
            <th className="px-3 py-2">工單類型</th>
            <th className="px-3 py-2">系統名稱</th>
            <th className="px-3 py-2">標題</th>
            <th className="px-3 py-2">申請人</th>
            <th className="px-3 py-2">到期日</th>
            <th className="px-3 py-2">目前階段</th>
            <th className="px-3 py-2">關聯</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {issues.map((issue) => (
            <tr key={issue.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2"><Link href={issue.detailHref} className="font-medium text-primary hover:underline">{issue.issueKey}</Link></td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">季度專案</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.systemName || "—"}</td>
              <td className="max-w-[300px] truncate px-3 py-2 text-gray-800" title={issue.title}>{issue.title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.reporterName || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(issue.dueDate)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.workflowStatus}</td>
              <td className="px-3 py-2"><QuarterlyRelations summary={issue.relationSummary} /></td>
              <td className="whitespace-nowrap px-3 py-2"><ActionCell issue={issue} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
