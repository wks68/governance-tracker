import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, isActorResponsibleForExecutionStage, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { RD_FIX_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
import { saveHotfixExecutionFieldsAction, submitHotfixExecutionAction } from "../execution-actions";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import WaitingNotice from "@/components/hotfix-nine-stage/WaitingNotice";
import ExecutionFieldsForm, { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";

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

  if (stageKey !== "rdInProgress") {
    return (
      <HotfixStageShell title="RD 修正與自測" nineStageIndex={ctx.nineStageIndex} cancelled={ctx.cancelled} ticketBasicInfo={ctx.ticketBasicInfo} backHref={`/issues/${params.id}`}>
        <WaitingNotice stageLabel={ctx.runtime.currentStage.label} />
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
      </HotfixStageShell>
    );
  }

  const isResponsible = await isActorResponsibleForExecutionStage(ctx);
  const values = await loadExecutionFieldValues(params.id, stageKey);

  return (
    <HotfixStageShell title="RD 修正與自測" subtitle="填寫修正內容並完成自測後送出，將轉交 RD 主管簽核" nineStageIndex={ctx.nineStageIndex} cancelled={ctx.cancelled} ticketBasicInfo={ctx.ticketBasicInfo} backHref={`/issues/${params.id}`}>
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
        />
      ) : (
        <ExecutionFieldsReadOnly fields={RD_FIX_FIELDS} values={values} title="RD 修正內容" />
      )}
      <AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />
    </HotfixStageShell>
  );
}
