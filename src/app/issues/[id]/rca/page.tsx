import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadRcaPageContext, buildRcaApprovalReviewViewData, buildRcaManagementConfirmationViewData, RcaPageNotApplicableError } from "@/lib/rca-ui/pageContext";
import { evaluateCurrentRcaActorTask } from "@/lib/rca-ui/rcaResponsibilityService";
import { RCA_STAGES, rcaStageLabelOfIndex } from "@/lib/rca-ui/rcaStage";
import { loadGovernanceRelationViewForActor } from "@/lib/issue-relations/viewService";
import NineStageProgressBar from "@/components/hotfix-nine-stage/NineStageProgressBar";
import WorkflowZLayout from "@/components/workflow-execution/WorkflowZLayout";
import GovernanceRelationsCard from "@/components/issue-relations/GovernanceRelationsCard";
import RcaActionPanel from "@/components/rca-nine-stage/RcaActionPanel";
import RcaActionItemsPanel, { type RcaActionItemRow } from "@/components/rca-nine-stage/RcaActionItemsPanel";
import RcaWorkflowHistory from "@/components/rca-nine-stage/RcaWorkflowHistory";
import AppPageBreadcrumb from "@/components/app-shell/AppPageBreadcrumb";
import ScrollDownChevron from "@/components/ui/ScrollDownChevron";
import IssueAttachmentSection from "@/components/issue-attachments/IssueAttachmentSection";
import { listIssueAttachments } from "@/lib/issue-attachments/service";
import { formatDateTime } from "@/lib/datetime";

const DECIDED_APPROVAL_LABEL: Record<string, string> = {
  RCA_TECHNICAL_REVIEW: "負責單位主管技術審查",
  RCA_SECURITY_INTEGRITY_REVIEW: "資安推動小組完整性審查",
  RCA_VP_CONFIRMATION: "DMS 副部長確認",
  RCA_DIRECTOR_APPROVAL: "DMS 部長核准",
  RCA_SECURITY_VERIFICATION_CONFIRMATION: "專業驗證與資安確認",
  RCA_CLOSURE_CONFIRMATION: "RCA 結案確認",
};

