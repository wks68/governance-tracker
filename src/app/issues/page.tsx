import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/workflow";
import FilterBar from "@/components/FilterBar";
import IssueTable, { type IssueRow } from "@/components/IssueTable";
import { requireCurrentUser } from "@/lib/auth";
import { resolveIssueTasksForActor } from "@/lib/workflowExecutionService";
import { HOTFIX_PRIORITY_FIELD_KEY, resolveHotfixPriority } from "@/lib/hotfix-ui/priority";
import {
  loadGovernanceRelationListSummariesForActor,
  type GovernanceRelationListSummary,
} from "@/lib/issue-relations/viewService";
import PageHeader from "@/components/ui/PageHeader";
import CreateWorkItemFab from "@/components/work-items/CreateWorkItemFab";
import ScrollDownChevron from "@/components/ui/ScrollDownChevron";
import { resolveIssueDetailHref } from "@/lib/issue-detail-href";
import HotfixSummaryCards from "@/components/issue-list/HotfixSummaryCards";
import {
  matchesHotfixSearch,
  matchesHotfixSummary,
  normalizeHotfixSummaryKey,
  resolveHotfixDueTone,
  resolveHotfixListAction,
  resolveHotfixTerminal,
  resolveResponsibilityLine,
  summarizeHotfixList,
  taipeiWeekBounds,
} from "@/lib/hotfix-list/viewModel";

export const dynamic = "force-dynamic";

type ListMode = "hotfix" | "quarterly" | "incident" | "rca";

function requestedMode(searchParams: Record<string, string | undefined>): ListMode {
  if (searchParams.view === "quarterly") return "quarterly";
  if (searchParams.view === "incident") return "incident";
  if (searchParams.view === "rca") return "rca";
  if (searchParams.issueType === "ChangeRelease" && searchParams.changeSubType === "QUARTERLY_RELEASE") {
    return "quarterly";
  }
  return "hotfix";
}

const MODE_TITLE: Record<ListMode, string> = {
  hotfix: "Hotfix 清單",
  quarterly: "季度專案清單",
  incident: "事件通報清單",
  rca: "RCA 清單",
};

function toRow(
  issue: any,
  relationSummary: GovernanceRelationListSummary | undefined,
  taskStates: Awaited<ReturnType<typeof resolveIssueTasksForActor>>,
  now: number,
  weekBounds: { start: number; end: number },
): IssueRow {
  const taskState = taskStates.get(issue.id);
  const task = taskState?.actionable;
  const summary = taskState?.summary;
  const terminal = issue.issueType === "Hotfix" && resolveHotfixTerminal({
    hasRuntime: Boolean(issue.workflowVersionId && issue.currentWorkflowStageId),
    currentStageTerminalOutcome: issue.currentWorkflowStage?.terminalOutcome ?? null,
    workflowStatus: issue.workflowStatus,
  });
  const detailHref = resolveIssueDetailHref({
    id: issue.id,
    issueType: issue.issueType,
    currentStageKey: issue.currentWorkflowStage?.stageKey ?? null,
    workflowStatus: issue.workflowStatus,
  });
  const dueDate = issue.dueDate ? issue.dueDate.toISOString() : null;
  const assignedTeamName = summary?.assignedTeamName ?? issue.assignedTeam?.name ?? undefined;
  const executorName = summary?.executorName ?? undefined;
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    issueType: issue.issueType,
    changeSubType: issue.changeSubType,
    systemName: issue.systemName,
    title: issue.title,
    workflowStatus: summary?.businessStatusLabel ?? statusLabel(issue.issueType, issue.workflowStatus),
    statusLight: issue.statusLight,
    waitingRole: summary?.waitingRoleLabel ?? issue.waitingRole,
    reporterName: issue.reporter,
    priority: issue.priority,
    hotfixPriority: issue.fieldValues?.find(
      (field: { fieldKey: string }) => field.fieldKey === HOTFIX_PRIORITY_FIELD_KEY,
    )?.fieldValue ?? null,
    dueDate,
    assignedTeamName,
    executorName,
    actionKind: task?.action,
    actionHref: task?.actionHref,
    detailHref,
    terminal,
    responsibilityLine: issue.issueType === "Hotfix" ? resolveResponsibilityLine({
      terminal,
      waitingRole: summary?.waitingRoleLabel ?? issue.waitingRole,
      executorName,
      assignedTeamName,
    }) : null,
    hotfixAction: issue.issueType === "Hotfix" ? resolveHotfixListAction({
      actionKind: task?.action,
      actionHref: task?.actionHref,
      detailHref,
      terminal,
    }) : undefined,
    dueTone: issue.issueType === "Hotfix" ? resolveHotfixDueTone(dueDate, terminal, now, weekBounds) : undefined,
    relationSummary,
    rawStageKey: issue.currentWorkflowStage?.stageKey ?? null,
    severityLabel: issue.fieldValues?.find((field: { fieldKey: string }) => field.fieldKey === "incidentFormalSeverity")?.fieldValue ?? null,
  };
}

