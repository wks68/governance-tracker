// Hotfix 九階段 UI：Hotfix 緊急程度（Highest／High／Low／Lowest），與既有 Issue.priority
// （P1-P4 自由文字，非 Hotfix 專用語意，其餘工單類型仍在用）完全分開，避免互相污染既有欄位
// 語意。本輪不得新增 Schema，改以 IssueFieldValue（fieldKey="hotfixPriority"）儲存。

export const HOTFIX_PRIORITY_FIELD_KEY = "hotfixPriority";

export type HotfixPriorityValue = "HIGHEST" | "HIGH" | "LOW" | "LOWEST";

export interface HotfixPriorityDef {
  value: HotfixPriorityValue;
  label: string;
  colorClass: string;
  dotClass: string;
  badgeClass: string;
  arrow: "up-double" | "up" | "down" | "down-double";
  description: string;
}

export const HOTFIX_PRIORITIES: readonly HotfixPriorityDef[] = [
  {
    value: "HIGHEST",
    label: "最高",
    colorClass: "text-danger",
    dotClass: "bg-gov-red",
    badgeClass: "border-danger-border bg-danger-bg text-danger-text",
    arrow: "up-double",
    description: "正式環境重大中斷、資安或資料風險、大範圍使用者受影響，且無可行替代方案，需立即啟動處理。建議 30 分鐘內確認承接。",
  },
  {
    value: "HIGH",
    label: "高",
    colorClass: "text-warning-text",
    dotClass: "bg-orange-500",
    badgeClass: "border-orange-200 bg-orange-50 text-orange-700",
    arrow: "up",
    description: "關鍵功能無法使用、重要流程受阻或影響多人，雖有暫時替代方式，仍需優先修正。建議 2 小時內確認承接。",
  },
  {
    value: "LOW",
    label: "低",
    colorClass: "text-primary",
    dotClass: "bg-primary",
    badgeClass: "border-blue-200 bg-blue-50 text-blue-700",
    arrow: "down",
    description: "影響範圍有限且有替代方式，不需立即部署，可安排近期 Hotfix。建議 1 個工作日內確認安排。",
  },
  {
    value: "LOWEST",
    label: "最低",
    colorClass: "text-gray-500",
    dotClass: "bg-gray-400",
    badgeClass: "border-gray-200 bg-gray-50 text-gray-600",
    arrow: "down-double",
    description: "輕微問題、介面或便利性調整，未造成業務中斷，原則上應評估改走季度上版。",
  },
];

export function hotfixPriorityDefOf(value: string | null | undefined): HotfixPriorityDef | null {
  return HOTFIX_PRIORITIES.find((p) => p.value === value) ?? null;
}

export const HOTFIX_URGENCY_GOVERNANCE =
  "緊急程度依系統影響、資安與資料風險、影響範圍及替代方案判定，不得僅因提出者為主管、高階主管或 VIP 而提高。時間為確認承接建議，不代表完成時限。";

export function resolveHotfixPriority(value: string | null | undefined, legacyPriority?: string | null): HotfixPriorityDef {
  const explicit = hotfixPriorityDefOf(value);
  if (explicit) return explicit;
  const legacyMap: Record<string, HotfixPriorityValue> = {
    P1: "HIGHEST",
    P2: "HIGH",
    P3: "LOW",
    P4: "LOWEST",
  };
  return hotfixPriorityDefOf(legacyMap[legacyPriority ?? ""] ?? "HIGH")!;
}
