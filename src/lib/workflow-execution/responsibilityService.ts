// RD/QA/OP 接單流程新增：工單清單／九階段 UI 共用的「業務子狀態」與「目前這位 actor
// 該做什麼」解析層。
//
// 這是全站唯一允許把 stageKey + assignedTeamId + 指派執行人 + pendingApproval 組合判斷成
// 「使用者看得懂的中文子狀態」與「該顯示哪個操作按鈕」的地方，其餘頁面（工單清單／RD-QA-OP
// 執行頁）一律呼叫本檔案，不得自行重複判斷邏輯——比照 src/lib/hotfix-ui/nineStage.ts
// 既有慣例（該檔案負責 stageKey→9 大業務階段，本檔案負責同一個 stageKey 再往下一層的
// 子狀態與操作按鈕）。
//
// 本檔案只做唯讀查詢＋組裝，不做任何寫入、不構成授權邊界——實際授權一律由
// claimService／assignmentService／approvalService／transitionService 於實際執行動作時
// 現場重新解析。

import { prisma } from "../prisma";
import { getClaimDomainForStageKey, getExecutorDomainForStageKey, executorFieldKey } from "./hotfixDomainMap";
import { getEligibleApproverUserIdsInTx } from "../approvalService";
import { hasExecutionCapability } from "./access";

export type IssueActionKind =
  | "CLAIM"
  | "ASSIGN_MEMBER"
  | "ENTER_WORK"
  | "APPROVE"
  | "CONFIRM_CLOSE"
  | "VIEW_ONLY";

export interface ActorTaskSummary {
  stageKey: string;
  businessStatusLabel: string;
  waitingRoleLabel: string;
  assignedTeamName: string | null;
  executorName: string | null;
  action: IssueActionKind;
  isMineToClaim: boolean; // 待我處理（含待我接單）
  isMineToApprove: boolean; // 待我核准
  isClaimableStage: boolean; // 目前關卡是否為「待團隊接單」（TRIAGE 且尚未承接），與 actor 是否為合格 Lead 無關
  /** 核准關卡為 ApprovalRecord.id；用來辨識同一關卡重新送核產生的新責任。 */
  actionSourceId: string | null;
}

const APPROVAL_ROLE_LABEL: Record<string, string> = {
  BUSINESS_APPROVAL: "申請人直屬主管",
  RD_LEAD_APPROVAL: "RD 主管",
  QA_LEAD_APPROVAL: "QA 主管",
  DEPLOYMENT_APPROVAL: "OP 主管",
};

const BASE_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  pendingBusinessApproval: "待申請人主管核准",
  pendingRdTriage: "待 RD 團隊接單",
  rdInProgress: "RD 修正與自測中",
  pendingRdLeadApproval: "待 RD 主管核准",
  pendingQaTriage: "待 QA 團隊接單",
  qaInProgress: "QA 驗證中",
  pendingQaLeadApproval: "待 QA 主管核准",
  pendingOpTriage: "待 OP 團隊接單",
  opPreparing: "OP 上版準備中",
  pendingDeploymentApproval: "待 OP 主管核准",
  opDeploying: "OP 上版執行中",
  opCompleted: "OP 上版結果確認中",
  pendingReporterConfirmation: "待申請人確認結案",
  reporterConfirming: "待申請人確認結案",
  closed: "已結案",
  cancelled: "已取消",
};

// CLAIM stageType（pendingRdClaim／pendingQaClaim／pendingOpClaim）不在 BASE_STATUS_LABEL
// 靜態表中——文字需要內嵌實際承接團隊名稱，由 buildBusinessStatusLabel 動態組出。

async function isLatestStageEntryReturned(issueId: string, currentStageId: string): Promise<boolean> {
  const open = await prisma.issueWorkflowStageHistory.findFirst({
    where: { issueId, toStageId: currentStageId, exitedAt: null },
    orderBy: { executedAt: "desc" },
  });
  return open?.transitionType === "RETURNED";
}

function buildBusinessStatusLabel(stageKey: string, assignedTeamName: string | null, isReturned: boolean): string {
  let base: string;
  if (stageKey === "pendingRdClaim" || stageKey === "pendingQaClaim" || stageKey === "pendingOpClaim") {
    base = assignedTeamName ? `已由 ${assignedTeamName} 團隊承接，待指派` : "已承接，待指派";
  } else {
    base = BASE_STATUS_LABEL[stageKey] ?? stageKey;
  }
  return isReturned ? `${base}（已退回處理）` : base;
}

