import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, isActorResponsibleForExecutionStage, loadGovernanceFixLinks, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { RD_FIX_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
import { listClaimableTeamsForStage, listAssignableMembers } from "@/lib/workflowExecutionService";
import { saveHotfixExecutionFieldsAction, submitHotfixExecutionAction } from "../execution-actions";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ClaimTeamPanel from "@/components/hotfix-nine-stage/ClaimTeamPanel";
import AssignExecutorPanel from "@/components/hotfix-nine-stage/AssignExecutorPanel";
import ExecutionFieldsForm, { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";
import ExecutorAssignmentSummary from "@/components/hotfix-nine-stage/ExecutorAssignmentSummary";
import ReassignExecutorDialog from "@/components/hotfix-nine-stage/ReassignExecutorDialog";

const ALLOWED = ["pendingRdTriage", "pendingRdClaim", "rdInProgress"];

export default async function HotfixRdPage({ params }: { params: { id: string } }) {
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
  const attachments = await listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: stageKey });
  const shellProps = { nineStageIndex: ctx.nineStageIndex, cancelled: ctx.cancelled, ticketBasicInfo: ctx.ticketBasicInfo, backHref: `/issues/${params.id}`, ctx };

  if (stageKey === "pendingRdTriage") {
    const preview = await listClaimableTeamsForStage(params.id, actor.id);
    return (
      <HotfixStageShell title="RD 修正與自測" {...shellProps}>
        <ClaimTeamPanel issueId={params.id} preview={preview} />
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
      </HotfixStageShell>
    );
  }

  if (stageKey === "pendingRdClaim") {
    const preview = await listAssignableMembers(params.id, actor.id);
    return (
      <HotfixStageShell title="RD 修正與自測" {...shellProps}>
        <AssignExecutorPanel issueId={params.id} preview={preview} />
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
      </HotfixStageShell>
    );
  }

  const [isResponsible, values, reassignPreview, governanceFixLinks] = await Promise.all([
    isActorResponsibleForExecutionStage(ctx),
    loadExecutionFieldValues(params.id, stageKey),
    listAssignableMembers(params.id, actor.id),
    loadGovernanceFixLinks(actor),
  ]);

  return (
    <HotfixStageShell
      title="RD 修正與自測"
      subtitle="填寫修正內容並完成自測後送出，將轉交 RD 主管簽核"
      headerActions={<ReassignExecutorDialog issueId={params.id} preview={reassignPreview} />}
      {...shellProps}
    >
      <ExecutorAssignmentSummary preview={reassignPreview} />
      {isResponsible ? (
        <ExecutionFieldsForm
          issueId={params.id}
          stageKey={stageKey}
          title="RD 修正內容"
          fields={RD_FIX_FIELDS}
          initialValues={values}
          saveAction={saveHotfixExecutionFieldsAction}
          submitAction={submitHotfixExecutionAction}
          submitLabel="送主管簽核"
          governanceFixLinks={governanceFixLinks}
        />
      ) : (
        <ExecutionFieldsReadOnly fields={RD_FIX_FIELDS} values={values} title="RD 修正內容" />
      )}
      <AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />
    </HotfixStageShell>
  );
}