export default async function RcaDetailPage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadRcaPageContext(params.id, actor);
  } catch (err) {
    if (err instanceof RcaPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }

  const stageKey = ctx.runtime.currentStage.stageKey;
  const [task, review, managementReview, relationView, actionItems, decidedApprovals, rcaAttachments] = await Promise.all([
    evaluateCurrentRcaActorTask(params.id, actor.id),
    buildRcaApprovalReviewViewData(ctx),
    buildRcaManagementConfirmationViewData(ctx),
    loadGovernanceRelationViewForActor(actor.id, params.id),
    prisma.rcaActionItem.findMany({ where: { rcaIssueId: params.id }, orderBy: { sequence: "asc" } }),
    prisma.approvalRecord.findMany({
      where: { issueId: params.id, decision: { not: "PENDING" }, approvalType: { in: Object.keys(DECIDED_APPROVAL_LABEL) } },
      orderBy: { decidedAt: "desc" },
    }),
    listIssueAttachments(params.id, { actorId: actor.id }),
  ]);
  const rcaLevelAttachments = rcaAttachments.filter((a) => a.actionItemId === null);
  const attachmentsByActionItemId: Record<string, typeof rcaAttachments> = {};
  for (const attachment of rcaAttachments) {
    if (!attachment.actionItemId) continue;
    (attachmentsByActionItemId[attachment.actionItemId] ??= []).push(attachment);
  }

  const isResponsible = stageKey === "pendingManagementConfirmation"
    ? Boolean(managementReview?.vp?.isResponsible || managementReview?.director?.isResponsible)
    : review
      ? review.isResponsible
      : task?.action !== "VIEW_ONLY";

  const managementSlice = stageKey === "pendingManagementConfirmation"
    ? managementReview?.director ?? managementReview?.vp ?? null
    : null;

  let candidateOwners: Array<{ id: string; name: string }> = [];
  if (ctx.issue.assignedTeamId && (stageKey === "pendingRcaOwnerAssignment" || stageKey === "rcaAnalysisInProgress" || stageKey === "improvementInProgress" || stageKey === "pendingImprovementEvidence")) {
    const members = await prisma.teamMember.findMany({ where: { teamId: ctx.issue.assignedTeamId, isActive: true }, include: { user: true } });
    candidateOwners = members.filter((m) => m.user.isActive).map((m) => ({ id: m.userId, name: m.user.name }));
  }

  const canManageActionItems = Boolean(ctx.issue.assignedTeamId) &&
    ["rcaAnalysisInProgress", "improvementInProgress", "pendingImprovementEvidence"].includes(stageKey) &&
    task?.action === "ENTER_WORK";
  const canVerifyActionItems = stageKey === "pendingVerificationConfirmation" && task?.isMineToApprove === true;

  const actionItemRows: RcaActionItemRow[] = await Promise.all(actionItems.map(async (item) => {
    const [ownerTeam, ownerUser] = await Promise.all([
      item.ownerTeamId ? prisma.team.findUnique({ where: { id: item.ownerTeamId } }) : Promise.resolve(null),
      item.ownerUserId ? prisma.user.findUnique({ where: { id: item.ownerUserId } }) : Promise.resolve(null),
    ]);
    return {
      id: item.id,
      sequence: item.sequence,
      type: item.type,
      description: item.description,
      ownerTeamName: ownerTeam?.name ?? null,
      ownerUserName: ownerUser?.name ?? null,
      plannedCompletionDate: item.plannedCompletionDate ? item.plannedCompletionDate.toISOString() : "",
      actualCompletionDate: item.actualCompletionDate ? item.actualCompletionDate.toISOString() : null,
      status: item.status,
      evidenceSummary: item.evidenceSummary,
      verificationMethod: item.verificationMethod,
      verificationStatus: item.verificationStatus,
      verificationNote: item.verificationNote,
      extensionReason: item.extensionReason,
    };
  }));

  const analysisFieldRows = await prisma.issueFieldValue.findMany({
    where: {
      issueId: params.id,
      fieldKey: { in: ["rcaDirectCause", "rcaRootCause", "rcaControlFailurePoint", "rcaCauseType", "rcaAnalysisMethods", "rcaConclusion", "rcaActualImpact", "rcaVerificationMethod", "rcaEvidenceSummary"] },
    },
  });
  const analysisByKey = new Map(analysisFieldRows.map((row) => [row.fieldKey, row.fieldValue]));

  const decidedByActorIds = Array.from(new Set(decidedApprovals.map((r) => r.approverUserId).filter((v): v is string => Boolean(v))));
  const decidedByUsers = decidedByActorIds.length ? await prisma.user.findMany({ where: { id: { in: decidedByActorIds } } }) : [];
  const decidedByNameById = new Map(decidedByUsers.map((u) => [u.id, u.name]));

  const terminalComplete = stageKey === "rcaClosed";
  const currentStageLabel = ctx.stageIndex !== null ? rcaStageLabelOfIndex(ctx.stageIndex) : ctx.runtime.currentStage.label;

  return (
    <div className="rca-shell mx-auto max-w-[100rem] space-y-4 pb-20 sm:space-y-5 xl:space-y-6">
      <AppPageBreadcrumb label={`工作管理／RCA（${ctx.ticketBasicInfo.issueKey}）`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-text-primary sm:text-2xl">RCA（{ctx.ticketBasicInfo.issueKey}）流程狀態</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-text-secondary">{isResponsible ? "請完成本關卡的操作或簽核。" : "您不屬於本 RCA 目前關卡處理團隊，本頁僅提供進度及相關紀錄查閱。"}</p>
        </div>
      </div>

      <div data-hotfix-scroll-section className="ui-card scroll-mt-24 p-4 sm:p-5">
        <NineStageProgressBar
          issueId={ctx.issue.id}
          currentIndex={ctx.stageIndex}
          terminalComplete={terminalComplete}
          stages={RCA_STAGES}
          ariaLabel="RCA 十二階段流程進度"
          storageKeyPrefix="dms-rca-progress"
        />
      </div>

      <WorkflowZLayout
        topLeft={
          <section className="ui-card p-5 sm:p-6">
            <h2 className="text-base font-semibold text-text-primary">RCA 基本資訊</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div><dt className="text-xs text-text-muted">RCA 編號</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.issueKey}</dd></div>
              <div><dt className="text-xs text-text-muted">來源事件</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.sourceIncidentKey ? `${ctx.ticketBasicInfo.sourceIncidentKey}｜${ctx.ticketBasicInfo.sourceIncidentName ?? ""}` : "—"}</dd></div>
              <div><dt className="text-xs text-text-muted">來源事件等級</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.sourceIncidentSeverity ?? "—"}</dd></div>
              <div><dt className="text-xs text-text-muted">RCA 負責單位</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.responsibleTeamName ?? "尚待承接"}</dd></div>
              <div><dt className="text-xs text-text-muted">RCA 主責人</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.ownerName ?? "尚未指派"}</dd></div>
              <div><dt className="text-xs text-text-muted">系統名稱</dt><dd className="mt-0.5 text-sm text-text-primary">{ctx.ticketBasicInfo.systemName || "尚未提供"}</dd></div>
            </dl>
            <div className="mt-5 border-t border-border pt-4">
              <dt className="text-xs font-medium text-text-muted">RCA 標題</dt>
              <dd className="mt-1 font-medium text-text-primary">{ctx.ticketBasicInfo.title}</dd>
            </div>
            <div className="mt-4">
              <dt className="text-xs font-medium text-text-muted">來源事件摘要</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{ctx.ticketBasicInfo.sourceIncidentSummary ?? "—"}</dd>
            </div>
          </section>
        }
        topRight={
          <section className="ui-card p-5 sm:p-6" aria-label="目前RCA流程">
            <h2 className="text-base font-semibold text-text-primary">目前 RCA 流程</h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <div><dt className="text-xs font-medium text-text-muted">目前階段</dt><dd className="mt-1 font-semibold text-primary">{currentStageLabel}</dd></div>
              <div><dt className="text-xs font-medium text-text-muted">目前待辦</dt><dd className="mt-1 font-medium text-text-primary">{task?.businessStatusLabel ?? (terminalComplete ? "已結案" : "—")}</dd></div>
              <div><dt className="text-xs font-medium text-text-muted">目前等待人員／單位</dt><dd className="mt-1 font-medium text-text-primary">{task?.waitingRoleLabel ?? "—"}</dd></div>
              {ctx.issue.stageEnteredAt && (
                <div><dt className="text-xs font-medium text-text-muted">進入本關時間</dt><dd className="mt-1 font-medium text-text-primary">{formatDateTime(ctx.issue.stageEnteredAt)}</dd></div>
              )}
            </dl>
          </section>
        }
        contentLeft={
          <section data-hotfix-scroll-section className="ui-card scroll-mt-24 p-5 sm:p-6">
            <h2 className="text-base font-semibold text-text-primary">根因分析</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-xs font-medium text-text-muted">直接原因</dt><dd className="mt-1 whitespace-pre-wrap text-text-primary">{analysisByKey.get("rcaDirectCause") ?? "尚未提供"}</dd></div>
              <div><dt className="text-xs font-medium text-text-muted">根本原因</dt><dd className="mt-1 whitespace-pre-wrap text-text-primary">{analysisByKey.get("rcaRootCause") ?? "尚未提供"}</dd></div>
              <div><dt className="text-xs font-medium text-text-muted">控制失效點</dt><dd className="mt-1 whitespace-pre-wrap text-text-primary">{analysisByKey.get("rcaControlFailurePoint") ?? "—"}</dd></div>
              <div><dt className="text-xs font-medium text-text-muted">原因類型</dt><dd className="mt-1 text-text-primary">{analysisByKey.get("rcaCauseType") ?? "—"}</dd></div>
              <div><dt className="text-xs font-medium text-text-muted">分析方法</dt><dd className="mt-1 text-text-primary">{analysisByKey.get("rcaAnalysisMethods") ?? "—"}</dd></div>
              <div><dt className="text-xs font-medium text-text-muted">RCA 結論</dt><dd className="mt-1 whitespace-pre-wrap text-text-primary">{analysisByKey.get("rcaConclusion") ?? "尚未提供"}</dd></div>
            </dl>
          </section>
        }
        contentRight={
          <section data-hotfix-scroll-section className="ui-card scroll-mt-24 p-5 sm:p-6">
            <h2 className="text-base font-semibold text-text-primary">實際影響</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-text-primary">{analysisByKey.get("rcaActualImpact") ?? "尚未提供"}</p>
            <div className="mt-4 border-t border-border pt-3">
              <dt className="text-xs font-medium text-text-muted">改善佐證摘要</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{analysisByKey.get("rcaEvidenceSummary") ?? "尚未提交"}</dd>
            </div>
          </section>
        }
        governance={<GovernanceRelationsCard view={relationView} />}
        approval={
          <section data-hotfix-scroll-section className="ui-card scroll-mt-24 p-5 sm:p-6">
            <h2 className="text-base font-semibold text-text-primary">審查與核准</h2>
            {decidedApprovals.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">尚無已完成的審查或核准紀錄。</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {decidedApprovals.map((r) => (
                  <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-text-primary">{DECIDED_APPROVAL_LABEL[r.approvalType] ?? r.approvalType}</span>
                      <span className={r.decision === "APPROVED" ? "text-workflow-complete-deep" : "text-danger-text"}>{r.decision === "APPROVED" ? "通過" : "駁回"}</span>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {r.approverUserId ? decidedByNameById.get(r.approverUserId) ?? "（未知）" : "（未知）"} · {r.decidedAt ? formatDateTime(r.decidedAt) : "—"}
                    </p>
                    {r.decisionComment && <p className="mt-1 whitespace-pre-wrap text-text-primary">{r.decisionComment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        }
        attachments={
          <RcaActionItemsPanel
            issueId={ctx.issue.id}
            items={actionItemRows}
            canManage={canManageActionItems}
            canVerify={canVerifyActionItems}
            candidateOwnerTeamId={ctx.issue.assignedTeamId}
            candidateOwnerMembers={candidateOwners}
            attachmentsByActionItemId={attachmentsByActionItemId}
          />
        }
        after={
          <>
            <RcaActionPanel
              issueId={ctx.issue.id}
              stageKey={stageKey}
              isResponsible={isResponsible}
              waitingRoleLabel={task?.waitingRoleLabel ?? "—"}
              candidateOwners={candidateOwners}
              managementReview={managementSlice ? { approvalType: managementSlice.approvalType as "RCA_VP_CONFIRMATION" | "RCA_DIRECTOR_APPROVAL", isResponsible: managementSlice.isResponsible, decisionPending: true } : null}
            />
            <div data-hotfix-scroll-section className="scroll-mt-24">
              <IssueAttachmentSection issueId={ctx.issue.id} items={rcaLevelAttachments} canUpload={task?.action !== "VIEW_ONLY"} />
            </div>
            <div data-hotfix-scroll-section className="scroll-mt-24">
              <RcaWorkflowHistory issueId={ctx.issue.id} />
            </div>
          </>
        }
      />
      <ScrollDownChevron />
    </div>
  );
}
