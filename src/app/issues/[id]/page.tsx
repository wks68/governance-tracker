import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/auth";
import { issueTypeLabel } from "@/lib/constants";
import { getVisibleFieldTemplate, getWorkflow, nextStatusOf, prevStatusOf, statusLabel } from "@/lib/workflow";
import { evaluateGateRules } from "@/lib/gateRules";
import {
  isIssueOnVersionedWorkflow,
  getIssueWorkflowRuntime,
  getIssueWorkflowHistory,
  hasExecutionCapability,
  listSelectablePublishedVersionsForIssueType,
  type AvailableTransitionPreview,
} from "@/lib/workflowExecutionService";
import CurrentStagePanel from "@/components/workflow-execution/CurrentStagePanel";
import StatusBadge from "@/components/StatusBadge";
import WorkflowProgress from "@/components/WorkflowProgress";
import DynamicFieldsEditForm from "@/components/DynamicFieldsEditForm";
import { DynamicOption } from "@/components/DynamicFieldsForm";
import GateCheckPanel from "@/components/GateCheckPanel";
import WorkflowActions from "@/components/WorkflowActions";
import EvidenceList from "@/components/EvidenceList";
import CommentList from "@/components/CommentList";
import AuditLogList from "@/components/AuditLogList";
import AiAssistantPanel from "@/components/AiAssistantPanel";
import StageRequirementsPanel from "@/components/workflow-execution/StageRequirementsPanel";
import StartWorkflowPanel from "@/components/workflow-execution/StartWorkflowPanel";
import HotfixStatusHeader from "@/components/hotfix-execution/HotfixStatusHeader";
import HotfixTodoList from "@/components/hotfix-execution/HotfixTodoList";
import HotfixApprovalPanel from "@/components/hotfix-execution/HotfixApprovalPanel";
import HotfixRiskCheckPanel from "@/components/hotfix-execution/HotfixRiskCheckPanel";
import HotfixActionPanels from "@/components/hotfix-execution/HotfixActionPanels";
import HotfixHistoryTimeline from "@/components/hotfix-execution/HotfixHistoryTimeline";
import { buildHotfixRuntimeView, getRiskCheckItemsForStage } from "@/lib/hotfix-ui/runtimeView";
import { transitionCopyOf } from "@/lib/hotfix-ui/transitionCopy";
import type { ActionTransitionItem } from "@/components/hotfix-execution/HotfixActionPanels";

export const dynamic = "force-dynamic";

