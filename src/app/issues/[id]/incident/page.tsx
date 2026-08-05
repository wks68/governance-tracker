import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadIncidentPageContext, buildIncidentApprovalReviewViewData, IncidentPageNotApplicableError } from "@/lib/incident-ui/pageContext";
import { evaluateCurrentIncidentActorTask } from "@/lib/incident-ui/incidentResponsibilityService";
import { INCIDENT_TECHNICAL_TEAM_FIELD_KEY, readIncidentField } from "@/lib/workflow-execution/incidentAssignmentService";
import { INCIDENT_NINE_STAGES, incidentNineStageLabelOfIndex } from "@/lib/incident-ui/incidentStage";
import { loadGovernanceRelationViewForActor } from "@/lib/issue-relations/viewService";
import NineStageProgressBar from "@/components/hotfix-nine-stage/NineStageProgressBar";
import WorkflowZLayout from "@/components/workflow-execution/WorkflowZLayout";
import GovernanceRelationsCard from "@/components/issue-relations/GovernanceRelationsCard";
import IncidentActionPanel from "@/components/incident-nine-stage/IncidentActionPanel";
import IncidentWorkflowHistory from "@/components/incident-nine-stage/IncidentWorkflowHistory";
import AppPageBreadcrumb from "@/components/app-shell/AppPageBreadcrumb";
import ScrollDownChevron from "@/components/ui/ScrollDownChevron";
import IssueAttachmentSection from "@/components/issue-attachments/IssueAttachmentSection";
import { listIssueAttachments } from "@/lib/issue-attachments/service";
import { formatDateTime } from "@/lib/datetime";

