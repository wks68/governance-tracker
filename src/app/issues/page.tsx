import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isClosed, statusLabel } from "@/lib/workflow";
import FilterBar from "@/components/FilterBar";
import IssueTable, { IssueRow } from "@/components/IssueTable";
import { requireCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function toRow(issue: any): IssueRow {
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    issueType: issue.issueType,
    systemName: issue.systemName,
    environment: issue.environment,
    title: issue.title,
    workflowStatus: statusLabel(issue.issueType, issue.workflowStatus),
    statusLight: issue.statusLight,
    blockReason: issue.blockReason,
    waitingRole: issue.waitingRole,
    ownerName: issue.ownerName,
    dueDate: issue.dueDate ? issue.dueDate.toISOString() : null,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    evidenceStatus: issue.evidenceStatus,
    nextStep: issue.nextStep,
    alertLevel: issue.alertLevel,
    firstResponseAt: issue.firstResponseAt ? issue.firstResponseAt.toISOString() : null,
  };
}

export default async function IssuesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireCurrentUser();
  const allIssues = await prisma.issue.findMany({ orderBy: { createdAt: "desc" } });
  const now = Date.now();
  const isOverdue = (i: (typeof allIssues)[number]) =>
    !!i.dueDate && i.dueDate.getTime() < now && !isClosed(i.issueType, i.workflowStatus);

  const systemNames = Array.from(new Set(allIssues.map((i) => i.systemName).filter(Boolean))).sort();
  const owners = Array.from(new Set(allIssues.map((i) => i.ownerName).filter(Boolean))).sort();

  let filtered = allIssues;
  if (searchParams.issueType) filtered = filtered.filter((i) => i.issueType === searchParams.issueType);
  if (searchParams.light) filtered = filtered.filter((i) => i.statusLight === searchParams.light);
  if (searchParams.systemName) filtered = filtered.filter((i) => i.systemName === searchParams.systemName);
  if (searchParams.environment) filtered = filtered.filter((i) => i.environment === searchParams.environment);
  if (searchParams.owner) filtered = filtered.filter((i) => i.ownerName === searchParams.owner);
  if (searchParams.waitingRole) filtered = filtered.filter((i) => i.waitingRole === searchParams.waitingRole);
  if (searchParams.riskLevel) filtered = filtered.filter((i) => i.riskLevel === searchParams.riskLevel);
  if (searchParams.overdue === "1") filtered = filtered.filter(isOverdue);

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

      <IssueTable issues={filtered.map(toRow)} />
    </div>
  );
}
