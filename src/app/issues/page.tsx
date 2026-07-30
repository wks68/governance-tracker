import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isClosed, statusLabel } from "@/lib/workflow";
import FilterBar from "@/components/FilterBar";
import IssueTable, { IssueRow } from "@/components/IssueTable";
import { requireCurrentUser } from "@/lib/auth";
import { evaluateCurrentActorTask } from "@/lib/workflowExecutionService";
import { routeForStageKey } from "@/lib/hotfix-ui/nineStage";
import { HOTFIX_PRIORITY_FIELD_KEY } from "@/lib/hotfix-ui/priority";
import {
  loadGovernanceRelationListSummariesForActor,
  type GovernanceRelationListSummary,
} from "@/lib/issue-relations/viewService";

export const dynamic = "force-dynamic";

function toRow(
  issue: any,
  relationSummary?: GovernanceRelationListSummary,
): IssueRow {
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    issueType: issue.issueType,
    changeSubType: issue.changeSubType,
    systemName: issue.systemName,
    environment: issue.environment,
    title: issue.title,
    workflowStatus: statusLabel(issue.issueType, issue.workflowStatus),
    statusLight: issue.statusLight,
    blockReason: issue.blockReason,
    waitingRole: issue.waitingRole,
    ownerName: issue.ownerName,
    reporterName: issue.reporter,
    priority: issue.priority,
    hotfixPriority: issue.fieldValues?.find((field: { fieldKey: string }) => field.fieldKey === HOTFIX_PRIORITY_FIELD_KEY)?.fieldValue ?? null,
    dueDate: issue.dueDate ? issue.dueDate.toISOString() : null,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    evidenceStatus: issue.evidenceStatus,
    nextStep: issue.nextStep,
    alertLevel: issue.alertLevel,
    firstResponseAt: issue.firstResponseAt ? issue.firstResponseAt.toISOString() : null,
    stageEnteredAt: issue.stageEnteredAt ? issue.stageEnteredAt.toISOString() : null,
    relationSummary,
  };
}

// RD/QA/OP 接單流程新增：每一筆新流程 Hotfix 工單，額外算出「業務子狀態／承接團隊／
// 執行人／操作按鈕」——工單清單不得再直接顯示技術 stageKey（見
// src/lib/workflow-execution/responsibilityService.ts）。只對「issueType=Hotfix 且已啟動
// 新版流程引擎」的工單計算，其餘工單類型／舊流程工單完全維持既有 workflowStatus／
// waitingRole 顯示，不受影響。
async function enrichHotfixRows(issues: any[], actorId: string): Promise<Map<string, Partial<IssueRow> & { quickFlags: { mine: boolean; myApproval: boolean; claimable: boolean } }>> {
  const targets = issues.filter((i) => i.issueType === "Hotfix" && i.workflowVersionId && i.currentWorkflowStageId);
  const entries = await Promise.all(
    targets.map(async (issue) => {
      const task = await evaluateCurrentActorTask(issue.id, actorId);
      if (!task) return null;
      const actionHref = task.action === "VIEW_ONLY" ? undefined : routeForStageKey(issue.id, task.stageKey) ?? undefined;
      return [
        issue.id,
        {
          workflowStatus: task.businessStatusLabel,
          waitingRole: task.waitingRoleLabel,
          assignedTeamName: task.assignedTeamName ?? undefined,
          executorName: task.executorName ?? undefined,
          actionKind: task.action === "VIEW_ONLY" ? undefined : task.action,
          actionHref,
          quickFlags: {
            mine: task.action === "ENTER_WORK" || task.action === "CONFIRM_CLOSE",
            myApproval: task.action === "APPROVE",
            claimable: task.isClaimableStage,
          },
        },
      ] as const;
    }),
  );
  return new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null));
}

