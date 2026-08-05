// Incident 事件通報流程：唯一允許做「stageKey → 業務階段」判斷的地方，比照
// src/lib/hotfix-ui/nineStage.ts 既有慣例。個別頁面一律呼叫本檔案的函式，不得自行重複
// 判斷邏輯。
//
// 對應規則（10 個內部關卡 → 9 個正式業務階段，見 scripts/lib/buildIncidentWorkflowV1.ts）：
//   1 事件通報            reported
//   2 承接與補件          pendingIntake
//   3 影響確認與分級      pendingClassification
//   4 指派處理單位        pendingUnitAssignment
//   5 技術主管接單與指派   pendingTechLeadClaim
//   6 初步處置與服務恢復   inHandling
//   7 恢復結果確認        pendingRecoveryConfirmation
//   8 RCA 啟動判定        pendingRcaDecision
//   9 事件結案／RCA 追蹤   pendingClosureConfirmation / closed

export interface IncidentNineStageDef {
  index: number; // 1-9
  key: string;
  label: string;
}

export const INCIDENT_NINE_STAGES: readonly IncidentNineStageDef[] = [
  { index: 1, key: "REPORT", label: "事件通報" },
  { index: 2, key: "INTAKE", label: "承接與補件" },
  { index: 3, key: "CLASSIFICATION", label: "影響確認與分級" },
  { index: 4, key: "UNIT_ASSIGNMENT", label: "指派處理單位" },
  { index: 5, key: "TECH_LEAD_CLAIM", label: "技術主管接單與指派" },
  { index: 6, key: "HANDLING", label: "初步處置與服務恢復" },
  { index: 7, key: "RECOVERY_CONFIRMATION", label: "恢復結果確認" },
  { index: 8, key: "RCA_DECISION", label: "RCA 啟動判定" },
  { index: 9, key: "CLOSURE", label: "事件結案／RCA 追蹤" },
];

const STAGE_KEY_TO_NINE_STAGE_INDEX: Record<string, number> = {
  reported: 1,
  pendingIntake: 2,
  pendingClassification: 3,
  pendingUnitAssignment: 4,
  pendingTechLeadClaim: 5,
  inHandling: 6,
  pendingRecoveryConfirmation: 7,
  pendingRcaDecision: 8,
  pendingClosureConfirmation: 9,
  closed: 9,
};

export function incidentNineStageIndexOfStageKey(stageKey: string): number | null {
  return STAGE_KEY_TO_NINE_STAGE_INDEX[stageKey] ?? null;
}

export function incidentNineStageLabelOfIndex(index: number): string {
  return INCIDENT_NINE_STAGES.find((s) => s.index === index)?.label ?? `第 ${index} 階段`;
}

// ---------------------------------------------------------------------------
// 路由：本輪（Incident 基礎切片）只有單一動態詳情頁，依目前 stageKey 顯示對應的操作區塊，
// 不像 Hotfix 依角色拆成多個獨立路由——這是刻意的範圍收斂（見 PR 說明），保留未來視需要
// 再拆分的空間，但目前所有 Incident 頁面一律指向同一個路徑。
// ---------------------------------------------------------------------------

export function incidentRoute(issueId: string): string {
  return `/issues/${issueId}/incident`;
}

// 依目前 stageKey 判斷是否為本流程已知關卡；用於 Server redirect／404 判斷，不建立第二套
// stage 白名單。
export function isKnownIncidentStageKey(stageKey: string): boolean {
  return stageKey in STAGE_KEY_TO_NINE_STAGE_INDEX;
}

const STAGE_KEY_TO_SUBTITLE: Record<string, string> = {
  reported: "事件已建立，等待受理窗口承接。",
  pendingIntake: "等待事件受理窗口承接或退回補件。",
  pendingClassification: "受理窗口確認影響範圍與正式事件等級中。",
  pendingUnitAssignment: "等待受理窗口指派主要處理技術單位。",
  pendingTechLeadClaim: "等待技術單位主管接單並指派實際處理人員。",
  inHandling: "技術處理人員初步處置與服務恢復中。",
  pendingRecoveryConfirmation: "等待受理窗口確認恢復結果。",
  pendingRcaDecision: "等待資安推動小組完成 RCA 啟動判定。",
  pendingClosureConfirmation: "等待受理窗口確認事件結案。",
  closed: "此事件已結案。",
};

/** 回傳 null 表示此 stageKey 沒有對應說明，呼叫端可退回頁面自帶的副標題。 */
export function incidentStageSubtitle(stageKey: string): string | null {
  return STAGE_KEY_TO_SUBTITLE[stageKey] ?? null;
}
