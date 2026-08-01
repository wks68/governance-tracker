import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isIssueOnVersionedWorkflow, getIssueWorkflowRuntime } from "@/lib/workflowExecutionService";
import { resolveIssueDetailHref } from "@/lib/issue-detail-href";
import { loadGovernanceRelationViewForActor } from "@/lib/issue-relations/viewService";
import { HOTFIX_PRIORITY_FIELD_KEY, resolveHotfixPriority } from "@/lib/hotfix-ui/priority";
import { statusLabel } from "@/lib/workflow";
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

  const [createdAudit, relationView, attachments] = await Promise.all([
    prisma.auditLog.findFirst({
      where: { entityType: "Issue", entityId: issue.id, actionType: "IssueCreated" },
      orderBy: { createdAt: "asc" },
      include: { actor: true },
    }),
    loadGovernanceRelationViewForActor(actor.id, issue.id),
    listHotfixAttachments(issue.id),
  ]);
  const priority = resolveHotfixPriority(issue.fieldValues[0]?.fieldValue, issue.priority);
  const display = legacyHotfixNineStageDisplay(issue.workflowStatus);
  const legacyNotice = display.statusKnown
    ? `舊制狀態「${statusLabel(issue.issueType, issue.workflowStatus)}」已轉接為九階段顯示；舊制資料，僅供查閱。`
    : `舊制狀態「${issue.workflowStatus || "（空白）"}」無法精確判斷；仍顯示完整九階段供查閱。`;

  return (
    <HotfixStageShell
      title={display.cancelled ? "Hotfix 已取消" : display.terminalComplete ? "Hotfix 已結案" : "Hotfix 九階段唯讀"}
      subtitle={legacyNotice}
      nineStageIndex={display.currentIndex}
      cancelled={display.cancelled}
      relationViewOverride={relationView}
      ticketBasicInfo={{
        issueKey: issue.issueKey,
        reporterName: issue.reporter,
        creatorName: createdAudit?.actor?.name ?? null,
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
        responsibility: {
          stageLabel: display.stageLabel,
          teamName: issue.assignedTeam?.name ?? null,
          dueDate: issue.dueDate?.toISOString() ?? null,
          ownerLabel: issue.ownerName || issue.waitingRole || "舊制責任資料未留存",
        },
        guidance: { stageLabel: display.stageLabel, statusKnown: display.statusKnown },
        cancelledAtIndex: display.cancelledAtIndex,
        terminalComplete: display.terminalComplete,
      }}
      main={(
        <section className={`rounded-lg border p-4 ${display.cancelled ? "border-gray-300 bg-gray-50" : "border-info/20 bg-info-muted"}`}>
          <h2 className="text-sm font-semibold text-text-primary">{display.cancelled ? "取消終態" : "唯讀工作內容"}</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-text-muted">目前狀態</dt><dd className="mt-1 font-medium text-text-primary">{statusLabel(issue.issueType, issue.workflowStatus)}</dd></div>
            <div><dt className="text-xs text-text-muted">等待角色</dt><dd className="mt-1 font-medium text-text-primary">{issue.waitingRole || "—"}</dd></div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-text-secondary">
            此轉接只影響 UI 顯示，不建立假的 Workflow runtime，也不提供接單、指派、簽核、部署、附件上傳或結案操作。
          </p>
        </section>
      )}
      side={<AttachmentSection issueId={issue.id} items={attachments} readOnly canUpload={false} />}
    />
  );
}
