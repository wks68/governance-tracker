import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, isActorOriginalReporter, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { loadExecutionFieldValues, OP_RESULT_FIELDS } from "@/lib/hotfix-ui/executionFields";
import { loadClosureSummary, findStageTransitionActorName } from "@/lib/hotfix-ui/closureService";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";
import ClosureConfirmPanel from "./ClosureConfirmPanel";

const ALLOWED = ["pendingReporterConfirmation", "reporterConfirming", "closed"];

export default async function HotfixClosePage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadHotfixPageContext(params.id, actor, ALLOWED);
  } catch (err) {
    if (err instanceof HotfixPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }
  if (ctx.redirectTo) redirect(ctx.redirectTo);

  const stageKey = ctx.runtime.currentStage.stageKey;
  const isResponsible = isActorOriginalReporter(ctx);
  const isClosed = stageKey === "closed";

  const [attachments, opResultValues, closureSummary, opDeployerName, qaVerifierName, planValues] = await Promise.all([
    listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: stageKey }),
    loadExecutionFieldValues(params.id, "opDeploying"),
    loadClosureSummary(params.id),
    findStageTransitionActorName(params.id, "opDeployComplete"),
    findStageTransitionActorName(params.id, "qaSubmit"),
    loadExecutionFieldValues(params.id, "opPreparing"),
  ]);

  return (
    <HotfixStageShell
      title="結案"
      subtitle={isClosed ? "此工單已結案，以下資訊唯讀" : "請確認上版與驗證結果後確認結案，或退回處理"}
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref={`/issues/${params.id}`}
    >
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">結案資訊</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-gray-400">正式環境確認結果</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{opResultValues.opProdConfirmResult || "（未填寫）"}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">上版結果</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{opResultValues.opDeployResult || "（未填寫）"}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">上版時間</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{planValues.opDeployPlannedAt || "（未填寫）"}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">上版人員</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{opDeployerName}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">QA 驗證人員</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{qaVerifierName}</dd>
          </div>
        </dl>
      </section>

      <ExecutionFieldsReadOnly fields={OP_RESULT_FIELDS} values={opResultValues} title="上版結果記錄" />

      <AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible || isClosed} canUpload={isResponsible && !isClosed} />

      {isClosed ? (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">結案摘要</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{closureSummary.summary || "（未填寫）"}</p>
          <h2 className="mt-4 text-sm font-semibold text-gray-800">後續觀察追蹤結果</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{closureSummary.followUpNotes || "（未填寫）"}</p>
        </section>
      ) : isResponsible ? (
        <ClosureConfirmPanel issueId={params.id} initialSummary={closureSummary.summary} initialFollowUpNotes={closureSummary.followUpNotes} />
      ) : (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">僅原始填單人可確認結案或退回處理，此頁為唯讀。</p>
        </section>
      )}
    </HotfixStageShell>
  );
}
