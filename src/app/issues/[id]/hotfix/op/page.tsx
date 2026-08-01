import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import {
  loadHotfixPageContext,
  isActorResponsibleForExecutionStage,
  buildApprovalReviewViewData,
  HotfixPageNotApplicableError,
} from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { OP_DEPLOY_FIELDS, OP_RESULT_FIELDS, loadExecutionFieldValues } from "@/lib/hotfix-ui/executionFields";
import { listClaimableTeamsForStage, listAssignableMembers } from "@/lib/workflowExecutionService";
import { saveHotfixExecutionFieldsAction, submitHotfixExecutionAction } from "../execution-actions";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ClaimTeamPanel from "@/components/hotfix-nine-stage/ClaimTeamPanel";
import { ExecutionFieldsReadOnly } from "@/components/hotfix-nine-stage/ExecutionFieldsForm";
import { OpPreDeploymentForm, OpDeploymentResultForm } from "@/components/hotfix-nine-stage/OpDeploymentForms";
import ApprovalReviewPanel from "@/components/hotfix-nine-stage/ApprovalReviewPanel";
import ExecutorAssignmentSummary from "@/components/hotfix-nine-stage/ExecutorAssignmentSummary";

const ALLOWED = ["pendingOpTriage", "pendingOpClaim", "opPreparing", "opDeploying", "opCompleted"];

function OpSubsteps({ stageKey }: { stageKey: string }) {
  const current = stageKey === "opPreparing" ? 1 : stageKey === "opDeploying" ? 3 : 3;
  const approvedPre = stageKey === "opDeploying" || stageKey === "opCompleted";
  const steps = [
    { label: "上版前確認", done: approvedPre || stageKey === "opCompleted" },
    { label: "OP 主管上版前核准", done: approvedPre },
    { label: "正式環境部署紀錄", done: stageKey === "opCompleted" },
  ];
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">第 7 關子步驟</h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.label} className={`rounded-md border px-3 py-2 text-sm ${step.done ? "border-green-200 bg-green-50 text-green-800" : index + 1 === current ? "border-blue-200 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-500"}`}>
            {index + 1}. {step.label}{step.done ? " ✓" : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}

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
  const shellProps = { nineStageIndex: ctx.nineStageIndex, cancelled: ctx.cancelled, ticketBasicInfo: ctx.ticketBasicInfo, backHref: "/issues?view=hotfix", ctx };

  if (stageKey === "pendingOpTriage") {
    const preview = await listClaimableTeamsForStage(params.id, actor.id);
    return (
      <HotfixStageShell
        title="OP 上版"
        {...shellProps}
        main={<ClaimTeamPanel issueId={params.id} preview={preview} />}
        side={<AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />}
      />
    );
  }

  if (stageKey === "pendingOpClaim") {
    const preview = await listAssignableMembers(params.id, actor.id);
    return (
      <HotfixStageShell
        title="OP 上版"
        {...shellProps}
        main={<ExecutorAssignmentSummary issueId={params.id} preview={preview} />}
        side={<AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />}
      />
    );
  }

  const [isResponsible, reassignPreview] = await Promise.all([
    isActorResponsibleForExecutionStage(ctx),
    listAssignableMembers(params.id, actor.id),
  ]);

  if (stageKey === "opPreparing") {
    const values = await loadExecutionFieldValues(params.id, stageKey);
    return (
      <HotfixStageShell
        title="OP 上版"
        subtitle="填寫上版計畫後送出，將轉交 OP 主管簽核"
        {...shellProps}
        main={<div className="space-y-5">
        <ExecutorAssignmentSummary issueId={params.id} preview={reassignPreview} />
        <OpSubsteps stageKey={stageKey} />
        {isResponsible ? (
          <OpPreDeploymentForm
            issueId={params.id}
            initialValues={values}
            saveAction={saveHotfixExecutionFieldsAction}
            submitAction={submitHotfixExecutionAction}
          />
        ) : (
          <ExecutionFieldsReadOnly fields={OP_DEPLOY_FIELDS} values={values} title="上版計畫" />
        )}
        </div>}
        side={<AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />}
      />
    );
  }

  // opDeploying／opCompleted：OP 主管已核准通過，進入實際部署執行與結果記錄——內部仍歸類在
  // 「OP上版」（見 src/lib/hotfix-ui/nineStage.ts 說明），不新增第 10 個進度節點。承接團隊
  // 主管已核准後不可再重新指派；只保留目前執行資訊供查閱。
  const planValues = await loadExecutionFieldValues(params.id, "opPreparing");
  const resultValues = await loadExecutionFieldValues(params.id, "opDeploying");
  const postApprovalReview = stageKey === "opCompleted" ? await buildApprovalReviewViewData(ctx) : null;

  return (
    <HotfixStageShell
      title={stageKey === "opCompleted" ? "OP 主管上版後確認" : "OP 上版"}
      subtitle="OP 主管已核准，執行上版並記錄結果"
      {...shellProps}
      main={<div className="space-y-5">
      <ExecutorAssignmentSummary issueId={params.id} preview={reassignPreview} />
      <OpSubsteps stageKey={stageKey} />
      <ExecutionFieldsReadOnly fields={OP_DEPLOY_FIELDS} values={planValues} title="OP 上版前確認（已核准）" />

      {stageKey === "opDeploying" &&
        (isResponsible ? (
          <OpDeploymentResultForm
            issueId={params.id}
            initialValues={resultValues}
            saveAction={saveHotfixExecutionFieldsAction}
            submitAction={submitHotfixExecutionAction}
          />
        ) : (
          <ExecutionFieldsReadOnly fields={OP_RESULT_FIELDS} values={resultValues} title="正式環境部署紀錄" />
        ))}

      {stageKey === "opCompleted" && (
        <>
          <ExecutionFieldsReadOnly fields={OP_RESULT_FIELDS} values={resultValues} title="正式環境部署紀錄（已提交）" />
          {postApprovalReview && (
            <ApprovalReviewPanel
              issueId={params.id}
              approvalRecordId={postApprovalReview.approvalRecordId}
              roleLabel="維運主管"
              requestedByName={postApprovalReview.requestedByName}
              requestedAt={postApprovalReview.requestedAt}
              isResponsible={postApprovalReview.isResponsible}
              expectedApproverLabel={postApprovalReview.expectedApproverLabel}
            />
          )}
        </>
      )}
      </div>}
      side={<AttachmentSection issueId={params.id} items={attachments} readOnly={stageKey === "opCompleted" || !isResponsible} canUpload={stageKey !== "opCompleted" && isResponsible} />}
    />
  );
}
