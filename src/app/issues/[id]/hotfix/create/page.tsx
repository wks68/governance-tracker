import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, isActorOriginalReporter, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { HOTFIX_PRIORITIES } from "@/lib/hotfix-ui/priority";
import { listCreatableTeamsForActor, listActiveApplicantsForTeam } from "@/lib/team-applicant/teamApplicantService";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
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

  const isResponsible = isActorOriginalReporter(ctx);
  const [attachments, teams] = await Promise.all([
    listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey }),
    isResponsible ? listCreatableTeamsForActor(actor.id) : Promise.resolve([]),
  ]);

  // 申請人下拉選單的初始選項一律由服務層提供（含正式角色名稱）。先前這裡沒有帶入清單，
  // 前端只好用申請人姓名自行拼一筆 roleLabel="" 的假選項，畫面因此顯示成「Jonus（ ）」。
  const initialApplicants =
    isResponsible && ctx.issue.assignedTeamId
      ? await listActiveApplicantsForTeam(actor.id, ctx.issue.assignedTeamId).catch(() => undefined)
      : undefined;

  return (
    <HotfixStageShell title="Hotfix 建立工單" nineStageIndex={ctx.nineStageIndex} cancelled={ctx.cancelled} ticketBasicInfo={ctx.ticketBasicInfo} backHref={`/issues/${params.id}`} ctx={ctx}>
      {isResponsible ? (
        <HotfixDraftForm
          issueId={params.id}
          initialValues={{
            title: ctx.ticketBasicInfo.title,
            description: ctx.ticketBasicInfo.description,
            systemName: ctx.ticketBasicInfo.systemName,
            environment: ctx.ticketBasicInfo.environment,
            riskLevel: ctx.ticketBasicInfo.riskLevel,
            dueDate: ctx.ticketBasicInfo.dueDate ? ctx.ticketBasicInfo.dueDate.slice(0, 10) : "",
            hotfixPriority: ctx.ticketBasicInfo.hotfixPriority ?? "",
            teamId: ctx.issue.assignedTeamId ?? "",
            applicantId: ctx.issue.reporterUserId ?? "",
          }}
          priorities={HOTFIX_PRIORITIES}
          teams={teams}
          initialApplicants={initialApplicants}
        />
      ) : (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">僅原始填單人可編輯此階段，此頁為唯讀。</p>
        </section>
      )}
      <AttachmentSection issueId={params.id} items={attachments} readOnly={!isResponsible} canUpload={isResponsible} />
    </HotfixStageShell>
  );
}
