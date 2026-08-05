import Link from "next/link";
import { formatDate } from "@/lib/datetime";
import { resolveHotfixPriority } from "@/lib/hotfix-ui/priority";
import { hotfixTitleForDisplay } from "@/lib/hotfix-ui/title";
import type { GovernanceRelationListSummary } from "@/lib/issue-relations/viewService";
import DataTableFrame from "@/components/ui/DataTableFrame";
import { EmptyState } from "@/components/ui/FeedbackState";
import IssueActionButton from "@/components/issue-list/IssueActionButton";
import type { HotfixListActionView } from "@/lib/hotfix-list/viewModel";
import type { HotfixDueTone } from "@/lib/hotfix-list/viewModel";

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
  terminal: boolean;
  responsibilityLine?: string | null;
  hotfixAction?: HotfixListActionView;
  dueTone?: HotfixDueTone;
  relationSummary?: GovernanceRelationListSummary;
  /** 內部 WorkflowStage.stageKey（非顯示用業務狀態字串），供事件通報／RCA 清單統計卡片判斷用。 */
  rawStageKey?: string | null;
  /** Incident 正式事件等級（高／中／低），供事件通報清單統計卡片判斷用。 */
  severityLabel?: string | null;
  /** RCA 精確逾期狀態（見 rca-ui/rcaOverdueService.ts），以 RcaActionItem 為準，非 Issue.dueDate。 */
  rcaOverdueSummary?: {
    isOverdue: boolean;
    overdueCount: number;
    earliestOverdueDate: string | null;
    latestPlannedDate: string | null;
    completedCount: number;
    totalCount: number;
  };
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

