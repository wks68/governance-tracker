import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth";
import { getWorkflowDefinitionDetailForActor, hasWorkflowCapability, WorkflowAccessDeniedError, WorkflowNotFoundError } from "@/lib/workflowService";
import { issueTypeLabel } from "@/lib/constants";
import WorkflowVersionList from "@/components/workflows/WorkflowVersionList";
import WorkflowDefinitionActivePanel from "@/components/workflows/WorkflowDefinitionActivePanel";

export const dynamic = "force-dynamic";

// M2-A3 新增：Workflow 定義詳情頁——顯示定義基本資料、啟用／停用控制、版本清單。
export default async function WorkflowDefinitionDetailPage({ params }: { params: { definitionId: string } }) {
  const actor = await requireCurrentUser();

  let definition;
  try {
    definition = await getWorkflowDefinitionDetailForActor(actor.id, params.definitionId);
  } catch (err) {
    if (err instanceof WorkflowAccessDeniedError) {
      return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">{err.message}</div>;
    }
    if (err instanceof WorkflowNotFoundError) {
      return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">找不到此 Workflow 定義。</div>;
    }
    throw err;
  }

  const [canManageDraft, canArchive] = await Promise.all([
    hasWorkflowCapability(actor.id, "workflow.manageDraft"),
    hasWorkflowCapability(actor.id, "workflow.archive"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/workflows" className="text-xs text-gray-500 hover:text-primary hover:underline">
          ← 回到 Workflow 定義清單
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{definition.name}</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              key：<span className="font-mono">{definition.key}</span> ・ 工單類型：{issueTypeLabel(definition.issueType)}
            </p>
            {definition.description && <p className="mt-1 text-sm text-gray-600">{definition.description}</p>}
          </div>
          {canManageDraft && (
            <WorkflowDefinitionActivePanel definitionId={definition.id} isActive={definition.isActive} />
          )}
        </div>
      </div>

      <WorkflowVersionList
        definitionId={definition.id}
        canManageDraft={canManageDraft}
        canArchive={canArchive}
        versions={definition.versions.map((v) => ({
          id: v.id,
          versionNo: v.versionNo,
          status: v.status,
          publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
          archivedAt: v.archivedAt ? v.archivedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
