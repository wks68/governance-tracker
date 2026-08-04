const HOTFIX_PREFIX = /^\s*(?:\[Hotfix\]\s*)+/i;

/** 正式儲存值不含 UI 顯示前綴。 */
export function normalizeHotfixTitleForStorage(value: string): string {
  return value.replace(HOTFIX_PREFIX, "").trim();
}

/** 清單前綴只由 UI 加一次，舊資料即使已含前綴也不會重複。 */
export function hotfixTitleForDisplay(value: string): string {
  const title = normalizeHotfixTitleForStorage(value);
  return `[Hotfix]${title ? ` ${title}` : ""}`;
}
