// 治理儀表板 UI 收斂新增：關卡 → 使用者可理解的「流程階段」分組。
//
// 目的：首頁「流程卡點」不得只顯示 StageType／WorkflowStage key 等技術值（TRIAGE／
// APPROVAL／DEPLOYMENT…），必須以主管看得懂的中文階段呈現。統計來源仍是真實的
// WorkflowStage／Issue.currentWorkflowStageId（見 queries.ts），本檔案只是「顯示分組」
// 這一層，不改變任何統計來源。
//
// 對照表以 scripts/lib/buildHotfixWorkflowV1.ts 目前唯一在用的 Hotfix v1 stageKey 為準；
// 未來若有其他 WorkflowDefinition 使用不同 stageKey，一律 fallback 為該關卡自己的
// label（依然是人類看得懂的中文顯示名稱，不會退回顯示技術值），不會出現無法辨識或誤判。
const HOTFIX_V1_STAGE_KEY_TO_PHASE: Record<string, string> = {
  draft: "需求／案件確認",
  pendingBusinessApproval: "需求／案件確認",
  pendingRdTriage: "需求／案件確認",
  pendingRdClaim: "RD 修正",
  rdInProgress: "RD 修正",
  pendingRdLeadApproval: "RD 主管核准",
  pendingQaTriage: "QA 驗證",
  pendingQaClaim: "QA 驗證",
  qaInProgress: "QA 驗證",
  pendingQaLeadApproval: "QA 放行",
  pendingOpTriage: "OP 上版",
  pendingOpClaim: "OP 上版",
  opPreparing: "OP 上版",
  pendingDeploymentApproval: "OP 上版",
  opDeploying: "OP 上版",
  opCompleted: "OP 上版",
  pendingReporterConfirmation: "正式環境確認",
  reporterConfirming: "正式環境確認",
  closed: "已結案",
  cancelled: "已取消",
};

// 首頁「流程卡點」呈現順序：依業務流程先後排列，未出現在資料中的階段不顯示
// （不得為了排版硬湊出 0 件的空階段列）。
export const GOVERNANCE_PHASE_ORDER = [
  "需求／案件確認",
  "RD 修正",
  "RD 主管核准",
  "QA 驗證",
  "QA 放行",
  "OP 上版",
  "正式環境確認",
] as const;

export function derivePhaseLabel(stageKey: string, fallbackLabel: string): string {
  return HOTFIX_V1_STAGE_KEY_TO_PHASE[stageKey] ?? fallbackLabel;
}

export function stagePhaseOf(stage: { stageKey: string; label: string } | null): string | null {
  if (!stage) return null;
  return derivePhaseLabel(stage.stageKey, stage.label);
}
