// 事件通報快速通報介面：唯一的選項與欄位值域設定來源（任務規格第五～九節）。
// UI（Stepper 元件）與 Server（incidentCreation.ts 驗證／保存）都必須 import 這裡的值，
// 不得在多個檔案各自重複硬編一份選項清單。

import { SYSTEM_NAME_OPTIONS } from "../constants";

export const REPORTER_UNSURE = "不確定" as const;
export const REPORTER_OTHER = "其他" as const;

// ---------------------------------------------------------------------------
// 5.1／5.2 系統／服務（沒有正式 System／Service master model 前的穩定替代來源）
// ---------------------------------------------------------------------------

export const REPORTER_SYSTEM_OPTIONS: readonly string[] = [...SYSTEM_NAME_OPTIONS, REPORTER_UNSURE, REPORTER_OTHER];

export const SYSTEM_SERVICE_MAP: Record<string, readonly string[]> = {
  MyDMS: ["登入／認證", "文件管理", "簽核流程", "報表", "通知信件"],
  "Jarvis AI": ["對話服務", "知識庫檢索", "模型推論", "API 介接"],
  Community: ["討論區", "會員系統", "通知中心"],
  "APP Center": ["應用程式上架", "版本發佈", "下載服務"],
};

// ---------------------------------------------------------------------------
// 5.3 事件類型（不含 Hotfix——那是後續處理方式，不是通報人需要理解的事件類型）
// ---------------------------------------------------------------------------

export const INCIDENT_TYPE_OPTIONS = [
  "系統／功能異常",
  "服務中斷",
  "登入或權限問題",
  "資料異常",
  "信件／通知異常",
  "效能緩慢",
  "部署／上線問題",
  "資安疑慮",
  "稽核發現",
  REPORTER_OTHER,
] as const;
export type ReporterIncidentType = (typeof INCIDENT_TYPE_OPTIONS)[number];

// ---------------------------------------------------------------------------
// 5.4 發生時間快速選項
// ---------------------------------------------------------------------------

export const OCCURRED_TIME_QUICK_OPTIONS = ["現在", "今天稍早", "昨天", REPORTER_UNSURE] as const;
export type OccurredTimeQuickOption = (typeof OCCURRED_TIME_QUICK_OPTIONS)[number];

// ---------------------------------------------------------------------------
// 5.6 常見症狀複選
// ---------------------------------------------------------------------------

export const SYMPTOM_OPTIONS = [
  "無法開啟",
  "無法登入",
  "畫面錯誤",
  "操作無反應",
  "執行速度很慢",
  "資料顯示錯誤",
  "資料未更新",
  "通知／信件異常",
  "權限不正確",
  REPORTER_OTHER,
] as const;

// ---------------------------------------------------------------------------
// 6.1／6.2 是否仍持續／是否有替代方式
// ---------------------------------------------------------------------------

export const ONGOING_OPTIONS = ["是，現在仍持續", "否，目前已恢復", REPORTER_UNSURE] as const;
export const WORKAROUND_OPTIONS = ["有", "沒有", REPORTER_UNSURE] as const;

// ---------------------------------------------------------------------------
// 6.3 影響範圍（正式值域）
// ---------------------------------------------------------------------------

export const IMPACT_SCOPE_OPTIONS = [
  { value: "SINGLE_USER", label: "只有我" },
  { value: "FEW_USERS", label: "少數使用者" },
  { value: "SINGLE_UNIT", label: "一個單位" },
  { value: "MULTIPLE_UNITS", label: "多個單位" },
  { value: "MANY_USERS", label: "大量使用者" },
  { value: "UNKNOWN", label: REPORTER_UNSURE },
] as const;
export type ImpactScopeValue = (typeof IMPACT_SCOPE_OPTIONS)[number]["value"];
export const IMPACT_SCOPE_VALUES: readonly string[] = IMPACT_SCOPE_OPTIONS.map((o) => o.value);
// 選擇這兩個範圍時才需要條件式顯示受影響使用者／單位多選欄。
export const IMPACT_SCOPE_REQUIRES_TARGET_PICKER = new Set(["SINGLE_UNIT", "MULTIPLE_UNITS"]);

// ---------------------------------------------------------------------------
// 6.5 資料與權限影響（複選＋互斥規則）
// ---------------------------------------------------------------------------

export const DATA_PERMISSION_IMPACT_NONE = "沒有發現上述情況" as const;
export const DATA_PERMISSION_IMPACT_UNSURE = REPORTER_UNSURE;

