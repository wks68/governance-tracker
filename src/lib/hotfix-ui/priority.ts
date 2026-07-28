// Hotfix 九階段 UI：Hotfix 工單優先級（Highest／High／Low／Lowest），與既有 Issue.priority
// （P1-P4 自由文字，非 Hotfix 專用語意，其餘工單類型仍在用）完全分開，避免互相污染既有欄位
// 語意。本輪不得新增 Schema，改以 IssueFieldValue（fieldKey="hotfixPriority"）儲存。

export const HOTFIX_PRIORITY_FIELD_KEY = "hotfixPriority";

export type HotfixPriorityValue = "HIGHEST" | "HIGH" | "LOW" | "LOWEST";

export interface HotfixPriorityDef {
  value: HotfixPriorityValue;
  label: string;
  colorClass: string;
  arrow: "up-double" | "up" | "down" | "down-double";
}

export const HOTFIX_PRIORITIES: readonly HotfixPriorityDef[] = [
  { value: "HIGHEST", label: "最高", colorClass: "text-danger", arrow: "up-double" },
  { value: "HIGH", label: "高", colorClass: "text-warning-text", arrow: "up" },
  { value: "LOW", label: "低", colorClass: "text-primary", arrow: "down" },
  { value: "LOWEST", label: "最低", colorClass: "text-gray-400", arrow: "down-double" },
];

export function hotfixPriorityDefOf(value: string | null | undefined): HotfixPriorityDef | null {
  return HOTFIX_PRIORITIES.find((p) => p.value === value) ?? null;
}
