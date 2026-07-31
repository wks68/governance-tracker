import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getUserHasCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/workflow";
import { loadGovernanceRelationListSummariesForActor } from "@/lib/issue-relations/viewService";
import GovernanceRecordList from "@/components/GovernanceRecordList";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const actor = await requireCurrentUser();
  if (!(await getUserHasCapability(actor, "issue.view"))) redirect("/governance");
  const issues = await prisma.issue.findMany({
    where: { issueType: "Incident" },
    orderBy: { createdAt: "desc" },
  });
  const summaries = await loadGovernanceRelationListSummariesForActor(actor.id, issues.map((issue) => issue.id));
  const records = issues.map((issue) => {
    const summary = summaries.get(issue.id);
    const relationLabels: string[] = [];
    if (summary?.rcaCount) relationLabels.push(`RCA ${summary.rcaCount}`);
    if (summary?.hotfixCount) relationLabels.push(`Hotfix ${summary.hotfixCount}`);
    return {
      id: issue.id,
      issueKey: issue.issueKey,
      systemName: issue.systemName,
      title: issue.title,
      status: statusLabel(issue.issueType, issue.workflowStatus),
      createdAt: issue.createdAt.toISOString(),
      relationLabels,
    };
  });
  return <GovernanceRecordList title="事件通報" description="事件通報獨立清單" records={records} />;
}
