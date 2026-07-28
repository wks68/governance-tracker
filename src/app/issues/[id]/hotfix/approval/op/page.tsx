import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, buildApprovalReviewViewData, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { OP_DEPLOY_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
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
  if (!review) redirect(`/issues/${params.id}`);

  const [attachments, opValues] = await Promise.all([
    listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey }),
    loadExecutionFieldValues(params.id, "opPreparing"),
  ]);

  return (
    <HotfixStageShell
      title="OP 主管簽核"
      subtitle="請確認上版計畫後同意或駁回；同意後將進入實際上版執行"
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref={`/issues/${params.id}`}
      ctx={ctx}
    >
      <ExecutionFieldsReadOnly fields={OP_DEPLOY_FIELDS} values={opValues} title="上版計畫" />
      <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
      <ApprovalReviewPanel
        issueId={params.id}
        approvalRecordId={review.approvalRecordId}
        roleLabel="OP 主管"
        requestedByName={review.requestedByName}
        requestedAt={review.requestedAt}
        isResponsible={review.isResponsible}
        expectedApproverLabel={review.expectedApproverLabel}
      />
    </HotfixStageShell>
  );
}
