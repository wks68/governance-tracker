import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, isActorResponsibleForExecutionStage, loadGovernanceFixLinks, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { OP_DEPLOY_FIELDS, OP_RESULT_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
import { listClaimableTeamsForStage, listAssignableMembers } from "@/lib/workflowExecutionService";
import { saveHotfixExecutionFieldsAction, submitHotfixExecutionAction, advanceHotfixOpDeploymentAction } from "../execution-actions";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ClaimTeamPanel from "@/components/hotfix-nine-stage/ClaimTeamPanel";
import AssignExecutorPanel from "@/components/hotfix-nine-stage/AssignExecutorPanel";
import ExecutionFieldsForm, { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";
import OpCompletedContinueButton from "./OpCompletedContinueButton";

const ALLOWED = ["pendingOpTriage", "pendingOpClaim", "opPreparing", "opDeploying", "opCompleted"];

export default async function HotfixOpPage({ params }: { params: { id: string } }) {
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

  if (stageKey === "pendingOpTriage") {
    const preview = await listClaimableTeamsForStage(params.id, actor.id);
    return (
      <HotfixStageShell title="OP 上版" {...shellProps}>
        <ClaimTeamPanel issueId={params.id} preview={preview} />
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
      </HotfixStageShell>
    );
  }

  if (stageKey === "pendingOpClaim") {
    const preview = await listAssignableMembers(params.id, actor.id);
    return (
      <HotfixStageShell title="OP 上版" {...shellProps}>
        <AssignExecutorPanel issueId={params.id} preview={preview} />
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
      </HotfixStageShell>
    );
  }

  const [isResponsible, reassignPreview, governanceFixLinks] = await Promise.all([
    isActorResponsibleForExecutionStage(ctx),
    listAssignableMembers(params.id, actor.id),
    loadGovernanceFixLinks(actor),
  ]);

  if (stageKey === "opPreparing") {
    const values = await loadExecutionFieldValues(params.id, stageKey);
    return (
      <HotfixStageShell title="OP 上版" subtitle="填寫上版計畫後送出，將轉交 OP 主管簽核" {...shellProps}>
        <AssignExecutorPanel issueId={params.id} preview={reassignPreview} />
        {isResponsible ? (
          <ExecutionFieldsForm
            issueId={params.id}
            stageKey={stageKey}
            title="上版計畫"
            fields={OP_DEPLOY_FIELDS}
            initialValues={values}
            saveAction={saveHotfixExecutionFieldsAction}
            submitAction={submitHotfixExecutionAction}
            submitLabel="送主管簽核"
            governanceFixLinks={governanceFixLinks}
          />
        ) : (
          <ExecutionFieldsReadOnly fields={OP_DEPLOY_FIELDS} values={values} title="上版計畫" />
        )}
        <AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />
      </HotfixStageShell>
    );
  }

  // opDeploying／opCompleted：OP 主管已核准通過，進入實際部署執行與結果記錄——內部仍歸類在
  // 「OP上版」（見 src/lib/hotfix-ui/nineStage.ts 說明），不新增第 10 個進度節點。承接團隊
  // Lead 仍可在此重新指派執行人（例如原指派者臨時無法處理部署結果記錄），與 opPreparing
  // 階段規則相同：僅承接團隊 active Lead 可操作，必填 reasonCode，寫入 AuditLog。
  const planValues = await loadExecutionFieldValues(params.id, "opPreparing");
  const resultValues = await loadExecutionFieldValues(params.id, "opDeploying");

  return (
    <HotfixStageShell title="OP 上版" subtitle="OP 主管已核准，執行上版並記錄結果" {...shellProps}>
      <AssignExecutorPanel issueId={params.id} preview={reassignPreview} />
      <ExecutionFieldsReadOnly fields={OP_DEPLOY_FIELDS} values={planValues} title="上版計畫（已核准）" />

      {stageKey === "opDeploying" &&
        (isResponsible ? (
          <ExecutionFieldsForm
            issueId={params.id}
            stageKey="opDeploying"
            title="上版結果記錄"
            fields={OP_RESULT_FIELDS}
            initialValues={resultValues}
            saveAction={saveHotfixExecutionFieldsAction}
            submitAction={submitHotfixExecutionAction}
            submitLabel="確認上版完成"
          />
        ) : (
          <ExecutionFieldsReadOnly fields={OP_RESULT_FIELDS} values={resultValues} title="上版結果記錄" />
        ))}

      {stageKey === "opCompleted" && (
        <>
          <ExecutionFieldsReadOnly fields={OP_RESULT_FIELDS} values={resultValues} title="上版結果記錄（已完成）" />
          {isResponsible ? (
            <OpCompletedContinueButton issueId={params.id} />
          ) : (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-500">上版已完成，待開放結案確認。</p>
            </section>
          )}
        </>
      )}

      <AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />
    </HotfixStageShell>
  );
}