const RCA_IN_ANALYSIS_OR_REVIEW_STAGES = new Set([
  "rcaAnalysisInProgress",
  "pendingTechnicalReview",
  "pendingSecurityIntegrityReview",
  "pendingManagementConfirmation",
]);

function buildGenericStatCards(
  mode: Exclude<ListMode, "hotfix">,
  rows: IssueRow[],
  taskStates: Awaited<ReturnType<typeof resolveIssueTasksForActor>>,
  now: number,
): Array<{ label: string; value: number }> {
  const total = rows.length;
  const mineToAct = rows.filter((row) => taskStates.get(row.id)?.actionable).length;
  const notTerminal = rows.filter((row) => !row.terminal);

  if (mode === "quarterly") {
    const pendingReview = rows.filter((row) => row.workflowStatus.includes("審查") || row.workflowStatus.includes("核准")).length;
    const dueSoon = rows.filter((row) => row.dueDate && !row.terminal && new Date(row.dueDate).getTime() - now < 7 * 24 * 60 * 60 * 1000 && new Date(row.dueDate).getTime() >= now).length;
    return [
      { label: "目前共", value: total },
      { label: "進行中", value: notTerminal.length },
      { label: "待審查", value: pendingReview },
      { label: "即將到期", value: dueSoon },
    ];
  }
  if (mode === "incident") {
    const highSeverity = rows.filter((row) => row.severityLabel === "高").length;
    const pendingRcaDecision = rows.filter((row) => row.rawStageKey === "pendingRcaDecision").length;
    return [
      { label: "目前共", value: total },
      { label: "待我處理", value: mineToAct },
      { label: "高等級事件", value: highSeverity },
      { label: "待 RCA 判定", value: pendingRcaDecision },
    ];
  }
  const inAnalysisOrReview = rows.filter((row) => RCA_IN_ANALYSIS_OR_REVIEW_STAGES.has(row.rawStageKey ?? "")).length;
  const overdue = rows.filter((row) => row.dueDate && !row.terminal && new Date(row.dueDate).getTime() < now).length;
  return [
    { label: "目前共", value: total },
    { label: "待我處理", value: mineToAct },
    { label: "分析或審查中", value: inAnalysisOrReview },
    { label: "逾期未完成", value: overdue },
  ];
}

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const actor = await requireCurrentUser();
  const mode = requestedMode(searchParams);
  const allIssues = await prisma.issue.findMany({
    where: {
      OR: [
        { issueType: "Hotfix" },
        { issueType: "ChangeRelease", changeSubType: "QUARTERLY_RELEASE" },
        { issueType: "Incident" },
        { issueType: "RCA" },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      assignedTeam: { select: { name: true } },
      currentWorkflowStage: { select: { stageKey: true, terminalOutcome: true } },
      fieldValues: {
        where: { fieldKey: { in: [HOTFIX_PRIORITY_FIELD_KEY, "incidentFormalSeverity", "incidentNeedRca"] } },
        select: { fieldKey: true, fieldValue: true },
      },
    },
  });

  const tabCounts = {
    hotfix: allIssues.filter((i) => i.issueType === "Hotfix").length,
    quarterly: allIssues.filter((i) => i.issueType === "ChangeRelease" && i.changeSubType === "QUARTERLY_RELEASE").length,
    incident: allIssues.filter((i) => i.issueType === "Incident").length,
    rca: allIssues.filter((i) => i.issueType === "RCA").length,
  };

  const selectedIssues = allIssues.filter((issue) => {
    if (mode === "hotfix") return issue.issueType === "Hotfix";
    if (mode === "quarterly") return issue.issueType === "ChangeRelease" && issue.changeSubType === "QUARTERLY_RELEASE";
    if (mode === "incident") return issue.issueType === "Incident";
    return issue.issueType === "RCA";
  });
  const [taskStates, relationSummaries, myMemberships] = await Promise.all([
    resolveIssueTasksForActor(actor.id, allIssues),
    loadGovernanceRelationListSummariesForActor(actor.id, allIssues.map((issue) => issue.id)),
    prisma.teamMember.findMany({
      where: { userId: actor.id, isActive: true },
      select: { teamId: true },
    }),
  ]);
  const myTeamIds = new Set(myMemberships.map((membership) => membership.teamId));
  const now = Date.now();
  const weekBounds = taipeiWeekBounds(new Date(now));
  const allRows = selectedIssues.map((issue) =>
    toRow(issue, relationSummaries.get(issue.id), taskStates, now, weekBounds),
  );
  const issueById = new Map(selectedIssues.map((issue) => [issue.id, issue]));
  const summaryKey = normalizeHotfixSummaryKey(searchParams.summary);
  const summaryCounts = summarizeHotfixList(allRows, weekBounds);

  let rows = allRows;
  if (searchParams.q) {
    rows = rows.filter((row) => matchesHotfixSearch(row, searchParams.q ?? ""));
  }
  if (searchParams.light) rows = rows.filter((row) => row.statusLight === searchParams.light);
  if (searchParams.systemName) rows = rows.filter((row) => row.systemName === searchParams.systemName);
  if (searchParams.waitingRole) rows = rows.filter((row) => row.waitingRole === searchParams.waitingRole);
  if (searchParams.urgency && mode === "hotfix") {
    rows = rows.filter(
      (row) => resolveHotfixPriority(row.hotfixPriority, row.priority).value === searchParams.urgency,
    );
  }
  if (searchParams.overdue === "1") {
    rows = rows.filter((row) => !!row.dueDate && new Date(row.dueDate).getTime() < now && !row.terminal);
  }
  if (mode === "hotfix") {
    rows = rows.filter((row) => matchesHotfixSummary(row, summaryKey, weekBounds));
    if (searchParams.quick === "mine") {
      rows = rows.filter((row) => !!taskStates.get(row.id)?.actionable);
    } else if (searchParams.quick === "myApprovals") {
      rows = rows.filter((row) => taskStates.get(row.id)?.actionable?.action === "APPROVE");
    } else if (searchParams.quick === "claimable") {
      rows = rows.filter((row) => taskStates.get(row.id)?.actionable?.action === "CLAIM");
    } else if (searchParams.quick === "myTeam") {
      rows = rows.filter((row) => {
        const issue = issueById.get(row.id);
        return !!issue?.assignedTeamId && myTeamIds.has(issue.assignedTeamId);
      });
    }
  }

  const systemNames = Array.from(new Set(selectedIssues.map((issue) => issue.systemName).filter(Boolean))).sort();
  const waitingRoles = Array.from(new Set(allRows.map((row) => row.waitingRole).filter((value) => value && value !== "—"))).sort();

  const genericStatCards = mode !== "hotfix" ? buildGenericStatCards(mode, rows, taskStates, now) : null;

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title={MODE_TITLE[mode]}
        description={`目前顯示 ${rows.length} 筆（此類型共 ${selectedIssues.length} 筆）`}
      />

      <div role="tablist" aria-label="工單類型" className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1">
        {(
          [
            { key: "hotfix" as const, label: "Hotfix", href: "/issues?view=hotfix" },
            { key: "quarterly" as const, label: "季度專案", href: "/issues?view=quarterly" },
            { key: "incident" as const, label: "事件通報", href: "/issues?view=incident" },
            { key: "rca" as const, label: "RCA", href: "/issues?view=rca" },
          ]
        ).map((tab) => (
          <Link
            key={tab.key}
            role="tab"
            aria-selected={mode === tab.key}
            href={tab.href}
            className={`rounded-md px-4 py-2 text-sm font-medium ${mode === tab.key ? "bg-primary/90 text-white" : "border border-transparent text-gray-600 hover:bg-gray-50"}`}
          >
            {tab.label}
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${mode === tab.key ? "bg-white/20" : "bg-gray-100 text-gray-500"}`}>{tabCounts[tab.key]}</span>
          </Link>
        ))}
      </div>

      {mode === "hotfix" && (
        <HotfixSummaryCards counts={summaryCounts} activeKey={summaryKey} searchParams={searchParams} />
      )}
      {genericStatCards && (
        <section aria-label={`${MODE_TITLE[mode]}摘要`} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {genericStatCards.map((card) => (
            <div key={card.label} className="ui-card p-3">
              <p className="text-xs text-text-muted">{card.label}</p>
              <p className="mt-1 text-xl font-bold text-text-primary">{card.value}</p>
            </div>
          ))}
        </section>
      )}

      <FilterBar options={{ systemNames, waitingRoles }} showActionability={mode === "hotfix"} />
      <div data-hotfix-scroll-section>
        <IssueTable
          issues={rows}
          mode={mode}
          totalCount={selectedIssues.length}
          hasActiveFilters={Boolean(searchParams.q) || ["summary", "quick", "systemName", "light", "urgency", "waitingRole", "overdue"].some((key) => Boolean(searchParams[key]))}
        />
      </div>
      <CreateWorkItemFab />
      <ScrollDownChevron />
    </div>
  );
}
