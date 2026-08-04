import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, buildApprovalReviewViewData, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { QA_VERIFY_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ApprovalReviewPanel from "@/components/hotfix-nine-stage/ApprovalReviewPanel";
import { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";

export default async function HotfixApprovalQaPage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadHotfixPageContext(params.id, actor, ["pendingQaLeadApproval"]);
  } catch (err) {
    if (err instanceof HotfixPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }
  if (ctx.redirectTo) redirect(ctx.redirectTo);

  const review = await buildApprovalReviewViewData(ctx);

  const [attachments, qaValues] = await Promise.all([
    listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey }),
    loadExecutionFieldValues(params.id, "qaInProgress"),
  ]);

  return (
    <HotfixStageShell
      title="QA 主管簽核"
      subtitle="請確認 QA 驗證結果後同意或駁回；駁回將退回 QA 驗證"
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref="/issues?view=hotfix"
      ctx={ctx}
      main={<ExecutionFieldsReadOnly fields={QA_VERIFY_FIELDS} values={qaValues} title="QA 驗證內容（正式提交快照）" />}
      approval={review ? <ApprovalReviewPanel
        issueId={params.id}
        approvalRecordId={review.approvalRecordId}
        stageLabel="QA 主管簽核"
        roleLabel="QA 主管"
        requestedByName={review.requestedByName}
        requestedAt={review.requestedAt}
        isResponsible={review.isResponsible}
        expectedApproverLabel={review.expectedApproverLabel}
      /> : <MissingApprovalRecordNotice />}
      attachments={<AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />}
    />
  );
}

function MissingApprovalRecordNotice() {
  return <section className="ui-card p-4"><h2 className="text-sm font-semibold text-text-primary">簽核紀錄暫不可用</h2><p className="mt-2 text-sm text-text-secondary">目前沒有可顯示的有效簽核紀錄，因此不提供同意或駁回操作。</p></section>;
}
