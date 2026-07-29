// 全站日期／時間顯示格式化（Server Component 與 Client Component 共用）。
//
// 為什麼需要這個檔案：`Date.prototype.toLocaleString()` 會依「執行環境當下的時區」輸出。
// Server Component 在容器內以 UTC 算出「2026/7/29 下午1:38:34」，瀏覽器 hydrate 時以
// Asia/Taipei（+08）算出「2026/7/29 下午9:38:34」，同一個時間戳產生兩份不同的 HTML，
// React 就會丟出 Hydration Error。
//
// 正確解法是讓兩邊算出「同一個字串」，而不是把警告蓋掉：
//   - 一律指定 locale（zh-TW）與 timeZone（Asia/Taipei），不使用執行環境預設值。
//   - 一律使用固定的 numeric 欄位組合，不依賴 locale 的預設樣式差異。
// 因此**禁止**在畫面上直接呼叫 toLocaleString／toLocaleDateString／toLocaleTimeString，
// 也**禁止**用 suppressHydrationWarning 或 useEffect 延後渲染來掩蓋問題——那些做法只是
// 讓錯誤不再顯示，使用者仍然會在首次渲染看到錯誤的時間。

// 業務上這個系統的使用者一律在台灣，時間語意固定以台北時間呈現。
export const DISPLAY_TIME_ZONE = "Asia/Taipei";
export const DISPLAY_LOCALE = "zh-TW";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const DATE_FORMATTER = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 日期＋時間（例：2026/07/29 21:38:34）。伺服器與瀏覽器輸出保證一致。 */
export function formatDateTime(value: DateInput, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return DATE_TIME_FORMATTER.format(date).replace(/⁦|⁩/g, "");
}

/** 只有日期（例：2026/07/29）。伺服器與瀏覽器輸出保證一致。 */
export function formatDate(value: DateInput, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return DATE_FORMATTER.format(date).replace(/⁦|⁩/g, "");
}
