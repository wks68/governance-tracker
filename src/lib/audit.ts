import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

export type ActionType =
  | "IssueCreated"
  | "StatusChange"
  | "FieldChange"
  | "CommentAdded"
  | "EvidenceAdded"
  | "AiSuggestion"
  | "RoleChange"
  | "AccountStatusChange"
  | "TeamReassigned" // M1 新增：供 M3 起團隊指派/轉派事件使用
  // ---- M1.5-A 新增：核准治理層事件 ----
  | "ApprovalRequested"
  | "ApprovalApproved"
  | "ApprovalRejected"
  | "ApprovalCancelled"
  | "ApprovalInvalidated"
  | "ApprovalDelegated"
  | "ApprovalReassigned"
  | "RiskCheckUpdated"
  | "UnknownRiskAssigned"
  | "UnknownRiskResolved"
  // ---- M1.5-B 新增：核准治理設定事件 ----
  | "SupervisorAssignmentCreated"
  | "SupervisorAssignmentEnded"
  | "SupervisorAssignmentCancelled"
  | "TeamLeadAssigned"
  | "TeamLeadRemoved"
  | "ApprovalDelegationCreated"
  | "ApprovalDelegationRevoked"
  // ---- C1-B3／C1-B4 新增：People 領域生命週期事件 ----
  | "UserCreated"
  | "UserUpdated"
  | "UserActivated"
  | "UserDeactivated"
  | "UserRoleAssigned"
  | "UserRoleRemoved"
  | "TeamMemberAdded"
  | "TeamMemberRemoved"
  | "UserDeactivationImpactChecked"
  // ---- M2-A 新增：Workflow 定義／版本管理事件（執行引擎事件如 IssueWorkflowStarted／
  // IssueWorkflowAdvanced／IssueWorkflowReturned／IssueWorkflowCancelled／
  // IssueWorkflowStageCompleted 屬 M2-B 範圍，本輪不新增） ----
  | "WorkflowDefinitionCreated"
  | "WorkflowDefinitionUpdated"
  | "WorkflowDefinitionActivated"
  | "WorkflowDefinitionDeactivated"
  | "WorkflowVersionCreated"
  | "WorkflowVersionCloned"
  | "WorkflowStageCreated"
  | "WorkflowStageUpdated"
  | "WorkflowStageRemoved"
  | "WorkflowTransitionCreated"
  | "WorkflowTransitionUpdated"
  | "WorkflowTransitionRemoved"
  | "WorkflowRequirementCreated"
  | "WorkflowRequirementUpdated"
  | "WorkflowRequirementRemoved"
  | "WorkflowVersionValidated"
  | "WorkflowVersionPublished"
  | "WorkflowVersionArchived"
  // ---- M2-B 新增：Issue Workflow 執行引擎事件（EntityType 沿用既有 "Issue"，不新增） ----
  | "IssueWorkflowStarted"
  | "IssueWorkflowAdvanced"
  | "IssueWorkflowReturned"
  | "IssueWorkflowCancelled"
  | "IssueWorkflowStageCompleted"
  // ---- Hotfix 團隊/申請人整合修正新增：團隊 CRUD 與工單刪除事件 ----
  | "TeamCreated"
  | "TeamUpdated"
  | "TeamDeleted"
  | "IssueDeleted"
  | "IssueAdminPermanentDeleted"
  | "IssueApplicantTeamReassigned"
  // ---- RD/QA/OP 接單流程新增 ----
  | "TeamDomainChanged"
  | "IssueClaimedByTeam"
  | "IssueExecutorAssigned"
  | "IssueExecutorReassigned"
  // ---- 成員管理權限收斂新增：完全未被任何資料引用的成員帳號永久刪除 ----
  | "UserPermanentlyDeleted"
  | "TeamActivated"
  | "TeamDeactivated"
  // ---- 治理紀錄類型化關聯 ----
  | "IssueRelationCreated"
  | "IssueRelationRemoved";

// M1.5-A 新增：ApprovalRecord；M1.5-B 新增：UserSupervisorAssignment／TeamMember／ApprovalDelegation；
// C1-B3 新增：UserRole；M2-A 新增：WorkflowDefinition／WorkflowVersion／WorkflowStage／
// WorkflowTransition／WorkflowStageRequirement
export type EntityType =
  | "Issue"
  | "User"
  | "ApprovalRecord"
  | "UserSupervisorAssignment"
  | "TeamMember"
  | "ApprovalDelegation"
  | "UserRole"
  | "WorkflowDefinition"
  | "WorkflowVersion"
  | "WorkflowStage"
  | "WorkflowTransition"
  | "WorkflowStageRequirement"
  | "Team"
  | "IssueRelation";

export async function writeAuditLog(
  params: {
    entityType: EntityType;
    entityId: string;
    actionType: ActionType;
    summary: string;
    actorUserId: string;
    // M1 新增（皆為可選，預設不帶入時行為與既有呼叫端完全相同）：供「原值→新值＋原因代碼」類事件（如 M3 起的 TeamReassigned）結構化保存
    fromValue?: string;
    toValue?: string;
    reasonCode?: string;
  },
  // M1.5-B 新增：可選的 transaction client，預設用全域 prisma（向下相容既有呼叫端）。
  // 治理設定的資料變更與 AuditLog 必須在同一 transaction 內完成時，呼叫端傳入 tx。
  client: PrismaClient | Prisma.TransactionClient = prisma,
) {
  return client.auditLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      actionType: params.actionType,
      summary: params.summary,
      actorUserId: params.actorUserId,
      fromValue: params.fromValue,
      toValue: params.toValue,
      reasonCode: params.reasonCode,
    },
  });
}