export async function evaluateCurrentActorTask(issueId: string, actorId: string): Promise<ActorTaskSummary | null> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || !issue.currentWorkflowStageId) return null;
  const stage = await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId } });
  if (!stage) return null;

  const [assignedTeam, isReturned] = await Promise.all([
    issue.assignedTeamId ? prisma.team.findUnique({ where: { id: issue.assignedTeamId } }) : Promise.resolve(null),
    isLatestStageEntryReturned(issueId, stage.id),
  ]);

  const claimDomain = getClaimDomainForStageKey(stage.stageKey);
  const executorDomain = getExecutorDomainForStageKey(stage.stageKey);

  let executorName: string | null = null;
  if (executorDomain) {
    const row = await prisma.issueFieldValue.findUnique({
      where: { issueId_fieldKey: { issueId, fieldKey: executorFieldKey(executorDomain) } },
    });
    if (row?.fieldValue) {
      const executorUser = await prisma.user.findUnique({ where: { id: row.fieldValue } });
      executorName = executorUser?.name ?? null;
    }
  }

  const businessStatusLabel = buildBusinessStatusLabel(stage.stageKey, assignedTeam?.name ?? null, isReturned);

  // ---- 決定 action + waitingRoleLabel + 是否為「待我」----
  let action: IssueActionKind = "VIEW_ONLY";
  let waitingRoleLabel = "—";
  let isMineToClaim = false;
  let isMineToApprove = false;
  let actionSourceId: string | null = null;

  const canEdit = await hasExecutionCapability(actorId, "issue.edit");

  if (claimDomain) {
    // TRIAGE：待接單
    waitingRoleLabel = `${claimDomain} 團隊主管`;
    if (canEdit) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: actorId, isActive: true, membershipRole: "LEAD", team: { domain: claimDomain } },
      });
      if (membership) {
        action = "CLAIM";
        isMineToClaim = true;
      }
    }
  } else if (stage.stageType === "CLAIM" && issue.assignedTeamId) {
    // 已接單待指派
    waitingRoleLabel = assignedTeam ? `${assignedTeam.name} 團隊 Lead` : "承接團隊 Lead";
    if (canEdit) {
      const leadMembership = await prisma.teamMember.findFirst({
        where: { teamId: issue.assignedTeamId, userId: actorId, isActive: true, membershipRole: "LEAD" },
      });
      if (leadMembership) {
        action = "ASSIGN_MEMBER";
        isMineToClaim = true;
      }
    }
  } else if (executorDomain) {
    // WORK／DEPLOYMENT／CONFIRMATION：執行人處理中
    waitingRoleLabel = assignedTeam ? `${assignedTeam.name}／${executorName ?? "（待指派）"}` : executorName ?? "（待指派）";
    if (canEdit && executorName) {
      const row = await prisma.issueFieldValue.findUnique({
        where: { issueId_fieldKey: { issueId, fieldKey: executorFieldKey(executorDomain) } },
      });
      if (row?.fieldValue === actorId) action = "ENTER_WORK";
    }
  } else if (stage.stageType === "APPROVAL" && stage.approvalType) {
    waitingRoleLabel = APPROVAL_ROLE_LABEL[stage.approvalType] ?? "主管";
    const pending = await prisma.approvalRecord.findFirst({
      where: { issueId, approvalType: stage.approvalType, relatedStageKey: stage.stageKey, recordStatus: "ACTIVE", decision: "PENDING" },
      orderBy: { revisionNo: "desc" },
    });
    if (pending) {
      const eligibleIds = await getEligibleApproverUserIdsInTx(prisma, {
        approvalType: pending.approvalType,
        requestedByUserId: pending.requestedByUserId,
        approverTeamId: pending.approverTeamId,
      });
      if (eligibleIds.includes(actorId)) {
        action = "APPROVE";
        isMineToApprove = true;
        actionSourceId = pending.id;
      }
    }
  } else if (stage.stageKey === "pendingReporterConfirmation" || stage.stageKey === "reporterConfirming") {
    waitingRoleLabel = "申請人";
    if (issue.reporterUserId === actorId) {
      action = "CONFIRM_CLOSE";
      isMineToClaim = true;
    }
  } else if (stage.stageKey === "closed") {
    waitingRoleLabel = "—（已結案）";
  } else if (stage.stageKey === "cancelled") {
    waitingRoleLabel = "—（已取消）";
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
    isClaimableStage: claimDomain !== null && !issue.assignedTeamId,
    actionSourceId,
  };
}
