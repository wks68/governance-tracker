import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, isActorResponsibleForExecutionStage, loadGovernanceFixLinks, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { QA_VERIFY_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
import { listClaimableTeamsForStage, listAssignableMembers } from "@/lib/workflowExecutionService";
import { saveHotfixExecutionFieldsAction, submitHotfixExecutionAction } from "../execution-actions";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ClaimTeamPanel from "@/components/hotfix-nine-stage/ClaimTeamPanel";
import ExecutionFieldsForm, { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";
import ExecutorAssignmentSummary from "@/components/hotfix-nine-stage/ExecutorAssignmentSummary";

const ALLOWED = ["pendingQaTriage", "pendingQaClaim", "qaInProgress"];

export default async function HotfixQaPage({ params }: { params: { id: string } }) {
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
  const shellProps = { nineStageIndex: ctx.nineStageIndex, cancelled: ctx.cancelled, ticketBasicInfo: ctx.ticketBasicInfo, backHref: "/issues?view=hotfix", ctx };

  if (stageKey === "pendingQaTriage") {
    const preview = await listClaimableTeamsForStage(params.id, actor.id);
    return (
      <HotfixStageShell
        title="QA 驗證"
        {...shellProps}
        main={<ClaimTeamPanel issueId={params.id} preview={preview} />}
        side={<AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />}
      />
    );
  }

  if (stageKey === "pendingQaClaim") {
    const preview = await listAssignableMembers(params.id, actor.id);
    return (
      <HotfixStageShell
        title="QA 驗證"
        {...shellProps}
        main={<ExecutorAssignmentSummary issueId={params.id} preview={preview} />}
        side={<AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />}
      />
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
      title="QA 驗證"
      subtitle="完成驗證後送出，將轉交 QA 主管簽核"
      {...shellProps}
      main={<>
        <ExecutorAssignmentSummary issueId={params.id} preview={reassignPreview} />
        <div className="mt-5">
          {isResponsible ? (
        <ExecutionFieldsForm
          issueId={params.id}
          stageKey={stageKey}
          title="QA 驗證內容"
          fields={QA_VERIFY_FIELDS}
          initialValues={values}
          saveAction={saveHotfixExecutionFieldsAction}
          submitAction={submitHotfixExecutionAction}
          submitLabel="送主管簽核"
          governanceFixLinks={governanceFixLinks}
        />
      ) : (
        <ExecutionFieldsReadOnly fields={QA_VERIFY_FIELDS} values={values} title="QA 驗證內容" />
      )}
        </div>
      </>}
      side={<AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />}
    />
  );
}
