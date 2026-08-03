import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isIssueOnVersionedWorkflow } from "@/lib/workflowExecutionService";
import { resolveIssueDetailHref } from "@/lib/issue-detail-href";
import { loadHotfixPageContext, isActorOriginalReporter, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { loadExecutionFieldValues, OP_RESULT_FIELDS } from "@/lib/hotfix-ui/executionFields";
import { loadClosureSummary, findStageTransitionActorName } from "@/lib/hotfix-ui/closureService";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";
import ClosureConfirmPanel from "./ClosureConfirmPanel";
import LegacyHotfixSummaryPage from "../summary/page";
import RichTextViewer from "@/components/rich-text/RichTextViewer";

const ALLOWED = ["pendingReporterConfirmation", "reporterConfirming", "closed", "cancelled"];

export default async function HotfixClosePage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  const routeIssue = await prisma.issue.findUnique({ where: { id: params.id } });
  if (!routeIssue) notFound();
  if (routeIssue.issueType !== "Hotfix") {
    redirect(resolveIssueDetailHref(routeIssue));
  }
  if (!isIssueOnVersionedWorkflow(routeIssue)) {
    const canonicalHref = resolveIssueDetailHref(routeIssue);
    if (!canonicalHref.endsWith("/hotfix/close")) redirect(canonicalHref);
    return LegacyHotfixSummaryPage({ params });
  }

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
  const isCancelled = stageKey === "cancelled";

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
      title={isCancelled ? "Hotfix 已取消" : "結案"}
      subtitle={isCancelled ? "此工單已取消" : isClosed ? "此工單已結案" : "請確認上版與驗證結果後確認結案，或退回處理"}
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref="/issues?view=hotfix"
      ctx={ctx}
      main={<div className="space-y-5">
      <section className="ui-card p-4">
        <h2 className="text-sm font-semibold text-gray-800">結案資訊</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-gray-400">正式環境確認結果</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{opResultValues.opPostMonitoringResult || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">上版結果</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{opResultValues.opDeployResult || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">上版時間</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{planValues.opDeployPlannedAt || "—"}</dd>
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

      {isCancelled ? (
        <section className="rounded-lg border border-gray-300 bg-gray-50 p-4">
          <h2 className="text-sm font-semibold text-gray-800">取消終態</h2>
          <p className="mt-2 text-sm text-gray-600">此 Hotfix 已停止流程；僅保留取消前實際完成的節點，不顯示為全部完成，也不提供任何流程操作。</p>
        </section>
      ) : isClosed ? (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">結案摘要</h2>
          <div className="mt-2"><RichTextViewer value={closureSummary.summary} empty="已由原申請人確認結案" /></div>
          <h2 className="mt-4 text-sm font-semibold text-gray-800">後續觀察追蹤結果</h2>
          <div className="mt-2"><RichTextViewer value={closureSummary.followUpNotes} /></div>
        </section>
      ) : isResponsible ? (
        <ClosureConfirmPanel issueId={params.id} />
      ) : (
        <section className="ui-card p-4">
          <p className="text-sm text-gray-500">僅原始填單人可確認結案或退回處理。</p>
        </section>
      )}
      </div>}
      side={<AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />}
    />
  );
}
