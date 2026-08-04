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
import { FilePlus2 } from "lucide-react";
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

type ListMode = "hotfix" | "quarterly";

function requestedMode(searchParams: Record<string, string | undefined>): ListMode {
  if (searchParams.view === "quarterly") return "quarterly";
  if (searchParams.issueType === "ChangeRelease" && searchParams.changeSubType === "QUARTERLY_RELEASE") {
    return "quarterly";
  }
  return "hotfix";
}

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
  };
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
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      assignedTeam: { select: { name: true } },
      currentWorkflowStage: { select: { stageKey: true, terminalOutcome: true } },
      fieldValues: {
        where: { fieldKey: HOTFIX_PRIORITY_FIELD_KEY },
        select: { fieldKey: true, fieldValue: true },
      },
    },
  });

  const selectedIssues = allIssues.filter((issue) =>
    mode === "hotfix"
      ? issue.issueType === "Hotfix"
      : issue.issueType === "ChangeRelease" && issue.changeSubType === "QUARTERLY_RELEASE",
  );
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={mode === "hotfix" ? "Hotfix 清單" : "季度專案清單"}
        description={`目前顯示 ${rows.length} 筆（此類型共 ${selectedIssues.length} 筆）`}
        actions={
          <Link href="/issues/new" className="ui-button-primary">
            <FilePlus2 className="h-4 w-4" aria-hidden />
            新增事項
          </Link>
        }
      />

      <div role="tablist" aria-label="工單類型" className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        <Link
          role="tab"
          aria-selected={mode === "hotfix"}
          href="/issues?view=hotfix"
          className={`rounded-md px-4 py-2 text-sm font-medium ${mode === "hotfix" ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-50"}`}
        >
          Hotfix
        </Link>
        <Link
          role="tab"
          aria-selected={mode === "quarterly"}
          href="/issues?view=quarterly"
          className={`rounded-md px-4 py-2 text-sm font-medium ${mode === "quarterly" ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-50"}`}
        >
          季度專案
        </Link>
      </div>

      {mode === "hotfix" && (
        <HotfixSummaryCards counts={summaryCounts} activeKey={summaryKey} searchParams={searchParams} />
      )}

      <FilterBar options={{ systemNames, waitingRoles }} showActionability={mode === "hotfix"} />
      <IssueTable
        issues={rows}
        mode={mode}
        totalCount={selectedIssues.length}
        hasActiveFilters={Boolean(searchParams.q) || ["summary", "quick", "systemName", "light", "urgency", "waitingRole", "overdue"].some((key) => Boolean(searchParams[key]))}
      />
    </div>
  );
}
