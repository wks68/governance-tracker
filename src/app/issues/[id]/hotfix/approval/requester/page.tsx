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
  if (!review) redirect(`/issues/${params.id}`);

  const attachments = await listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey });

  return (
    <HotfixStageShell
      title="申請人直屬主管簽核"
      subtitle="請確認工單基本資訊後同意或駁回"
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref={`/issues/${params.id}`}
      ctx={ctx}
    >
      <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
      <ApprovalReviewPanel
        issueId={params.id}
        approvalRecordId={review.approvalRecordId}
        roleLabel="申請人直屬主管"
        requestedByName={review.requestedByName}
        requestedAt={review.requestedAt}
        isResponsible={review.isResponsible}
        expectedApproverLabel={review.expectedApproverLabel}
      />
    </HotfixStageShell>
  );
}