export default async function IssuesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const actor = await requireCurrentUser();
  const allIssues = await prisma.issue.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      fieldValues: {
        where: { fieldKey: HOTFIX_PRIORITY_FIELD_KEY },
        select: { fieldKey: true, fieldValue: true },
      },
    },
  });
  const now = Date.now();
  const isOverdue = (i: (typeof allIssues)[number]) =>
    !!i.dueDate && i.dueDate.getTime() < now && !isClosed(i.issueType, i.workflowStatus);

  const systemNames = Array.from(new Set(allIssues.map((i) => i.systemName).filter(Boolean))).sort();
  const owners = Array.from(new Set(allIssues.map((i) => i.ownerName).filter(Boolean))).sort();

  const [hotfixEnrichment, myActiveTeamIds, relationSummaries] = await Promise.all([
    enrichHotfixRows(allIssues, actor.id),
    prisma.teamMember.findMany({ where: { userId: actor.id, isActive: true }, select: { teamId: true } }).then((rows) => new Set(rows.map((r) => r.teamId))),
    loadGovernanceRelationListSummariesForActor(
      actor.id,
      allIssues.map((issue) => issue.id),
    ),
  ]);

  let filtered = allIssues;
  if (searchParams.issueType) filtered = filtered.filter((i) => i.issueType === searchParams.issueType);
  if (searchParams.changeSubType) filtered = filtered.filter((i) => i.changeSubType === searchParams.changeSubType);
  if (searchParams.q) {
    const query = searchParams.q.trim().toLocaleLowerCase("zh-TW");
    filtered = filtered.filter((issue) => issue.title.toLocaleLowerCase("zh-TW").includes(query) || issue.issueKey.toLocaleLowerCase("zh-TW").includes(query));
  }
  if (searchParams.light) filtered = filtered.filter((i) => i.statusLight === searchParams.light);
  if (searchParams.systemName) filtered = filtered.filter((i) => i.systemName === searchParams.systemName);
  if (searchParams.environment) filtered = filtered.filter((i) => i.environment === searchParams.environment);
  if (searchParams.owner) filtered = filtered.filter((i) => i.ownerName === searchParams.owner);
  if (searchParams.waitingRole) filtered = filtered.filter((i) => i.waitingRole === searchParams.waitingRole);
  if (searchParams.riskLevel) filtered = filtered.filter((i) => i.riskLevel === searchParams.riskLevel);
  if (searchParams.overdue === "1") filtered = filtered.filter(isOverdue);

  if (searchParams.quick === "mine") {
    filtered = filtered.filter((i) => hotfixEnrichment.get(i.id)?.quickFlags.mine);
  } else if (searchParams.quick === "myApprovals") {
    filtered = filtered.filter((i) => hotfixEnrichment.get(i.id)?.quickFlags.myApproval);
  } else if (searchParams.quick === "claimable") {
    filtered = filtered.filter((i) => hotfixEnrichment.get(i.id)?.quickFlags.claimable);
  } else if (searchParams.quick === "myTeam") {
    filtered = filtered.filter((i) => !!i.assignedTeamId && myActiveTeamIds.has(i.assignedTeamId));
  }

  const rows = filtered.map((issue) => {
    const row = toRow(issue, relationSummaries.get(issue.id));
    const enrichment = hotfixEnrichment.get(issue.id);
    return enrichment ? { ...row, ...enrichment } : row;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">工單清單</h1>
          <p className="mt-0.5 text-sm text-gray-500">共 {filtered.length} 筆（總計 {allIssues.length} 筆）</p>
        </div>
        <Link
          href="/issues/new"
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          建立工單
        </Link>
      </div>

      <FilterBar options={{ systemNames, owners }} />

      <nav aria-label="治理紀錄獨立清單" className="flex flex-wrap gap-2">
        {[
          { href: "/issues?issueType=Hotfix", label: "Hotfix" },
          { href: "/issues?issueType=ChangeRelease&changeSubType=QUARTERLY_RELEASE", label: "季度專案" },
          { href: "/issues?issueType=Incident", label: "事件通報" },
          { href: "/issues?issueType=RCA", label: "RCA" },
        ].map((item) => (
          <Link key={item.label} href={item.href} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-primary hover:text-primary">
            {item.label}
          </Link>
        ))}
      </nav>

      <IssueTable issues={rows} mode={searchParams.issueType === "Hotfix" ? "hotfix" : "all"} />
    </div>
  );
}