function QuarterlyActionCell({ issue }: { issue: IssueRow }) {
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

function HotfixTitle({ issue, compact = false }: { issue: IssueRow; compact?: boolean }) {
  const displayTitle = hotfixTitleForDisplay(issue.title);
  return (
    <div className="group/title relative min-w-0">
      <Link
        href={issue.detailHref}
        title={displayTitle}
        className={`block font-medium text-text-primary hover:text-primary focus-visible:text-primary ${compact ? "line-clamp-2 text-sm leading-5" : "line-clamp-2 leading-5"}`}
      >
        {displayTitle}
      </Link>
      <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-5 text-text-secondary shadow-overlay group-hover/title:block group-focus-within/title:block">
        {displayTitle}
      </span>
    </div>
  );
}

function DueDate({ issue }: { issue: IssueRow }) {
  const tone = issue.dueTone === "overdue" ? "font-medium text-danger" : issue.dueTone === "due-soon" ? "font-medium text-amber-700" : "text-text-secondary";
  return <span className={`whitespace-nowrap text-sm ${tone}`}>{formatDate(issue.dueDate, "未設定")}</span>;
}

function HotfixDesktopTable({ issues }: { issues: IssueRow[] }) {
  return (
    <div className="ui-card hidden xl:block" role="region" aria-label="Hotfix 清單資料表">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[90px]" />
          <col className="w-[130px]" />
          <col />
          <col className="w-[100px]" />
          <col className="w-[240px]" />
          <col className="w-[120px]" />
          <col className="w-[136px]" />
        </colgroup>
        <thead className="bg-slate-50">
          <tr className="h-14 text-xs font-medium text-text-secondary">
            {['緊急程度', 'Hotfix 單號', '事項', '申請人', '目前狀態', '到期日'].map((header) => <th key={header} className="whitespace-nowrap px-3 py-4 text-center align-middle">{header}</th>)}
            <th className="whitespace-nowrap px-5 py-4 text-center align-middle">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {issues.map((issue) => (
            <tr key={issue.id} className="h-[82px] transition-colors hover:bg-surface-muted">
              <td className="py-4 pl-5 pr-3 align-middle"><HotfixUrgencyBadge value={issue.hotfixPriority} legacyPriority={issue.priority} /></td>
              <td className="px-3 py-4 align-middle">
                <Link href={issue.detailHref} className="whitespace-nowrap font-semibold text-primary hover:underline focus-visible:rounded-sm">{issue.issueKey}</Link>
              </td>
              <td className="min-w-0 px-3 py-4 align-middle">
                <HotfixTitle issue={issue} />
                <p className="mt-1 truncate text-xs text-text-muted">{issue.systemName || "未提供系統名稱"}</p>
              </td>
              <td className="px-3 py-4 align-middle">
                <span tabIndex={0} title={issue.reporterName || "未提供"} className="block truncate text-text-primary">{issue.reporterName || "未提供"}</span>
              </td>
              <td className="px-3 py-4 align-middle">
                <p className="line-clamp-2 font-medium leading-5 text-text-primary">{issue.workflowStatus}</p>
                {issue.responsibilityLine && <p className="mt-1 truncate text-xs text-text-muted">{issue.responsibilityLine}</p>}
              </td>
              <td className="px-3 py-4 align-middle"><DueDate issue={issue} /></td>
              <td className="overflow-visible px-5 py-4 align-middle">
                <div className="flex w-full items-center justify-center">
                  {issue.hotfixAction && <IssueActionButton action={issue.hotfixAction} />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HotfixCards({ issues }: { issues: IssueRow[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:hidden" aria-label="Hotfix 清單卡片">
      {issues.map((issue) => (
        <article key={issue.id} className="ui-card min-w-0 overflow-visible p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <HotfixUrgencyBadge value={issue.hotfixPriority} legacyPriority={issue.priority} />
            <Link href={issue.detailHref} className="whitespace-nowrap text-sm font-semibold text-primary hover:underline">{issue.issueKey}</Link>
          </div>
          <div className="mt-4 min-w-0">
            <HotfixTitle issue={issue} compact />
            <p className="mt-1 truncate text-xs text-text-muted">{issue.systemName || "未提供系統名稱"}</p>
          </div>
          <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-sm">
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
              <dt className="text-text-muted">申請人</dt>
              <dd className="truncate text-text-primary" title={issue.reporterName || "未提供"}>{issue.reporterName || "未提供"}</dd>
            </div>
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
              <dt className="text-text-muted">目前狀態</dt>
              <dd className="min-w-0">
                <p className="font-medium text-text-primary">{issue.workflowStatus}</p>
                {issue.responsibilityLine && <p className="mt-1 text-xs leading-5 text-text-muted">{issue.responsibilityLine}</p>}
              </dd>
            </div>
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
              <dt className="text-text-muted">到期日</dt>
              <dd><DueDate issue={issue} /></dd>
            </div>
          </dl>
          <div className="mt-4 overflow-visible">{issue.hotfixAction && <IssueActionButton action={issue.hotfixAction} fullWidth />}</div>
        </article>
      ))}
    </div>
  );
}

function RcaOverdueBadge({ summary }: { summary?: IssueRow["rcaOverdueSummary"] }) {
  if (!summary || summary.totalCount === 0) {
    return <span className="text-xs text-gray-400">尚無改善措施</span>;
  }
  if (summary.isOverdue) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-danger-border bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger-text">
        逾期 {summary.overdueCount} 項（{summary.completedCount}／{summary.totalCount} 已完成）
      </span>
    );
  }
  return (
    <span className="text-xs text-gray-600">
      {summary.completedCount}／{summary.totalCount} 已完成
    </span>
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

const GENERIC_MODE_LABEL: Record<"quarterly" | "incident" | "rca", string> = {
  quarterly: "季度專案",
  incident: "事件通報",
  rca: "RCA",
};

export default function IssueTable({ issues, mode, totalCount = issues.length, hasActiveFilters = false }: { issues: IssueRow[]; mode: "hotfix" | "quarterly" | "incident" | "rca"; totalCount?: number; hasActiveFilters?: boolean }) {
  if (issues.length === 0) {
    if (mode === "hotfix") {
      return hasActiveFilters
        ? <EmptyState title="找不到符合條件的 Hotfix" description="可移除搜尋或篩選條件後再試一次。" />
        : <EmptyState title="目前尚無 Hotfix 工單" />;
    }
    const label = GENERIC_MODE_LABEL[mode];
    return <EmptyState title={totalCount === 0 ? `目前尚無${label}` : `找不到符合條件的${label}`} />;
  }

  if (mode === "hotfix") {
    return (
      <>
        <HotfixDesktopTable issues={issues} />
        <HotfixCards issues={issues} />
      </>
    );
  }

  const typeLabel = GENERIC_MODE_LABEL[mode];
  const isRcaMode = mode === "rca";
  return (
    <DataTableFrame label={`${typeLabel}清單資料表`}>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">工單編號</th>
            <th className="px-3 py-2">工單類型</th>
            <th className="px-3 py-2">系統名稱</th>
            <th className="px-3 py-2">標題</th>
            <th className="px-3 py-2">申請人</th>
            <th className="px-3 py-2">{isRcaMode ? "改善進度／逾期" : "到期日"}</th>
            <th className="px-3 py-2">目前階段</th>
            <th className="px-3 py-2">關聯</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {issues.map((issue) => (
            <tr key={issue.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2"><Link href={issue.detailHref} className="font-medium text-primary hover:underline">{issue.issueKey}</Link></td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{typeLabel}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.systemName || "—"}</td>
              <td className="max-w-[300px] truncate px-3 py-2 text-gray-800" title={issue.title}>{issue.title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.reporterName || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                {isRcaMode ? <RcaOverdueBadge summary={issue.rcaOverdueSummary} /> : formatDate(issue.dueDate)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issue.workflowStatus}</td>
              <td className="px-3 py-2"><QuarterlyRelations summary={issue.relationSummary} /></td>
              <td className="whitespace-nowrap px-3 py-2"><QuarterlyActionCell issue={issue} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
