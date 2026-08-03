import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, buildApprovalReviewViewData, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { OP_DEPLOY_FIELDS, loadExecutionFieldValues, parseMultiValue } from "@/lib/hotfix-ui/executionFields";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ApprovalReviewPanel from "@/components/hotfix-nine-stage/ApprovalReviewPanel";
import { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";

export default async function HotfixApprovalOpPage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadHotfixPageContext(params.id, actor, ["pendingDeploymentApproval"]);
  } catch (err) {
    if (err instanceof HotfixPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }
  if (ctx.redirectTo) redirect(ctx.redirectTo);

  const review = await buildApprovalReviewViewData(ctx);

  const [attachments, opValues] = await Promise.all([
    listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey }),
    loadExecutionFieldValues(params.id, "opPreparing"),
  ]);

  return (
    <HotfixStageShell
      title="OP 主管上版前核准"
      subtitle="請確認上版前計畫後同意或駁回；同意後原 OP 執行人才能填寫正式環境部署紀錄"
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref="/issues?view=hotfix"
      ctx={ctx}
      main={<div className="space-y-5">
      <section className="ui-card p-4">
        <h2 className="text-sm font-semibold text-gray-800">第 7 關子步驟</h2>
        <ol className="mt-3 grid gap-2 sm:grid-cols-3">
          <li className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">1. 上版前確認 ✓</li>
          <li className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">2. OP 主管上版前核准</li>
          <li className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-500">3. 正式環境部署紀錄</li>
        </ol>
      </section>
      <ExecutionFieldsReadOnly fields={OP_DEPLOY_FIELDS} values={opValues} title="OP 上版前確認" />
      {opValues.opServiceOperationRequired === "是" && parseMultiValue(opValues.opExpectedImpacts).length === 1 && parseMultiValue(opValues.opExpectedImpacts)[0] === "無明顯影響" && (
        <p className="rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-gray-800">
          此計畫包含服務／元件操作，但判定為無明顯影響；請主管特別確認判定說明。
        </p>
      )}
      {opValues.opMonitoringMethod === "不適用" && (
        <p className="rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-gray-800">
          本次監控確認選擇不適用；請主管特別確認不適用原因。
        </p>
      )}
      </div>}
      side={<div className="space-y-5">
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
        {review ? <ApprovalReviewPanel
        issueId={params.id}
        approvalRecordId={review.approvalRecordId}
        roleLabel="OP 主管"
        requestedByName={review.requestedByName}
        requestedAt={review.requestedAt}
        isResponsible={review.isResponsible}
        expectedApproverLabel={review.expectedApproverLabel}
        /> : <MissingApprovalRecordNotice />}
      </div>}
    />
  );
}

function MissingApprovalRecordNotice() {
  return <section className="ui-card p-4"><h2 className="text-sm font-semibold text-text-primary">簽核紀錄暫不可用</h2><p className="mt-2 text-sm text-text-secondary">目前沒有可顯示的有效簽核紀錄，因此不提供同意或駁回操作。</p></section>;
}
