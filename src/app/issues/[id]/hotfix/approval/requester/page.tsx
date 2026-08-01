import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, buildApprovalReviewViewData, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ApprovalReviewPanel from "@/components/hotfix-nine-stage/ApprovalReviewPanel";

export default async function HotfixApprovalRequesterPage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadHotfixPageContext(params.id, actor, ["pendingBusinessApproval"]);
  } catch (err) {
    if (err instanceof HotfixPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }
  if (ctx.redirectTo) redirect(ctx.redirectTo);

  const review = await buildApprovalReviewViewData(ctx);

  const attachments = await listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey });

  return (
    <HotfixStageShell
      title="申請人直屬主管簽核"
      subtitle="請確認工單基本資訊後同意或駁回"
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref="/issues?view=hotfix"
      ctx={ctx}
      main={<section className="ui-card p-4"><h2 className="text-sm font-semibold text-text-primary">送簽內容</h2><p className="mt-2 text-sm text-text-secondary">請依工單基本資訊確認申請內容與影響範圍；本階段不提供編輯。</p></section>}
      side={<div className="space-y-5">
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
        {review ? <ApprovalReviewPanel
        issueId={params.id}
        approvalRecordId={review.approvalRecordId}
        roleLabel="申請人直屬主管"
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