export default async function IssueDetailPage({ params }: { params: { id: string } }) {
  const currentUser = await requireCurrentUser();
  const issue = await prisma.issue.findUnique({
    where: { id: params.id },
    include: {
      fieldValues: true,
      evidences: { orderBy: { createdAt: "desc" } },
      comments: { orderBy: { createdAt: "asc" } },
      aiSuggestions: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!issue) notFound();

  const auditLogs = await prisma.auditLog.findMany({
    where: { entityType: "Issue", entityId: issue.id },
    orderBy: { createdAt: "desc" },
    include: { actor: true },
  });

  const onVersionedWorkflow = isIssueOnVersionedWorkflow(issue);

  // ---------------------------------------------------------------------------
  // M2-B：新流程 Issue 一律走 workflowExecutionService（Server Component 讀取 ViewModel，
  // 見 Plan 第九節）；舊流程 Issue 完全維持原本 workflow.ts／gateRules.ts 行為，兩者互斥，
  // 不混用同一套資料。
  // ---------------------------------------------------------------------------

  let runtime: Awaited<ReturnType<typeof getIssueWorkflowRuntime>> | null = null;
  let historyItems: Array<{
    id: string;
    transitionType: string;
    actionKey: string | null;
    fromStageLabel: string | null;
    toStageLabel: string;
    transitionLabel: string | null;
    actorName: string;
    reasonCode: string | null;
    terminalOutcome: string | null;
    assignedTeamNameBefore: string | null;
    assignedTeamNameAfter: string | null;
    executedAt: string;
  }> = [];
  let canAssignTeam = false;
  let teamOptions: Array<{ id: string; name: string }> = [];
  let assignedTeamName: string | null = null;
  let startableVersions: Array<{ id: string; versionNo: number; definitionName: string }> = [];
  let canStartWorkflow = false;
  let hotfixView: Awaited<ReturnType<typeof buildHotfixRuntimeView>> | null = null;
  let approvalInfo: { approvalRecordId: string; requestedByName: string; requestedAt: string } | null = null;
  let riskCheckTargetStageKey: string | null = null;
  let riskCheckItems: Awaited<ReturnType<typeof getRiskCheckItemsForStage>> = [];
  let primaryForwardActionLabel: string | null = null;
  let forwardActions: ActionTransitionItem[] = [];
  let returnActions: ActionTransitionItem[] = [];
  let cancelActions: ActionTransitionItem[] = [];

  if (onVersionedWorkflow) {
    runtime = await getIssueWorkflowRuntime(issue.id, currentUser.id);
    const historyRows = await getIssueWorkflowHistory(issue.id, currentUser.id);
    const actorIds = Array.from(new Set(historyRows.map((h) => h.actorUserId)));
    const actors = actorIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
    const actorNameById = new Map(actors.map((a) => [a.id, a.name]));
    historyItems = historyRows.map((h) => ({
      id: h.id,
      transitionType: h.transitionType,
      actionKey: h.transition?.actionKey ?? null,
      fromStageLabel: h.fromStage?.label ?? null,
      toStageLabel: h.toStage.label,
      transitionLabel: h.transition?.label ?? null,
      actorName: actorNameById.get(h.actorUserId) ?? "（未知使用者）",
      reasonCode: h.reasonCode,
      terminalOutcome: h.terminalOutcome,
      assignedTeamNameBefore: h.assignedTeamBefore?.name ?? null,
      assignedTeamNameAfter: h.assignedTeamAfter?.name ?? null,
      executedAt: h.executedAt.toISOString(),
    }));
    canAssignTeam = await hasExecutionCapability(currentUser.id, "issue.assignTeam");
    if (runtime.onVersionedWorkflow && runtime.currentStage.stageType === "TRIAGE") {
      teamOptions = await prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    }
    if (issue.assignedTeamId) {
      const assignedTeam = await prisma.team.findUnique({ where: { id: issue.assignedTeamId }, select: { name: true } });
      assignedTeamName = assignedTeam?.name ?? null;
    }

    if (runtime.onVersionedWorkflow) {
      const pendingApprovalDecision =
        runtime.pendingApproval && runtime.pendingApproval.decision === "PENDING" ? "PENDING" : (runtime.pendingApproval?.decision as "APPROVED" | "REJECTED" | undefined) ?? null;

      hotfixView = await buildHotfixRuntimeView({
        issueId: issue.id,
        actorId: currentUser.id,
        currentStage: {
          stageKey: runtime.currentStage.stageKey,
          label: runtime.currentStage.label,
          stageType: runtime.currentStage.stageType,
          requiredMembershipRole: runtime.currentStage.requiredMembershipRole,
        },
        assignedTeamId: issue.assignedTeamId,
        assignedTeamName,
        availableTransitions: runtime.availableTransitions,
        stageRequirements: runtime.stageRequirements,
        pendingApprovalDecision,
        pendingApprovalExpectedApproverUserId: runtime.pendingApproval?.expectedApproverUserId ?? null,
      });

      if (runtime.pendingApproval && runtime.pendingApproval.decision === "PENDING") {
        const requester = await prisma.user.findUnique({ where: { id: runtime.pendingApproval.requestedByUserId }, select: { name: true } });
        approvalInfo = {
          approvalRecordId: runtime.pendingApproval.id,
          requestedByName: requester?.name ?? "（未知使用者）",
          requestedAt: runtime.pendingApproval.requestedAt.toISOString(),
        };
      }

      const primaryForward = runtime.availableTransitions.find((t) => t.transition.transitionType === "FORWARD");
      if (primaryForward) {
        riskCheckTargetStageKey = primaryForward.transition.toStage.stageKey;
        riskCheckItems = await getRiskCheckItemsForStage(issue.id, riskCheckTargetStageKey);
        primaryForwardActionLabel = transitionCopyOf(primaryForward.transition.actionKey, primaryForward.transition.label).label;
      }

      const toActionItem = (t: AvailableTransitionPreview): ActionTransitionItem => ({
        id: t.transition.id,
        actionKey: t.transition.actionKey,
        label: t.transition.label,
        requireReason: t.transition.requireReason,
        targetLabel: t.transition.toStage.label,
        targetIsCompleted: t.transition.toStage.isEnd && t.transition.toStage.terminalOutcome === "COMPLETED",
        allowed: t.allowed,
        blockedReasons: t.blockedReasons.map((r) => r.message),
      });
      forwardActions = runtime.availableTransitions.filter((t) => t.transition.transitionType === "FORWARD").map(toActionItem);
      returnActions = runtime.availableTransitions.filter((t) => t.transition.transitionType === "RETURN").map(toActionItem);
      cancelActions = runtime.availableTransitions.filter((t) => t.transition.transitionType === "CANCEL").map(toActionItem);
    }
  } else {
    canStartWorkflow = await hasExecutionCapability(currentUser.id, "admin.full");
    if (canStartWorkflow) {
      const selectable = await listSelectablePublishedVersionsForIssueType(issue.issueType);
      startableVersions = selectable.map((v) => ({ id: v.id, versionNo: v.versionNo, definitionName: v.workflowDefinition.name }));
    }
  }

  const fieldsMap: Record<string, string> = {};
  for (const f of issue.fieldValues) fieldsMap[f.fieldKey] = f.fieldValue;
  fieldsMap["__impactProduction"] = issue.impactProduction ? "true" : "false";

  const template = getVisibleFieldTemplate(issue.issueType, issue.workflowStatus);
  const workflow = getWorkflow(issue.issueType);
  const next = nextStatusOf(issue.issueType, issue.workflowStatus);
  const prev = prevStatusOf(issue.issueType, issue.workflowStatus);

  // 動態欄位若設定 dynamicOptionsRole（例如 RD 自測人下拉選單），依角色從已啟用使用者中查詢選項
  const dynamicOptions: Record<string, DynamicOption[]> = {};
  const rolesNeeded = Array.from(new Set(template.map((f) => f.dynamicOptionsRole).filter((r): r is string => !!r)));
  for (const role of rolesNeeded) {
    const roleUsers = await prisma.user.findMany({
      where: { isActive: true, role },
      orderBy: { name: "asc" },
      select: { name: true },
    });
    for (const f of template) {
      if (f.dynamicOptionsRole === role) {
        dynamicOptions[f.key] = roleUsers.map((u) => ({ value: u.name, label: u.name }));
      }
    }
  }

  const gate = evaluateGateRules({
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    currentStatus: issue.workflowStatus,
    targetStatus: next ?? issue.workflowStatus,
    fields: fieldsMap,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    evidenceCount: issue.evidences.length,
    hasClosingComment: issue.comments.length > 0,
  });

  const pulse = issue.statusLight === "Red" && issue.alertLevel === "Critical" && !issue.firstResponseAt;

  return (
    <div className="space-y-6">
      {/* 6.1 Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="font-mono">{issue.issueKey}</span>
              <span>·</span>
              <span>{issueTypeLabel(issue.issueType)}</span>
            </div>
            <h1 className="mt-1 text-xl font-bold text-gray-900">{issue.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge light={issue.statusLight} pulse={pulse} />
            <Link
              href={`/issues/${issue.id}/edit`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              編輯
            </Link>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-gray-400">目前流程狀態</div>
            <div className="font-medium text-gray-800">{statusLabel(issue.issueType, issue.workflowStatus)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">負責人</div>
            <div className="font-medium text-gray-800">{issue.ownerName || "—"}（{issue.ownerRole || "—"}）</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">到期日</div>
            <div className="font-medium text-gray-800">{issue.dueDate ? new Date(issue.dueDate).toLocaleDateString("zh-TW") : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">等待角色</div>
            <div className="font-medium text-gray-800">{issue.waitingRole || "—"}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* 6.2 基本欄位區 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">基本欄位</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-gray-400">系統名稱</dt>
                <dd className="font-medium text-gray-800">{issue.systemName || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">環境</dt>
                <dd className="font-medium text-gray-800">{issue.environment || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">風險等級</dt>
                <dd className="font-medium text-gray-800">{issue.riskLevel || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">優先級</dt>
                <dd className="font-medium text-gray-800">{issue.priority || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">建立人</dt>
                <dd className="font-medium text-gray-800">{issue.reporter || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">是否需 RCA</dt>
                <dd className="font-medium text-gray-800">{issue.needRca ? "是" : "否"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">是否需風險例外</dt>
                <dd className="font-medium text-gray-800">{issue.needRiskException ? "是" : "否"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">是否影響正式環境</dt>
                <dd className="font-medium text-gray-800">{issue.impactProduction ? "是" : "否"}</dd>
              </div>
            </dl>
            <div className="mt-3">
              <dt className="text-xs text-gray-400">問題描述</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{issue.description || "（尚未填寫問題描述）"}</dd>
            </div>
          </section>

          {onVersionedWorkflow && runtime && runtime.onVersionedWorkflow && hotfixView ? (
            <>
              {/* 需求一／二：目前工作狀態摘要＋7 階段流程進度 */}
              <section className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">目前工作狀態</h2>
                <HotfixStatusHeader
                  view={hotfixView}
                  isTerminal={runtime.currentStage.isEnd}
                  terminalLabel={runtime.currentStage.isEnd ? (runtime.currentStage.terminalOutcome === "COMPLETED" ? "已完成" : "已取消") : null}
                />
                {canAssignTeam && runtime.currentStage.stageType === "TRIAGE" && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <CurrentStagePanel
                      issueId={issue.id}
                      stageKey={runtime.currentStage.stageKey}
                      stageLabel={runtime.currentStage.label}
                      stageType={runtime.currentStage.stageType}
                      requiredExecutionRole={runtime.currentStage.requiredExecutionRole}
                      requiredMembershipRole={runtime.currentStage.requiredMembershipRole}
                      assignedTeamId={issue.assignedTeamId}
                      assignedTeamName={assignedTeamName}
                      canAssignTeam={canAssignTeam}
                      teamOptions={teamOptions}
                    />
                  </div>
                )}
              </section>

              {/* 需求四：目前待完成事項（取代舊「關卡卡控檢查」） */}
              <section className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">目前待完成事項</h2>
                <HotfixTodoList items={hotfixView.todoItems} nextActionLabel={primaryForwardActionLabel} />
              </section>

              {/* 需求六：本階段工作內容（OP 上版階段顯示為「上版與回復資訊」） */}
              <section id="field-section" className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">
                  {hotfixView.businessStageLabel === "OP 上版" ? "上版與回復資訊" : "本階段工作內容"}
                </h2>
                <StageRequirementsPanel issueId={issue.id} requirements={runtime.stageRequirements} />
              </section>

              {/* 需求五：主管核准（僅目前責任角色可操作，其餘唯讀） */}
              {approvalInfo && (
                <HotfixApprovalPanel
                  issueId={issue.id}
                  roleLabel={hotfixView.responsibleRoleLabel}
                  approval={approvalInfo}
                  isResponsible={hotfixView.isCurrentActorResponsible}
                />
              )}

              {/* 需求四／六：風險／例外——送核前必須完成的風險確認 */}
              {riskCheckTargetStageKey && (
                <section className="rounded-lg border border-gray-200 bg-white p-5">
                  <h2 className="mb-3 text-sm font-semibold text-gray-700">風險／例外</h2>
                  <HotfixRiskCheckPanel
                    issueId={issue.id}
                    stageKey={riskCheckTargetStageKey}
                    items={riskCheckItems}
                    disabled={!hotfixView.isCurrentActorResponsible}
                  />
                </section>
              )}

              {/* 需求三：前進／退回／取消動作，一律使用工作語意文案 */}
              <section className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">下一步操作</h2>
                <HotfixActionPanels
                  issueId={issue.id}
                  forward={forwardActions}
                  ret={returnActions}
                  cancel={cancelActions}
                  isResponsible={hotfixView.isCurrentActorResponsible}
                />
              </section>

              {/* 需求七：處理紀錄時間軸 */}
              <section className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">處理紀錄</h2>
                <HotfixHistoryTimeline items={historyItems} />
              </section>
            </>
          ) : (
            <>
              {/* 6.3 流程進度條（舊版線性流程） */}
              <section className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">流程進度</h2>
                <WorkflowProgress issueType={issue.issueType} currentStatus={issue.workflowStatus} />
                <div className="mt-4">
                  <WorkflowActions
                    issueId={issue.id}
                    nextStatus={next}
                    nextStatusLabel={next ? statusLabel(issue.issueType, next) : null}
                    prevStatus={prev}
                    gatePassed={gate.passed}
                    canSendBackToRd={
                      issue.issueType === "Hotfix" && ["qaVerify", "qaRelease"].includes(issue.workflowStatus)
                    }
                  />
                </div>
                {canStartWorkflow && startableVersions.length > 0 && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <p className="mb-2 text-xs text-gray-500">此工單類型已有可選用的新版 Workflow 執行引擎版本：</p>
                    <StartWorkflowPanel issueId={issue.id} options={startableVersions} />
                  </div>
                )}
              </section>

              {/* 6.5 關卡卡控檢查區 */}
              <section>
                <GateCheckPanel gate={gate} nextStatusLabel={next ? statusLabel(issue.issueType, next) : null} />
              </section>

              {/* 6.4 動態欄位區：直接在本頁填寫目前關卡的動態欄位，不需跳轉 */}
              <section id="dynamic-fields-section" className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">
                  {issueTypeLabel(issue.issueType)} 專屬欄位（{statusLabel(issue.issueType, issue.workflowStatus)}）
                </h2>
                <DynamicFieldsEditForm
                  issueId={issue.id}
                  template={template}
                  values={fieldsMap}
                  dynamicOptions={dynamicOptions}
                />
              </section>
            </>
          )}

          {/* 6.6 佐證資料區 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">佐證資料</h2>
            <EvidenceList
              issueId={issue.id}
              evidences={issue.evidences.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
            />
          </section>

          {/* 6.7 留言區 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">留言</h2>
            <CommentList
              issueId={issue.id}
              comments={issue.comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
            />
          </section>

          {/* 6.8 異動紀錄區 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">異動紀錄</h2>
            <AuditLogList
              logs={auditLogs.map((l) => ({
                id: l.id,
                actionType: l.actionType,
                summary: l.summary,
                actorName: l.actor?.name ?? "系統",
                actorRole: l.actor?.role ?? "",
                createdAt: l.createdAt.toISOString(),
              }))}
            />
          </section>
        </div>

        {/* 6.9 AI 輔助區 */}
        <div className="space-y-6">
          <section className="rounded-lg border border-indigo-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-indigo-700">AI 輔助</h2>
            <AiAssistantPanel
              issueId={issue.id}
              suggestions={issue.aiSuggestions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
