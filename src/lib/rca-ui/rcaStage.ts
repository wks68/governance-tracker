// RCA 根因分析與改善結案流程：唯一允許做「stageKey → 業務階段」判斷的地方，比照
// src/lib/incident-ui/incidentStage.ts／src/lib/hotfix-ui/nineStage.ts 既有慣例。

export interface RcaStageDef {
  index: number; // 1-12
  key: string;
  label: string;
}

export const RCA_STAGES: readonly RcaStageDef[] = [
  { index: 1, key: "CREATED", label: "建立 RCA" },
  { index: 2, key: "TEAM_CLAIM", label: "RCA 負責單位主管承接" },
  { index: 3, key: "OWNER_ASSIGNMENT", label: "指派 RCA 主責人" },
  { index: 4, key: "ANALYSIS", label: "根因分析與改善計畫" },
  { index: 5, key: "TECHNICAL_REVIEW", label: "負責單位主管技術審查" },
  { index: 6, key: "SECURITY_INTEGRITY_REVIEW", label: "資安推動小組完整性審查" },
  { index: 7, key: "MANAGEMENT_CONFIRMATION", label: "條件式管理階層確認" },
  { index: 8, key: "IMPROVEMENT_EXECUTION", label: "改善措施執行" },
  { index: 9, key: "IMPROVEMENT_EVIDENCE", label: "改善佐證提交" },
  { index: 10, key: "VERIFICATION", label: "專業驗證與資安確認" },
  { index: 11, key: "RCA_CLOSURE", label: "RCA 結案" },
  { index: 12, key: "INCIDENT_CLOSURE", label: "關聯事件結案" },
];

const STAGE_KEY_TO_INDEX: Record<string, number> = {
  rcaCreated: 1,
  pendingRcaTeamClaim: 2,
  pendingRcaOwnerAssignment: 3,
  rcaAnalysisInProgress: 4,
  pendingTechnicalReview: 5,
  pendingSecurityIntegrityReview: 6,
  pendingManagementConfirmation: 7,
  improvementInProgress: 8,
  pendingImprovementEvidence: 9,
  pendingVerificationConfirmation: 10,
  pendingRcaClosureConfirmation: 11,
  rcaClosed: 11, // 結案動作本身完成即代表第 11 階段完成；第 12 階段（關聯事件結案）
  // 是「RCA 結案之後、由 Incident 端才能觸發」的後續動作，不是 RCA 自己 Workflow 的最後一個
  // granular stageKey——RCA 的 workflowStatus 到 rcaClosed 即終止，但業務進度軸仍保留第 12
  // 格顯示「等待關聯事件結案」，由 UI 層依「來源 Incident 是否已結案」動態決定是否點亮。
};

export function rcaStageIndexOfStageKey(stageKey: string): number | null {
  return STAGE_KEY_TO_INDEX[stageKey] ?? null;
}

export function rcaStageLabelOfIndex(index: number): string {
  return RCA_STAGES.find((s) => s.index === index)?.label ?? `第 ${index} 階段`;
}

export function isKnownRcaStageKey(stageKey: string): boolean {
  return stageKey in STAGE_KEY_TO_INDEX;
}

export function rcaRoute(issueId: string): string {
  return `/issues/${issueId}/rca`;
}

const STAGE_KEY_TO_SUBTITLE: Record<string, string> = {
  rcaCreated: "RCA 已由事件通報建立，等待負責單位主管承接。",
  pendingRcaTeamClaim: "等待負責單位主管承接。",
  pendingRcaOwnerAssignment: "等待負責單位主管指派 RCA 主責人。",
  rcaAnalysisInProgress: "RCA 主責人根因分析與改善計畫填寫中。",
  pendingTechnicalReview: "等待負責單位主管技術審查。",
  pendingSecurityIntegrityReview: "等待資安推動小組完整性審查。",
  pendingManagementConfirmation: "條件式管理階層確認中（視事件等級與影響範圍決定是否送審）。",
  improvementInProgress: "矯正／預防措施執行中。",
  pendingImprovementEvidence: "等待提交改善佐證。",
  pendingVerificationConfirmation: "等待專業驗證與資安推動小組確認。",
  pendingRcaClosureConfirmation: "等待權責主管／系統負責人確認 RCA 結案。",
  rcaClosed: "此 RCA 已結案。",
};

export function rcaStageSubtitle(stageKey: string): string | null {
  return STAGE_KEY_TO_SUBTITLE[stageKey] ?? null;
}
