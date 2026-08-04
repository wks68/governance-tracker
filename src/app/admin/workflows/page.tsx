import { requireCurrentUser } from "@/lib/auth";
import { listWorkflowDefinitionsForActor, hasWorkflowCapability, WorkflowAccessDeniedError } from "@/lib/workflowService";
import WorkflowDefinitionTable from "@/components/workflows/WorkflowDefinitionTable";
import CreateWorkflowDefinitionDrawer from "@/components/workflows/CreateWorkflowDefinitionDrawer";

export const dynamic = "force-dynamic";

// M2-A3 新增：Workflow 定義清單頁（取代原本 MVP 靜態展示頁）。
//
// 可見範圍完全由 listWorkflowDefinitionsForActor（workflow.view Capability）決定，
// 沒有此能力者一律拒絕，不提供部分可見的中間狀態（與 People 領域的「僅所屬 Team」
// row-level 範圍不同，Workflow 定義管理是全域性的）。
export default async function WorkflowsAdminPage() {
  const actor = await requireCurrentUser();

  let definitions;
  try {
    definitions = await listWorkflowDefinitionsForActor(actor.id);
  } catch (err) {
    if (err instanceof WorkflowAccessDeniedError) {
      return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">{err.message}</div>;
    }
    throw err;
  }

  const canManageDraft = await hasWorkflowCapability(actor.id, "workflow.manageDraft");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workflow 流程定義</h1>
          <p className="mt-0.5 text-sm text-gray-500">共 {definitions.length} 個定義。版本發布後不可修改，所有變更皆會寫入 Audit Log。</p>
        </div>
        {canManageDraft && <CreateWorkflowDefinitionDrawer />}
      </div>

      <WorkflowDefinitionTable
        definitions={definitions.map((d) => ({
          id: d.id,
          key: d.key,
          name: d.name,
          issueType: d.issueType,
          isActive: d.isActive,
          versions: d.versions.map((v) => ({
            id: v.id,
            versionNo: v.versionNo,
            status: v.status,
            publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
          })),
        }))}
      />
    </div>
  );
}
