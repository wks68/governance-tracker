// Hotfix 九階段 UI：附件檔名顯示層修復——僅處理「UTF-8 位元組被誤當 Latin-1 逐字元解碼」
// 這種典型 mojibake（例如舊瀏覽器／中介層未正確標示 multipart 欄位編碼）。不改 DB、不改
// Evidence.title 實際儲存值，只在顯示（清單／下載檔名）當下嘗試修復；修復前後任一步驟不是
// 「乾淨且可逆」就直接放棄、回傳原始字串，避免誤改本來就正常的檔名。

const MOJIBAKE_HINT = /[\u00c2-\u00f4][\u0080-\u00bf]/;

export function repairDisplayFileName(name: string): string {
  if (!name || !MOJIBAKE_HINT.test(name)) return name;
  const codePoints = Array.from(name).map((ch) => ch.codePointAt(0) ?? 0);
  if (codePoints.some((code) => code > 0xff)) return name;

  try {
    const bytes = Uint8Array.from(codePoints);
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!repaired || repaired.includes("\uFFFD")) return name;

    // Round-trip safety: re-encoding the repaired text as UTF-8 and mapping each
    // byte back to one Latin-1 code point must reproduce the original string
    // exactly. Otherwise this was coincidental overlap, not real mojibake.
    const reEncoded = Array.from(new TextEncoder().encode(repaired), (b) => String.fromCharCode(b)).join("");
    return reEncoded === name ? repaired : name;
  } catch {
    return name;
  }
}

export function asciiFallbackFileName(name: string): string {
  const trimmed = (name || "").trim() || "attachment";
  const dot = trimmed.lastIndexOf(".");
  const hasExt = dot > 0 && dot < trimmed.length - 1;
  const base = hasExt ? trimmed.slice(0, dot) : trimmed;
  const ext = hasExt ? trimmed.slice(dot) : "";
  const asciiBase = base.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").trim();
  const asciiExt = ext.replace(/[^\x20-\x7e]/g, "");
  return `${asciiBase || "attachment"}${asciiExt}`;
}
