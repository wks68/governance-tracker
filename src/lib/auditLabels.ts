// M1.5-C1-C 新增：AuditLog.actionType → 顯示文字的單一共用對照表。
//
// 供 AuditLogList（工單歷程）與人員明細歷程共用，不得各自複製一份 label mapping。
export const ACTION_TYPE_LABELS: Record<string, string> = {
  IssueCreated: "建立工單",
  StatusChange: "狀態流轉",
  FieldChange: "欄位異動",
  CommentAdded: "新增留言",
  EvidenceAdded: "新增佐證",
  AiSuggestion: "AI 建議產生",
  RoleChange: "主要角色變更",
  AccountStatusChange: "帳號狀態變更（舊版，已淘汰）",
  TeamReassigned: "團隊改派",
  ApprovalRequested: "送出核准",
  ApprovalApproved: "核准通過",
  ApprovalRejected: "核准退回",
  ApprovalCancelled: "核准取消",
  ApprovalInvalidated: "核准追溯失效",
  ApprovalDelegated: "核准代理",
  ApprovalReassigned: "核准改派",
  RiskCheckUpdated: "風險檢核更新",
  UnknownRiskAssigned: "標記未知風險",
  UnknownRiskResolved: "解決未知風險",
  SupervisorAssignmentCreated: "新增主管指派",
  SupervisorAssignmentEnded: "終止主管指派",
  SupervisorAssignmentCancelled: "取消主管指派排程",
  TeamLeadAssigned: "設定 Team LEAD",
  TeamLeadRemoved: "移除 Team LEAD",
  ApprovalDelegationCreated: "新增核准代理",
  ApprovalDelegationRevoked: "撤銷核准代理",
  UserCreated: "建立使用者",
  UserUpdated: "更新基本資料",
  UserActivated: "帳號啟用",
  UserDeactivated: "帳號停用",
  UserRoleAssigned: "指派角色",
  UserRoleRemoved: "移除角色",
  TeamMemberAdded: "加入 Team",
  TeamMemberRemoved: "移出 Team",
  UserDeactivationImpactChecked: "檢查停用影響",
};

export function actionTypeLabel(actionType: string): string {
  return ACTION_TYPE_LABELS[actionType] ?? actionType;
}
