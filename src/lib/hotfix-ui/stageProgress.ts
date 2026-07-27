// Hotfix 操作畫面收斂新增：WorkflowStage → 使用者看得懂的 7 個業務階段分組。
//
// 目的：Issue 明細頁的流程進度必須呈現 PM／RD／QA／OP 熟悉的業務語意（Hotfix已開單／
// RD修正／RD自測／QA驗證／QA放行確認／OP上版／正式環境確認），不是 20 個技術關卡或
// StageType（TRIAGE／APPROVAL／WORK…）。統計與判斷來源仍是真實的 WorkflowStage／
// Issue.currentWorkflowStageId（不從 workflowStatus 推導），本檔案只是「顯示分組」這一層。
//
// 對照表以 scripts/lib/buildHotfixWorkflowV1.ts 目前唯一在用的 Hotfix v1 stageKey 為準；
// 主管核准／QA 放行等 gate 關卡（pendingRdLeadApproval／pendingQaLeadApproval／
// pendingDeploymentApproval）刻意「併入」它們所屬的業務階段，不額外多開一個進度節點——
// 核准狀態改以 badge 呈現（見 approvalBadgeOf），對應「主管核准等 gate 以 badge／狀態
// 呈現，不額外破壞 7 階段主流程」的要求。
//
// 未來若有其他 WorkflowDefinition 使用不同 stageKey，一律 fallback 為「其他關卡（顯示
// 該關卡自己的 label）」，不會誤判、不會顯示技術值。

export const HOTFIX_BUSINESS_STAGES = [
  "Hotfix 已開單",
  "RD 修正",
  "RD 自測",
  "QA 驗證",
  "QA 放行確認",
  "OP 上版",
  "正式環境確認",
] as const;
export type HotfixBusinessStage = (typeof HOTFIX_BUSINESS_STAGES)[number];

const STAGE_KEY_TO_BUSINESS_STAGE: Record<string, HotfixBusinessStage> = {
  draft: "Hotfix 已開單",
  pendingBusinessApproval: "Hotfix 已開單",
  pendingRdTriage: "Hotfix 已開單",
  pendingRdClaim: "RD 修正",
  rdInProgress: "RD 修正",
  pendingRdLeadApproval: "RD 自測",
  pendingQaTriage: "QA 驗證",
  pendingQaClaim: "QA 驗證",
  qaInProgress: "QA 驗證",
  pendingQaLeadApproval: "QA 放行確認",
  pendingOpTriage: "OP 上版",
  pendingOpClaim: "OP 上版",
  opPreparing: "OP 上版",
  pendingDeploymentApproval: "OP 上版",
  opDeploying: "OP 上版",
  opCompleted: "OP 上版",
  pendingReporterConfirmation: "正式環境確認",
  reporterConfirming: "正式環境確認",
};

// 停留在這些關卡時，卡片上額外顯示的核准／放行 badge（不影響上面的業務階段對應）。
const APPROVAL_BADGE_BY_STAGE_KEY: Record<string, string> = {
  pendingRdLeadApproval: "待 RD 主管核准",
  pendingQaLeadApproval: "待 QA 放行",
  pendingDeploymentApproval: "待部署核准",
};

// 這個 stageKey 目前的責任角色家族——用來決定「現在輪到誰」與六、角色操作分離要顯示
// 哪一組欄位／動作。與 WorkflowStage.requiredMembershipRole（MEMBER／LEAD）交叉判斷，
// 才能分出「RD 執行人」與「RD 主管」兩種不同畫面。
export type HotfixRoleFamily = "REPORTER" | "BUSINESS" | "RD" | "QA" | "OP" | "NONE";

const STAGE_KEY_TO_ROLE_FAMILY: Record<string, HotfixRoleFamily> = {
  draft: "REPORTER",
  pendingBusinessApproval: "BUSINESS",
  pendingRdTriage: "RD",
  pendingRdClaim: "RD",
  rdInProgress: "RD",
  pendingRdLeadApproval: "RD",
  pendingQaTriage: "QA",
  pendingQaClaim: "QA",
  qaInProgress: "QA",
  pendingQaLeadApproval: "QA",
  pendingOpTriage: "OP",
  pendingOpClaim: "OP",
  opPreparing: "OP",
  pendingDeploymentApproval: "OP",
  opDeploying: "OP",
  opCompleted: "OP",
  pendingReporterConfirmation: "REPORTER",
  reporterConfirming: "REPORTER",
  closed: "NONE",
  cancelled: "NONE",
};

export function businessStageOf(stageKey: string, fallbackLabel: string): HotfixBusinessStage | string {
  return STAGE_KEY_TO_BUSINESS_STAGE[stageKey] ?? fallbackLabel;
}

export function businessStageIndexOf(stageKey: string): number | null {
  const stage = STAGE_KEY_TO_BUSINESS_STAGE[stageKey];
  if (!stage) return null;
  return HOTFIX_BUSINESS_STAGES.indexOf(stage);
}

export function approvalBadgeOf(stageKey: string): string | null {
  return APPROVAL_BADGE_BY_STAGE_KEY[stageKey] ?? null;
}

export function roleFamilyOf(stageKey: string): HotfixRoleFamily {
  return STAGE_KEY_TO_ROLE_FAMILY[stageKey] ?? "NONE";
}

const ROLE_FAMILY_LABEL: Record<HotfixRoleFamily, { executor: string; lead: string }> = {
  REPORTER: { executor: "開單人", lead: "開單人" },
  BUSINESS: { executor: "業務核准人", lead: "業務核准人" },
  RD: { executor: "RD 執行人", lead: "RD 主管" },
  QA: { executor: "QA 執行人", lead: "QA 主管（放行人）" },
  OP: { executor: "OP 執行人", lead: "OP 主管" },
  NONE: { executor: "—", lead: "—" },
};

// requiredMembershipRole==="LEAD" 才是主管視角，其餘（含 null，例如 TRIAGE／CONFIRMATION
// 這類不要求特定團隊身分的關卡）一律視為執行人視角。
export function roleLabelOf(stageKey: string, requiredMembershipRole: string | null): string {
  const family = roleFamilyOf(stageKey);
  const meta = ROLE_FAMILY_LABEL[family];
  return requiredMembershipRole === "LEAD" ? meta.lead : meta.executor;
}
