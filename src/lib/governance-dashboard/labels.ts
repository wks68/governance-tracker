// 治理儀表板 UI 收斂新增：集中管理面向使用者的中文治理語意文字，避免 RETURN／
// UNKNOWN／CANCELLED 等技術值直接出現在畫面上（英文技術值僅保留於明細內部欄位或
// 開發註解，不作為主要標題）。所有元件一律從這裡取用文字，確保用詞一致。

import type { GovernanceIssueRow, GovernanceLifecycleStatus, GovernanceRiskStatus } from "./types";

export const RISK_STATUS_LABEL: Record<GovernanceRiskStatus, string> = {
  YES: "已確認有風險",
  UNKNOWN: "風險狀況待釐清",
  UNANSWERED: "尚未填寫風險確認",
  NONE: "—",
};

export const RISK_STATUS_TONE: Record<GovernanceRiskStatus, string> = {
  YES: "text-gov-red",
  UNKNOWN: "text-gov-yellow",
  UNANSWERED: "text-gov-blue",
  NONE: "text-gray-400",
};

export const LIFECYCLE_STATUS_LABEL: Record<GovernanceLifecycleStatus, string> = {
  LEGACY: "舊制案件",
  NOT_STARTED: "尚未啟動",
  IN_PROGRESS: "進行中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export function returnBadgeLabel(row: Pick<GovernanceIssueRow, "returnCount">): string | null {
  if (row.returnCount >= 2) return "重複退回";
  if (row.returnCount >= 1) return "退回重作";
  return null;
}
