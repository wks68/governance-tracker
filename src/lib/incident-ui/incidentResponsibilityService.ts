// Incident 事件通報流程：「這位 actor 現在該做什麼」解析層，比照
// src/lib/workflow-execution/responsibilityService.ts（evaluateCurrentActorTask）既有慣例，
// 是 Incident 詳情頁與待辦／Bell 通知唯一允許判斷「業務子狀態」與「該顯示哪個操作按鈕」的
// 地方，不重複判斷邏輯。與 Hotfix 版本分開維護（不共用 stageKey 值域，也不修改
// responsibilityService.ts 本體），符合「不修改 Hotfix 功能」的範圍限制。

import { prisma } from "../prisma";
import type { IssueActionKind } from "../workflow-execution/responsibilityService";
import { INCIDENT_TECHNICAL_TEAM_FIELD_KEY, INCIDENT_EXECUTOR_FIELD_KEY, readIncidentField } from "../workflow-execution/incidentAssignmentService";

export type { IssueActionKind };

export interface IncidentActorTaskSummary {
  stageKey: string;
  businessStatusLabel: string;
  waitingRoleLabel: string;
  assignedTeamName: string | null;
  executorName: string | null;
  action: IssueActionKind;
  isMineToClaim: boolean;
  isMineToApprove: boolean;
  isClaimableStage: boolean;
  actionSourceId: string | null;
}

const BASE_STATUS_LABEL: Record<string, string> = {
  reported: "已通報，待受理",
  pendingIntake: "待受理窗口承接",
  pendingClassification: "受理窗口影響確認與分級中",
  pendingUnitAssignment: "待受理窗口指派處理單位",
  pendingTechLeadClaim: "待技術主管接單與指派",
  inHandling: "技術處理人員初步處置中",
  pendingRecoveryConfirmation: "待受理窗口確認恢復結果",
  pendingRcaDecision: "待資安推動小組完成 RCA 啟動判定",
  pendingClosureConfirmation: "待受理窗口確認事件結案",
  closed: "已結案",
};

export async function evaluateCurrentIncidentActorTask(issueId: string, actorId: string): Promise<IncidentActorTaskSummary | null> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || !issue.currentWorkflowStageId) return null;
  const stage = await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId } });
  if (!stage) return null;

  const assignedTeam = issue.assignedTeamId ? await prisma.team.findUnique({ where: { id: issue.assignedTeamId } }) : null;
  const businessStatusLabel = BASE_STATUS_LABEL[stage.stageKey] ?? stage.stageKey;

  let action: IssueActionKind = "VIEW_ONLY";
  let waitingRoleLabel = "—";
  let isMineToClaim = false;
  let isMineToApprove = false;
  let executorName: string | null = null;
  const actionSourceId: string | null = null;

  const canEdit = await prisma.userRole.count({ where: { userId: actorId, isActive: true } }).then((n) => n > 0);

  if (stage.stageKey === "pendingIntake") {
    waitingRoleLabel = "事件受理窗口";
    if (!issue.assignedTeamId && canEdit) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: actorId, isActive: true, membershipRole: "LEAD", team: { domain: "INCIDENT", isActive: true } },
      });
      if (membership) {
        action = "CLAIM";
        isMineToClaim = true;
      }
    }
  } else if (["pendingClassification", "pendingUnitAssignment", "pendingRecoveryConfirmation", "pendingClosureConfirmation"].includes(stage.stageKey)) {
    waitingRoleLabel = "事件受理窗口";
    if (issue.assignedTeamId && canEdit) {
      const membership = await prisma.teamMember.findFirst({ where: { teamId: issue.assignedTeamId, userId: actorId, isActive: true, membershipRole: "LEAD" } });
      if (membership) {
        action = stage.stageKey === "pendingClosureConfirmation" ? "APPROVE" : "ENTER_WORK";
        if (stage.stageKey === "pendingClosureConfirmation") isMineToApprove = true;
      }
    }
  } else if (stage.stageKey === "pendingTechLeadClaim") {
    const technicalTeamId = await readIncidentField(prisma, issueId, INCIDENT_TECHNICAL_TEAM_FIELD_KEY);
    const technicalTeam = technicalTeamId ? await prisma.team.findUnique({ where: { id: technicalTeamId } }) : null;
    waitingRoleLabel = technicalTeam ? `${technicalTeam.name} 團隊主管` : "處理技術單位主管";
    if (technicalTeamId && canEdit) {
      const membership = await prisma.teamMember.findFirst({ where: { teamId: technicalTeamId, userId: actorId, isActive: true, membershipRole: "LEAD" } });
      if (membership) {
        action = "CLAIM";
        isMineToClaim = true;
      }
    }
  } else if (stage.stageKey === "inHandling") {
    const executorUserId = await readIncidentField(prisma, issueId, INCIDENT_EXECUTOR_FIELD_KEY);
    if (executorUserId) {
      const executorUser = await prisma.user.findUnique({ where: { id: executorUserId } });
      executorName = executorUser?.name ?? null;
    }
    waitingRoleLabel = executorName ?? "（待指派）";
    if (executorUserId === actorId) action = "ENTER_WORK";
  } else if (stage.stageKey === "pendingRcaDecision") {
    waitingRoleLabel = "資安推動小組";
    if (canEdit) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: actorId, isActive: true, membershipRole: "LEAD", team: { domain: "SECURITY", isActive: true } },
      });
      if (membership) action = "ENTER_WORK";
    }
  } else if (stage.stageKey === "closed") {
    waitingRoleLabel = "—（已結案）";
  }

  return {
    stageKey: stage.stageKey,
    businessStatusLabel,
    waitingRoleLabel,
    assignedTeamName: assignedTeam?.name ?? null,
    executorName,
    action,
    isMineToClaim,
    isMineToApprove,
    isClaimableStage: stage.stageKey === "pendingIntake" && !issue.assignedTeamId,
    actionSourceId,
  };
}