export const DATA_PERMISSION_IMPACT_OPTIONS = [
  "資料顯示錯誤",
  "資料未更新／不同步",
  "資料遺失",
  "看見不該看見的資料",
  "無法看見應有的資料",
  "權限異常",
  "涉及個人資料",
  "涉及機敏資料",
  DATA_PERMISSION_IMPACT_NONE,
  DATA_PERMISSION_IMPACT_UNSURE,
] as const;

// ---------------------------------------------------------------------------
// 6.6 初步營運影響（複選＋互斥規則＋「其他」條件欄）
// ---------------------------------------------------------------------------

export const OPERATIONAL_IMPACT_NONE = "目前沒有明顯影響" as const;
export const OPERATIONAL_IMPACT_UNSURE = REPORTER_UNSURE;

export const OPERATIONAL_IMPACT_OPTIONS = [
  "無法執行主要工作",
  "部分功能無法使用",
  "作業速度變慢",
  "需要人工替代處理",
  "可能影響交付時程",
  "可能影響外部使用者／客戶",
  OPERATIONAL_IMPACT_NONE,
  OPERATIONAL_IMPACT_UNSURE,
  REPORTER_OTHER,
] as const;

// ---------------------------------------------------------------------------
// 6.7 初步影響感受（只存 suggestedImpactLevel，絕不直接寫入 Issue.riskLevel）
// ---------------------------------------------------------------------------

export const IMPACT_FEELING_OPTIONS = [
  "影響很大，需要立即處理",
  "有影響，但仍可部分作業",
  "影響較小",
  "不確定，請承接窗口判斷",
] as const;

// ---------------------------------------------------------------------------
// 7.2 聯絡方式
// ---------------------------------------------------------------------------

export const CONTACT_METHOD_OPTIONS = ["Teams", "Email", "電話", REPORTER_OTHER] as const;

// ---------------------------------------------------------------------------
// 互斥規則驗證（UI 與 Server 都呼叫同一份邏輯，不各自重寫一次）
// ---------------------------------------------------------------------------

export function validateDataPermissionImpactSelection(selected: readonly string[]): string | null {
  if (selected.length === 0) return null;
  if (selected.includes(DATA_PERMISSION_IMPACT_NONE) && selected.length > 1) {
    return `「${DATA_PERMISSION_IMPACT_NONE}」不能與其他項目同時選取`;
  }
  if (selected.includes(DATA_PERMISSION_IMPACT_UNSURE) && selected.length > 1) {
    return `「${DATA_PERMISSION_IMPACT_UNSURE}」不能與其他具體項目同時選取`;
  }
  return null;
}

export function validateOperationalImpactSelection(selected: readonly string[]): string | null {
  if (selected.length === 0) return null;
  if (selected.includes(OPERATIONAL_IMPACT_NONE) && selected.length > 1) {
    return `「${OPERATIONAL_IMPACT_NONE}」不能與具體影響同時選取`;
  }
  if (selected.includes(OPERATIONAL_IMPACT_UNSURE) && selected.length > 1) {
    return `「${OPERATIONAL_IMPACT_UNSURE}」不能與具體影響同時選取`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 建議事件名稱（第一步即時預覽用；正式送出時 Server 端 incidentCreation.ts 會重算一次
// 而非信任 Client 傳來的字串，避免被竄改）
// ---------------------------------------------------------------------------

export function buildSuggestedIncidentTitle(input: { systemName: string; incidentType: string; symptomText: string }): string {
  const systemPart = input.systemName && input.systemName !== REPORTER_UNSURE ? `[${input.systemName}] ` : "";
  const symptom = input.symptomText.trim().slice(0, 30) || input.incidentType || "事件通報";
  return `${systemPart}${symptom}`.trim().slice(0, 60);
}

// ---------------------------------------------------------------------------
// 系統自動整理摘要（第十節）：只讀結構化欄位組字串，不覆蓋通報人原始描述。
// ---------------------------------------------------------------------------

export interface AutoSummaryInput {
  systemName: string;
  incidentType: string;
  symptomText: string;
  isOngoing: string;
  impactScopeLabel: string;
  dataPermissionImpact: readonly string[];
  hasWorkaround: string;
}

export function buildAutoIncidentSummary(input: AutoSummaryInput): string {
  const lines = [
    `系統：${input.systemName || "未提供"}`,
    `事件類型：${input.incidentType || "未提供"}`,
    `事件現象：${input.symptomText || "未提供"}`,
    `目前狀態：${input.isOngoing || "未提供"}`,
    `影響範圍：${input.impactScopeLabel || "未提供"}`,
    `資料／權限影響：${input.dataPermissionImpact.length > 0 ? input.dataPermissionImpact.join("、") : "未提供"}`,
    `替代方式：${input.hasWorkaround || "未提供"}`,
  ];
  return lines.join("\n");
}
