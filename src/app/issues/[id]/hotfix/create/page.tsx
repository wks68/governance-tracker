import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, isActorOriginalReporter, HotfixPageNotApplicableError } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { HOTFIX_PRIORITIES } from "@/lib/hotfix-ui/priority";
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
  const attachments = await listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey });

  return (
    <HotfixStageShell title="Hotfix 建立工單" subtitle="填寫工單基本資訊後送出，將轉交申請人直屬主管簽核" nineStageIndex={ctx.nineStageIndex} cancelled={ctx.cancelled} ticketBasicInfo={ctx.ticketBasicInfo} backHref={`/issues/${params.id}`}>
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
          }}
          priorities={HOTFIX_PRIORITIES}
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
