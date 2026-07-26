import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth";
import {
  getWorkflowVersionDetailForActor,
  hasWorkflowCapability,
  WorkflowAccessDeniedError,
  WorkflowNotFoundError,
} from "@/lib/workflowService";
import { listTeamsForActor } from "@/lib/peopleService";
import { workflowVersionStatusLabel } from "@/components/workflows/WorkflowDefinitionTable";
import WorkflowStageEditor from "@/components/workflows/WorkflowStageEditor";
import WorkflowTransitionEditor from "@/components/workflows/WorkflowTransitionEditor";
import WorkflowValidationPanel from "@/components/workflows/WorkflowValidationPanel";
import PublishWorkflowPanel from "@/components/workflows/PublishWorkflowPanel";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "border-warning-border bg-warning-bg text-warning-text",
  PUBLISHED: "border-success-border bg-success-bg text-success-text",
  ARCHIVED: "border-secondary-border bg-gray-100 text-gray-500",
};

// M2-A3 新增：Workflow 版本詳情頁——DRAFT 版本可編輯 Stage／Transition／Requirement，
// 已發布／已封存版本整頁唯讀（服務層 assertDraftVersion 已是最終防線，本頁 UI 層級
// 只是提前不渲染編輯表單，避免使用者送出後才被拒絕的落差體驗）。
export default async function WorkflowVersionDetailPage({
  params,
}: {
  params: { definitionId: string; versionId: string };
}) {
  const actor = await requireCurrentUser();

  let version;
  try {
    version = await getWorkflowVersionDetailForActor(actor.id, params.versionId);
  } catch (err) {
    if (err instanceof WorkflowAccessDeniedError) {
      return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">{err.message}</div>;
    }
    if (err instanceof WorkflowNotFoundError) {
      return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">找不到此版本。</div>;
    }
    throw err;
  }

  const [canManageDraft, canPublish, teams] = await Promise.all([
    hasWorkflowCapability(actor.id, "workflow.manageDraft"),
    hasWorkflowCapability(actor.id, "workflow.publish"),
    listTeamsForActor(actor.id),
  ]);

  const isDraft = version.status === "DRAFT";
  const stages = version.stages.map((s) => ({
    id: s.id,
    stageKey: s.stageKey,
    label: s.label,
    stageType: s.stageType,
    sortOrder: s.sortOrder,
    isStart: s.isStart,
    isEnd: s.isEnd,
    terminalOutcome: s.terminalOutcome,
    assignedTeamId: s.assignedTeamId,
    assignedTeamName: s.assignedTeam?.name ?? null,
    approvalType: s.approvalType,
    requirements: s.requirements.map((r) => ({ id: r.id, requirementType: r.requirementType, targetKey: r.targetKey })),
  }));
  const transitions = version.transitions.map((t) => ({
    id: t.id,
    fromStageId: t.fromStageId,
    fromStageLabel: t.fromStage.label,
    toStageId: t.toStageId,
    toStageLabel: t.toStage.label,
    transitionType: t.transitionType,
    actionKey: t.actionKey,
    label: t.label,
    requireReason: t.requireReason,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/workflows/${params.definitionId}`} className="text-xs text-gray-500 hover:text-primary hover:underline">
          ← 回到「{version.workflowDefinition.name}」
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">
            {version.workflowDefinition.name} v{version.versionNo}
          </h1>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[version.status] ?? ""}`}>
            {workflowVersionStatusLabel(version.status)}
          </span>
        </div>
        {!isDraft && <p className="mt-1 text-sm text-gray-500">此版本已{version.status === "PUBLISHED" ? "發布" : "封存"}，內容唯讀。如需修改請先複製為新草稿版本。</p>}
      </div>

      <WorkflowStageEditor
        definitionId={params.definitionId}
        versionId={version.id}
        stages={stages}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        editable={isDraft && canManageDraft}
      />

      <WorkflowTransitionEditor
        definitionId={params.definitionId}
        versionId={version.id}
        stages={stages.map((s) => ({ id: s.id, label: s.label, stageKey: s.stageKey }))}
        transitions={transitions}
        editable={isDraft && canManageDraft}
      />

      {isDraft && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <WorkflowValidationPanel versionId={version.id} />
          {canPublish && <PublishWorkflowPanel definitionId={params.definitionId} versionId={version.id} />}
        </div>
      )}
    </div>
  );
}
