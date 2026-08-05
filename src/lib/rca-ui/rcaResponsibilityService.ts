// RCA 流程：「這位 actor 現在該做什麼」解析層，比照
// src/lib/incident-ui/incidentResponsibilityService.ts 既有慣例，是 RCA 詳情頁與待辦／Bell
// 通知唯一允許判斷「業務子狀態」與「該顯示哪個操作按鈕」的地方。

import { prisma } from "../prisma";
import type { IssueActionKind } from "../workflow-execution/responsibilityService";
import { RCA_OWNER_FIELD_KEY, readRcaField } from "../workflow-execution/rcaAssignmentService";

export type { IssueActionKind };

export interface RcaActorTaskSummary {
  stageKey: string;
  businessStatusLabel: string;
  waitingRoleLabel: string;
  responsibleTeamName: string | null;
  ownerName: string | null;
  action: IssueActionKind;
  isMineToClaim: boolean;
  isMineToApprove: boolean;
}

const BASE_STATUS_LABEL: Record<string, string> = {
  rcaCreated: "RCA 已建立，待負責單位主管承接",
  pendingRcaTeamClaim: "待負責單位主管承接",
  pendingRcaOwnerAssignment: "待負責單位主管指派 RCA 主責人",
  rcaAnalysisInProgress: "RCA 主責人根因分析與改善計畫填寫中",
  pendingTechnicalReview: "待負責單位主管技術審查",
  pendingSecurityIntegrityReview: "待資安推動小組完整性審查",
  pendingManagementConfirmation: "條件式管理階層確認中",
  improvementInProgress: "改善措施執行中",
  pendingImprovementEvidence: "待改善佐證提交",
  pendingVerificationConfirmation: "待專業驗證與資安確認",
  pendingRcaClosureConfirmation: "待 RCA 結案確認",
  rcaClosed: "此 RCA 已結案",
};

export async function evaluateCurrentRcaActorTask(issueId: string, actorId: string): Promise<RcaActorTaskSummary | null> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || !issue.currentWorkflowStageId) return null;
  const stage = await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId } });
  if (!stage) return null;

  const responsibleTeam = issue.assignedTeamId ? await prisma.team.findUnique({ where: { id: issue.assignedTeamId } }) : null;
  const businessStatusLabel = BASE_STATUS_LABEL[stage.stageKey] ?? stage.stageKey;

  let action: IssueActionKind = "VIEW_ONLY";
  let waitingRoleLabel = "—";
  let isMineToClaim = false;
  let isMineToApprove = false;
  let ownerName: string | null = null;

  const canEdit = await prisma.userRole.count({ where: { userId: actorId, isActive: true } }).then((n) => n > 0);

  const ownerUserId = await readRcaField(prisma, issue.id, RCA_OWNER_FIELD_KEY);
  if (ownerUserId) {
    const ownerUser = await prisma.user.findUnique({ where: { id: ownerUserId } });
    ownerName = ownerUser?.name ?? null;
  }

  if (["pendingRcaTeamClaim", "pendingRcaOwnerAssignment"].includes(stage.stageKey)) {
    waitingRoleLabel = responsibleTeam ? `${responsibleTeam.name} 團隊主管` : "負責單位主管";
    if (issue.assignedTeamId && canEdit) {
      const membership = await prisma.teamMember.findFirst({ where: { teamId: issue.assignedTeamId, userId: actorId, isActive: true, membershipRole: "LEAD" } });
      if (membership) {
        action = stage.stageKey === "pendingRcaTeamClaim" ? "CLAIM" : "ENTER_WORK";
        if (stage.stageKey === "pendingRcaTeamClaim") isMineToClaim = true;
      }
    }
  } else if (["rcaAnalysisInProgress", "improvementInProgress", "pendingImprovementEvidence"].includes(stage.stageKey)) {
    waitingRoleLabel = ownerName ?? "（待指派 RCA 主責人）";
    if (ownerUserId === actorId) action = "ENTER_WORK";
  } else if (stage.stageKey === "pendingTechnicalReview") {
    waitingRoleLabel = responsibleTeam ? `${responsibleTeam.name} 團隊主管` : "負責單位主管";
    if (issue.assignedTeamId && canEdit) {
      const membership = await prisma.teamMember.findFirst({ where: { teamId: issue.assignedTeamId, userId: actorId, isActive: true, membershipRole: "LEAD" } });
      if (membership) {
        action = "APPROVE";
        isMineToApprove = true;
      }
    }
  } else if (["pendingSecurityIntegrityReview", "pendingVerificationConfirmation"].includes(stage.stageKey)) {
    waitingRoleLabel = "資安推動小組";
    if (canEdit) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: actorId, isActive: true, membershipRole: "LEAD", team: { domain: "SECURITY", isActive: true } },
      });
      if (membership) {
        action = "APPROVE";
        isMineToApprove = true;
      }
    }
  } else if (stage.stageKey === "pendingManagementConfirmation") {
    const vpPending = await prisma.approvalRecord.findFirst({ where: { issueId: issue.id, approvalType: "RCA_VP_CONFIRMATION", relatedStageKey: "pendingManagementConfirmation", decision: "PENDING", recordStatus: "ACTIVE" } });
    const directorPending = await prisma.approvalRecord.findFirst({ where: { issueId: issue.id, approvalType: "RCA_DIRECTOR_APPROVAL", relatedStageKey: "pendingManagementConfirmation", decision: "PENDING", recordStatus: "ACTIVE" } });
    const pending = directorPending ?? vpPending;
    waitingRoleLabel = pending ? (pending.approvalType === "RCA_DIRECTOR_APPROVAL" ? "DMS 部長" : "DMS 副部長") : "—";
    if (pending && canEdit) {
      const domain = pending.approvalType === "RCA_DIRECTOR_APPROVAL" ? "MANAGEMENT_DIRECTOR" : "MANAGEMENT_VP";
      const membership = await prisma.teamMember.findFirst({ where: { userId: actorId, isActive: true, membershipRole: "LEAD", team: { domain, isActive: true } } });
      if (membership) {
        action = "APPROVE";
        isMineToApprove = true;
      }
    }
  } else if (stage.stageKey === "pendingRcaClosureConfirmation") {
    waitingRoleLabel = responsibleTeam ? `${responsibleTeam.name} 團隊主管` : "負責單位主管";
    if (issue.assignedTeamId && canEdit) {
      const membership = await prisma.teamMember.findFirst({ where: { teamId: issue.assignedTeamId, userId: actorId, isActive: true, membershipRole: "LEAD" } });
      if (membership) {
        action = "APPROVE";
        isMineToApprove = true;
      }
    }
  } else if (stage.stageKey === "rcaClosed") {
    waitingRoleLabel = "—（已結案）";
  }

  return {
    stageKey: stage.stageKey,
    businessStatusLabel,
    waitingRoleLabel,
    responsibleTeamName: responsibleTeam?.name ?? null,
    ownerName,
    action,
    isMineToClaim,
    isMineToApprove,
  };
}
