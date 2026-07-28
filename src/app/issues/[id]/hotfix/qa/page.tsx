import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, isActorResponsibleForExecutionStage, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { QA_VERIFY_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
import { saveHotfixExecutionFieldsAction, submitHotfixExecutionAction } from "../execution-actions";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import WaitingNotice from "@/components/hotfix-nine-stage/WaitingNotice";
import ExecutionFieldsForm, { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";

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

  if (stageKey !== "qaInProgress") {
    return (
      <HotfixStageShell title="QA 驗證" nineStageIndex={ctx.nineStageIndex} cancelled={ctx.cancelled} ticketBasicInfo={ctx.ticketBasicInfo} backHref={`/issues/${params.id}`} ctx={ctx}>
        <WaitingNotice stageLabel={ctx.runtime.currentStage.label} />
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
      </HotfixStageShell>
    );
  }

  const isResponsible = await isActorResponsibleForExecutionStage(ctx);
  const values = await loadExecutionFieldValues(params.id, stageKey);

  return (
    <HotfixStageShell title="QA 驗證" subtitle="完成驗證後送出，將轉交 QA 主管簽核" nineStageIndex={ctx.nineStageIndex} cancelled={ctx.cancelled} ticketBasicInfo={ctx.ticketBasicInfo} backHref={`/issues/${params.id}`} ctx={ctx}>
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
        />
      ) : (
        <ExecutionFieldsReadOnly fields={QA_VERIFY_FIELDS} values={values} title="QA 驗證內容" />
      )}
      <AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />
    </HotfixStageShell>
  );
}