export default async function IncidentDetailPage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadIncidentPageContext(params.id, actor);
  } catch (err) {
    if (err instanceof IncidentPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }

  const stageKey = ctx.runtime.currentStage.stageKey;
  const [task, review, relationView, attachments] = await Promise.all([
    evaluateCurrentIncidentActorTask(params.id, actor.id),
    buildIncidentApprovalReviewViewData(ctx),
    loadGovernanceRelationViewForActor(actor.id, params.id),
    listIssueAttachments(params.id, { actorId: actor.id }),
  ]);

  const isResponsible = stageKey === "pendingClosureConfirmation" ? (review?.isResponsible ?? false) : task?.action !== "VIEW_ONLY";
  const canUploadAttachments = isResponsible || ctx.issue.reporterUserId === actor.id;

  // 各關卡表單所需的預覽資料，只在對應關卡才查詢，避免不必要的額外查詢。
  let intakeTeamId: string | null = null;
  let candidateTeams: Array<{ id: string; name: string }> = [];
  let technicalTeamMembers: Array<{ id: string; name: string }> = [];

  if (stageKey === "pendingIntake") {
    const membership = await prisma.teamMember.findFirst({
      where: { userId: actor.id, isActive: true, membershipRole: "LEAD", team: { domain: "INCIDENT", isActive: true } },
    });
    intakeTeamId = membership?.teamId ?? null;
  } else if (stageKey === "pendingUnitAssignment") {
    const teams = await prisma.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    candidateTeams = teams.map((t) => ({ id: t.id, name: t.name }));
  } else if (stageKey === "pendingTechLeadClaim") {
    const technicalTeamId = await readIncidentField(prisma, params.id, INCIDENT_TECHNICAL_TEAM_FIELD_KEY);
    if (technicalTeamId) {
      const members = await prisma.teamMember.findMany({ where: { teamId: technicalTeamId, isActive: true, membershipRole: "MEMBER" }, include: { user: true } });
      technicalTeamMembers = members.filter((m) => m.user.isActive).map((m) => ({ id: m.userId, name: m.user.name }));
    }
  }

  const terminalComplete = stageKey === "closed";
  const currentStageLabel = ctx.nineStageIndex !== null ? incidentNineStageLabelOfIndex(ctx.nineStageIndex) : ctx.runtime.currentStage.label;

  return (
    <div className="incident-shell mx-auto max-w-[100rem] space-y-4 pb-20 sm:space-y-5 xl:space-y-6">
      <AppPageBreadcrumb label={`工作管理／事件通報（${ctx.ticketBasicInfo.issueKey}）`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-text-primary sm:text-2xl">事件通報（{ctx.ticketBasicInfo.issueKey}）流程狀態</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-text-secondary">{isResponsible ? "請完成本關卡的操作或簽核。" : "您不屬於本事件目前關卡處理團隊，本頁僅提供進度及相關紀錄查閱。"}</p>
        </div>
      </div>

      <div data-hotfix-scroll-section className="ui-card scroll-mt-24 p-4 sm:p-5">
        <NineStageProgressBar
          issueId={ctx.issue.id}
          currentIndex={ctx.nineStageIndex}
          terminalComplete={terminalComplete}
          stages={INCIDENT_NINE_STAGES}
          ariaLabel="事件通報九階段流程進度"
          storageKeyPrefix="dms-incident-progress"
        />
      </div>

      <WorkflowZLayout
        topLeft={
          <section className="ui-card p-5 sm:p-6">
            <h2 className="text-base font-semibold text-text-primary">事件基本資訊</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div><dt className="text-xs text-text-muted">事件編號</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.issueKey}</dd></div>
              <div><dt className="text-xs text-text-muted">通報人</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.reporterName || "尚未提供"}</dd></div>
              <div><dt className="text-xs text-text-muted">事件受理團隊</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.teamName || "尚待承接"}</dd></div>
              <div><dt className="text-xs text-text-muted">環境</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.environment || "尚未提供"}</dd></div>
              <div><dt className="text-xs text-text-muted">系統名稱</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.systemName || "尚未提供"}</dd></div>
              <div><dt className="text-xs text-text-muted">事件類型</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.incidentType ?? "尚未提供"}</dd></div>
              <div><dt className="text-xs text-text-muted">通報人初步影響感受</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.suggestedImpactLevel ?? "尚未提供"}</dd></div>
              <div><dt className="text-xs text-text-muted">正式事件等級</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.formalSeverity ?? "尚未分級"}</dd></div>
            </dl>
            <div className="mt-5 border-t border-border pt-4">
              <dt className="text-xs font-medium text-text-muted">事件名稱</dt>
              <dd className="mt-1 font-medium text-text-primary">{ctx.ticketBasicInfo.title || "尚未命名"}</dd>
            </div>
            <div className="mt-4">
              <dt className="text-xs font-medium text-text-muted">事件摘要</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{ctx.ticketBasicInfo.description || "尚未提供"}</dd>
            </div>
          </section>
        }
        topRight={
          <section className="ui-card p-5 sm:p-6" aria-label="目前事件流程">
            <h2 className="text-base font-semibold text-text-primary">目前事件流程</h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <div><dt className="text-xs font-medium text-text-muted">目前階段</dt><dd className="mt-1 font-semibold text-primary">{currentStageLabel}</dd></div>
              <div><dt className="text-xs font-medium text-text-muted">目前待辦</dt><dd className="mt-1 font-medium text-text-primary">{task?.businessStatusLabel ?? (terminalComplete ? "已結案" : "—")}</dd></div>
              <div>
                <dt className="text-xs font-medium text-text-muted">目前等待人員／執行人</dt>
                <dd className="mt-1 font-medium text-text-primary">{task?.waitingRoleLabel ?? "—"}</dd>
              </div>
              {ctx.issue.stageEnteredAt && (
                <div><dt className="text-xs font-medium text-text-muted">進入本關時間</dt><dd className="mt-1 font-medium text-text-primary">{formatDateTime(ctx.issue.stageEnteredAt)}</dd></div>
              )}
            </dl>
          </section>
        }
        contentLeft={
          <IncidentActionPanel
            issueId={ctx.issue.id}
            stageKey={stageKey}
            isResponsible={isResponsible}
            waitingRoleLabel={task?.waitingRoleLabel ?? "—"}
            intakeTeamId={intakeTeamId}
            suggestedSeverity={ctx.ticketBasicInfo.suggestedImpactLevel}
            candidateTeams={candidateTeams}
            technicalTeamMembers={technicalTeamMembers}
            approvalRecordId={review?.approvalRecordId ?? null}
          />
        }
        governance={<GovernanceRelationsCard view={relationView} />}
        attachments={<IssueAttachmentSection issueId={ctx.issue.id} items={attachments} canUpload={canUploadAttachments} />}
        after={<IncidentWorkflowHistory issueId={ctx.issue.id} />}
      />
      <ScrollDownChevron />
    </div>
  );
}
