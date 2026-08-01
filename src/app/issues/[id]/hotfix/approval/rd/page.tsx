import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, buildApprovalReviewViewData, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { RD_FIX_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ApprovalReviewPanel from "@/components/hotfix-nine-stage/ApprovalReviewPanel";
import { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";

export default async function HotfixApprovalRdPage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadHotfixPageContext(params.id, actor, ["pendingRdLeadApproval"]);
  } catch (err) {
    if (err instanceof HotfixPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }
  if (ctx.redirectTo) redirect(ctx.redirectTo);

  const review = await buildApprovalReviewViewData(ctx);

  const [attachments, rdValues] = await Promise.all([
    listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey }),
    loadExecutionFieldValues(params.id, "rdInProgress"),
  ]);

  return (
    <HotfixStageShell
      title="RD 主管簽核"
      subtitle="請確認 RD 修正內容與自測結果後同意或駁回"
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref="/issues?view=hotfix"
      ctx={ctx}
      main={<ExecutionFieldsReadOnly fields={RD_FIX_FIELDS} values={rdValues} title="RD 修正內容（正式提交快照）" />}
      side={<div className="space-y-5">
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
        {review ? <ApprovalReviewPanel
        issueId={params.id}
        approvalRecordId={review.approvalRecordId}
        roleLabel="RD 主管"
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
  return <section className="ui-card p-4"><h2 className="text-sm font-semibold text-text-primary">簽核紀錄暫不可用</h2><p className="mt-2 text-sm text-text-secondary">目前關卡仍保留唯讀顯示；沒有有效簽核紀錄時不提供同意或駁回操作。</p></section>;
}
