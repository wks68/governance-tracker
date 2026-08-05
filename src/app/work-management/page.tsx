import Link from "next/link";
import { CalendarRange, CircleAlert, Clock3, FilePlus2, FileSearch, Flame, Siren } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { getVisibleGovernanceIssueRows, isInProgressIssue } from "@/lib/governanceDashboardService";
import { listActionableTasksForActor } from "@/lib/workflowExecutionService";
import { prisma } from "@/lib/prisma";
import KpiCard from "@/components/KpiCard";
import ContentCard from "@/components/ui/ContentCard";
import PageHeader from "@/components/ui/PageHeader";
import { formatDateTime } from "@/lib/datetime";
import { resolveIssueDetailHref } from "@/lib/issue-detail-href";

export const dynamic = "force-dynamic";

const LIST_LINKS = [
  { href: "/issues?view=hotfix", label: "Hotfix 清單", description: "查看緊急修正的簽核、執行與上版進度。", icon: Flame },
  { href: "/issues?view=quarterly", label: "季度專案清單", description: "查看本季度開發、改善、測試及上版項目。", icon: CalendarRange },
  { href: "/issues?view=incident", label: "事件通報清單", description: "查看系統異常、服務中斷與資料錯誤紀錄。", icon: Siren },
  { href: "/issues?view=rca", label: "RCA 清單", description: "查看根因分析與後續改善追蹤。", icon: FileSearch },
] as const;

export default async function WorkManagementPage() {
  const actor = await requireCurrentUser();
  const [visibleRows, actionableTasks] = await Promise.all([
    getVisibleGovernanceIssueRows(actor.id),
    listActionableTasksForActor(actor.id),
  ]);
  const visibleIds = visibleRows.map((row) => row.id);
  const issueFacts = visibleIds.length
    ? await prisma.issue.findMany({
        where: { id: { in: visibleIds } },
        select: { id: true, changeSubType: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      })
    : [];
  const factsById = new Map(issueFacts.map((row) => [row.id, row]));
  const activeRows = visibleRows.filter(isInProgressIssue);
  const now = Date.now();
  const count = {
    hotfix: visibleRows.filter((row) => row.issueType === "Hotfix").length,
    quarterly: visibleRows.filter(
      (row) => row.issueType === "ChangeRelease" && factsById.get(row.id)?.changeSubType === "QUARTERLY_RELEASE",
    ).length,
    incident: visibleRows.filter((row) => row.issueType === "Incident").length,
    rca: visibleRows.filter((row) => row.issueType === "RCA").length,
    risk: activeRows.filter((row) => row.riskStatus === "YES").length,
    overdue: activeRows.filter((row) => row.dueDate && row.dueDate.getTime() < now).length,
  };
  const visibleById = new Map(visibleRows.map((row) => [row.id, row]));
  const recent = issueFacts.flatMap((fact) => {
    const row = visibleById.get(fact.id);
    return row ? [{ ...row, updatedAt: fact.updatedAt }] : [];
  }).slice(0, 5);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="工作總覽"
        title="DMS 工作管理中心"
        description="集中查看待處理摘要、最近更新與四類正式工作事項；所有數據沿用既有可見性與待辦解析。"
        actions={
          <Link href="/issues/new" className="ui-button-primary">
            <FilePlus2 className="h-4 w-4" aria-hidden />
            新增事項
          </Link>
        }
      />

      <section aria-label="工作摘要" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="待我處理" value={actionableTasks.length} tone="blue" />
        <KpiCard label="Hotfix" value={count.hotfix} />
        <KpiCard label="季度專案" value={count.quarterly} />
        <KpiCard label="事件通報" value={count.incident} />
        <KpiCard label="RCA" value={count.rca} />
        <KpiCard label="高風險／逾期" value={`${count.risk}／${count.overdue}`} tone={count.risk + count.overdue > 0 ? "red" : "default"} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <ContentCard className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text-primary">工作列表</h2>
              <p className="mt-1 text-sm text-text-secondary">直接進入既有清單，不建立第二套資料頁。</p>
            </div>
            {actionableTasks.length > 0 && (
              <Link href="/issues?view=hotfix&quick=mine" className="ui-button-secondary px-3 py-1.5">
                <Clock3 className="h-4 w-4" aria-hidden />
                待我處理 {actionableTasks.length}
              </Link>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {LIST_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="group rounded-xl border border-border p-4 transition hover:border-primary/40 hover:bg-primary-muted">
                <item.icon className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold text-text-primary group-hover:text-primary">{item.label}</h3>
                <p className="mt-1 text-sm leading-5 text-text-secondary">{item.description}</p>
              </Link>
            ))}
          </div>
        </ContentCard>

        <ContentCard className="p-4 sm:p-5">
          <h2 className="text-base font-semibold text-text-primary">風險與期限</h2>
          <p className="mt-1 text-sm text-text-secondary">只統計目前仍在進行中的可見事項。</p>
          <div className="mt-4 space-y-3">
            <Link href="/governance?riskStatus=YES" className="flex items-center justify-between rounded-xl border border-danger/20 bg-danger-muted p-4 text-danger">
              <span className="flex items-center gap-2 text-sm font-semibold"><CircleAlert className="h-4 w-4" aria-hidden />高風險事項</span>
              <span className="text-lg font-bold">{count.risk}</span>
            </Link>
            <Link href="/issues?view=hotfix&overdue=1" className="flex items-center justify-between rounded-xl border border-warning/20 bg-warning-muted p-4 text-warning">
              <span className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" aria-hidden />逾期事項</span>
              <span className="text-lg font-bold">{count.overdue}</span>
            </Link>
          </div>
        </ContentCard>
      </div>

      <ContentCard className="overflow-hidden">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h2 className="text-base font-semibold text-text-primary">最近更新事項</h2>
          <p className="mt-1 text-sm text-text-secondary">依既有 Issue 更新時間排序。</p>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-muted">目前沒有可顯示的工作事項。</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((row) => (
              <li key={row.id}>
                <Link href={resolveIssueDetailHref({
                  id: row.id,
                  issueType: row.issueType,
                  currentStageKey: row.currentStage?.stageKey ?? null,
                  workflowStatus: row.lifecycleStatus === "COMPLETED" ? "closed" : row.lifecycleStatus === "CANCELLED" ? "cancelled" : null,
                })} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition hover:bg-surface-muted sm:px-5">
                  <span className="min-w-0">
                    <span className="text-xs font-semibold text-primary">{row.issueKey}</span>
                    <span className="ml-2 text-xs text-text-muted">{workTypeLabel(row.issueType, factsById.get(row.id)?.changeSubType)}</span>
                    <span className="mt-1 block truncate text-sm font-medium text-text-primary">{row.title}</span>
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">{formatDateTime(row.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ContentCard>
    </div>
  );
}

function workTypeLabel(issueType: string, changeSubType: string | null | undefined): string {
  if (issueType === "Hotfix") return "Hotfix 緊急修正";
  if (issueType === "ChangeRelease" && changeSubType === "QUARTERLY_RELEASE") return "季度專案";
  if (issueType === "Incident") return "事件通報";
  if (issueType === "RCA") return "RCA 根因分析";
  return issueType;
}
