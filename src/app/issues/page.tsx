import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isClosed, statusLabel } from "@/lib/workflow";
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
): IssueRow {
  const taskState = taskStates.get(issue.id);
  const task = taskState?.actionable;
  const summary = taskState?.summary;
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
    dueDate: issue.dueDate ? issue.dueDate.toISOString() : null,
    assignedTeamName: summary?.assignedTeamName ?? issue.assignedTeam?.name ?? undefined,
    executorName: summary?.executorName ?? undefined,
    actionKind: task?.action,
    actionHref: task?.actionHref,
    detailHref: resolveIssueDetailHref({
      id: issue.id,
      issueType: issue.issueType,
      currentStageKey: issue.currentWorkflowStage?.stageKey ?? null,
      workflowStatus: issue.workflowStatus,
    }),
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
      currentWorkflowStage: { select: { stageKey: true } },
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
  const allRows = selectedIssues.map((issue) =>
    toRow(issue, relationSummaries.get(issue.id), taskStates),
  );
  const issueById = new Map(selectedIssues.map((issue) => [issue.id, issue]));
  const now = Date.now();

  let rows = allRows;
  if (searchParams.q) {
    const query = searchParams.q.trim().toLocaleLowerCase("zh-TW");
    rows = rows.filter(
      (row) =>
        row.title.toLocaleLowerCase("zh-TW").includes(query) ||
        row.issueKey.toLocaleLowerCase("zh-TW").includes(query),
    );
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
    rows = rows.filter((row) => {
      const issue = issueById.get(row.id);
      return !!issue?.dueDate && issue.dueDate.getTime() < now && !isClosed(issue.issueType, issue.workflowStatus);
    });
  }
  if (mode === "hotfix") {
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

      <FilterBar options={{ systemNames, waitingRoles }} showActionability={mode === "hotfix"} />
      <IssueTable issues={rows} mode={mode} />
    </div>
  );
}
