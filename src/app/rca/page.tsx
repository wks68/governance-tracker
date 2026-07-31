import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getUserHasCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/workflow";
import { loadGovernanceRelationListSummariesForActor } from "@/lib/issue-relations/viewService";
import GovernanceRecordList from "@/components/GovernanceRecordList";

export const dynamic = "force-dynamic";

export default async function RcaPage() {
  const actor = await requireCurrentUser();
  if (!(await getUserHasCapability(actor, "issue.view"))) redirect("/governance");
  const issues = await prisma.issue.findMany({
    where: { issueType: "RCA" },
    orderBy: { createdAt: "desc" },
  });
  const summaries = await loadGovernanceRelationListSummariesForActor(actor.id, issues.map((issue) => issue.id));
  const records = issues.map((issue) => {
    const summary = summaries.get(issue.id);
    const relationLabels: string[] = [];
    if (summary?.incidentCount) relationLabels.push(`事件 ${summary.incidentCount}`);
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
  return (
    <GovernanceRecordList
      title="RCA 根因分析"
      description="針對事件分析真正原因，並追蹤後續改善措施"
      records={records}
      createLabel="建立 RCA"
      createHref="/issues/new?type=rca"
    />
  );
}
