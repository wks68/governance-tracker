import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { HOTFIX_PRIORITIES } from "@/lib/hotfix-ui/priority";
import { canActorEditHotfixDraft } from "@/lib/hotfix-ui/draftService";
import { resolveIssueCreationScope, listSelectableApplicants } from "@/lib/team-applicant/issueCreationScope";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import { normalizeHotfixTitleForStorage } from "@/lib/hotfix-ui/title";
import HotfixDraftForm from "./HotfixDraftForm";

export default async function HotfixCreatePage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadHotfixPageContext(params.id, actor, ["draft"]);
  } catch (err) {
    if (err instanceof HotfixPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }
  if (ctx.redirectTo) redirect(ctx.redirectTo);

  const isResponsible = await canActorEditHotfixDraft(params.id, actor.id);
  const [attachments, scope] = await Promise.all([
    listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey }),
    isResponsible ? resolveIssueCreationScope(actor.id) : Promise.resolve(null),
  ]);

  // 申請人下拉選單的初始選項一律由服務層提供（含正式角色名稱）。先前這裡沒有帶入清單，
  // 前端只好用申請人姓名自行拼一筆 roleLabel="" 的假選項，畫面因此顯示成「Jonus（ ）」。
  const formTeamId = scope?.fixedTeamId ?? ctx.issue.assignedTeamId ?? "";
  const formApplicantId = scope?.fixedApplicant?.id ?? ctx.issue.reporterUserId ?? "";
  const initialApplicants =
    isResponsible && scope && formTeamId && scope.canChooseApplicant && !scope.blockedReason
      ? await listSelectableApplicants(actor.id, formTeamId).catch(() => undefined)
      : scope?.fixedApplicant
        ? [scope.fixedApplicant]
      : undefined;

  return (
    <HotfixStageShell
      title="Hotfix 建立工單"
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref="/issues?view=hotfix"
      ctx={ctx}
      main={isResponsible ? (
        <HotfixDraftForm
          issueId={params.id}
          initialValues={{
            title: normalizeHotfixTitleForStorage(ctx.ticketBasicInfo.title),
            description: ctx.ticketBasicInfo.description,
            systemName: ctx.ticketBasicInfo.systemName,
            environment: ctx.ticketBasicInfo.environment,
            riskLevel: ctx.ticketBasicInfo.riskLevel,
            dueDate: ctx.ticketBasicInfo.dueDate ? ctx.ticketBasicInfo.dueDate.slice(0, 10) : "",
            hotfixPriority: ctx.ticketBasicInfo.hotfixPriority ?? "",
            teamId: formTeamId,
            applicantId: formApplicantId,
          }}
          priorities={HOTFIX_PRIORITIES}
          scope={scope!}
          initialApplicants={initialApplicants}
        />
      ) : (
        <section className="ui-card p-4">
          <p className="text-sm text-gray-500">僅原始填單人可編輯此階段，此頁為唯讀。</p>
        </section>
      )}
      side={<AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />}
    />
  );
}
