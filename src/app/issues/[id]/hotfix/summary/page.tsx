import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isIssueOnVersionedWorkflow, getIssueWorkflowRuntime } from "@/lib/workflowExecutionService";
import { resolveIssueDetailHref } from "@/lib/issue-detail-href";
import { loadGovernanceRelationViewForActor } from "@/lib/issue-relations/viewService";
import { HOTFIX_PRIORITY_FIELD_KEY, resolveHotfixPriority } from "@/lib/hotfix-ui/priority";
import { legacyHotfixNineStageDisplay } from "@/lib/hotfix-ui/nineStage";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";

export const dynamic = "force-dynamic";

/**
 * 沒有 WorkflowVersion/runtime 的舊制 Hotfix 專屬唯讀頁。
 * legacy workflowStatus 只透過 nineStage.ts 轉為九階段顯示，不建立 runtime，也不提供
 * 任何 Workflow 操作權。
 */
export default async function LegacyHotfixSummaryPage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();
  const issue = await prisma.issue.findUnique({
    where: { id: params.id },
    include: {
      assignedTeam: { select: { name: true } },
      fieldValues: {
        where: { fieldKey: HOTFIX_PRIORITY_FIELD_KEY },
        select: { fieldValue: true },
      },
    },
  });
  if (!issue) notFound();
  if (issue.issueType !== "Hotfix") redirect(resolveIssueDetailHref({ id: issue.id, issueType: issue.issueType }));

  if (isIssueOnVersionedWorkflow(issue)) {
    const runtime = await getIssueWorkflowRuntime(issue.id, actor.id);
    if (runtime.onVersionedWorkflow) {
      redirect(resolveIssueDetailHref({
        id: issue.id,
        issueType: issue.issueType,
        currentStageKey: runtime.currentStage.stageKey,
        workflowStatus: issue.workflowStatus,
      }));
    }
  }

  const [relationView, attachments] = await Promise.all([
    loadGovernanceRelationViewForActor(actor.id, issue.id),
    listHotfixAttachments(issue.id),
  ]);
  const priority = resolveHotfixPriority(issue.fieldValues[0]?.fieldValue, issue.priority);
  const display = legacyHotfixNineStageDisplay(issue.workflowStatus);
  return (
    <HotfixStageShell
      title={`Hotfix（${issue.issueKey}）簽核流程狀態`}
      nineStageIndex={display.currentIndex}
      cancelled={display.cancelled}
      relationViewOverride={relationView}
      ticketBasicInfo={{
        issueKey: issue.issueKey,
        reporterName: issue.reporter,
        teamName: issue.assignedTeam?.name ?? null,
        environment: issue.environment,
        title: issue.title,
        description: issue.description,
        systemName: issue.systemName,
        riskLevel: issue.riskLevel,
        hotfixPriority: priority.value,
        dueDate: issue.dueDate?.toISOString() ?? null,
      }}
      backHref="/issues?view=hotfix"
      legacyView={{
        issueId: issue.id,
        currentStageLabel: display.stageLabel,
        teamName: issue.assignedTeam?.name ?? null,
        cancelledAtIndex: display.cancelledAtIndex,
        terminalComplete: display.terminalComplete,
      }}
      side={<AttachmentSection issueId={issue.id} items={attachments} readOnly canUpload={false} />}
    />
  );
}
