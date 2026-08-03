export const RICH_TEXT_FORMAT = "dms-rich-text";
export const RICH_TEXT_VERSION = 1;

export const RICH_TEXT_COLORS = ["#1F2937", "#475569", "#B91C1C", "#C2410C", "#8A6116", "#15803D", "#1D4ED8", "#6D28D9"] as const;
export const RICH_TEXT_FONT_SIZES = ["12px", "14px", "16px", "18px", "24px"] as const;
export const RICH_TEXT_FONTS = [
  "inherit",
  '"Microsoft JhengHei", sans-serif',
  '"Noto Sans TC", sans-serif',
  "Arial, sans-serif",
  "sans-serif",
] as const;
export const RICH_TEXT_IMAGE_WIDTHS = [25, 50, 75, 100] as const;
export type RichTextImageWidth = (typeof RICH_TEXT_IMAGE_WIDTHS)[number];

export function normalizeRichTextImageWidth(value: unknown): RichTextImageWidth {
  return typeof value === "number" && (RICH_TEXT_IMAGE_WIDTHS as readonly number[]).includes(value)
    ? value as RichTextImageWidth
    : 100;
}

export interface RichTextMark { type: string; attrs?: Record<string, unknown> }
export interface RichTextNode { type: string; attrs?: Record<string, unknown>; marks?: RichTextMark[]; content?: RichTextNode[]; text?: string }
export interface RichTextEnvelope { format: typeof RICH_TEXT_FORMAT; version: typeof RICH_TEXT_VERSION; doc: RichTextNode }

const NODE_TYPES = new Set(["doc", "paragraph", "text", "hardBreak", "bulletList", "orderedList", "listItem", "blockquote", "image"]);
const SIMPLE_MARKS = new Set(["bold", "italic", "underline", "strike"]);
const INTERNAL_IMAGE = /^\/api\/hotfix-attachments\/[0-9a-f-]{36}$/;
const PENDING_ID = /^[0-9a-f-]{36}$/;

function sanitizeMark(mark: unknown): RichTextMark | null {
  if (!mark || typeof mark !== "object") return null;
  const raw = mark as Record<string, unknown>;
  if (typeof raw.type !== "string") return null;
  if (SIMPLE_MARKS.has(raw.type)) return { type: raw.type };
  if (raw.type !== "textStyle") return null;
  const attrs = raw.attrs && typeof raw.attrs === "object" ? raw.attrs as Record<string, unknown> : {};
  const clean: Record<string, string> = {};
  if (typeof attrs.color === "string" && (RICH_TEXT_COLORS as readonly string[]).includes(attrs.color)) clean.color = attrs.color;
  if (typeof attrs.fontSize === "string" && (RICH_TEXT_FONT_SIZES as readonly string[]).includes(attrs.fontSize)) clean.fontSize = attrs.fontSize;
  if (typeof attrs.fontFamily === "string" && (RICH_TEXT_FONTS as readonly string[]).includes(attrs.fontFamily)) clean.fontFamily = attrs.fontFamily;
  return Object.keys(clean).length ? { type: "textStyle", attrs: clean } : null;
}

function sanitizeNode(node: unknown, allowPending: boolean): RichTextNode | null {
  if (!node || typeof node !== "object") return null;
  const raw = node as Record<string, unknown>;
  if (typeof raw.type !== "string" || !NODE_TYPES.has(raw.type)) return null;
  if (raw.type === "text") {
    if (typeof raw.text !== "string") return null;
    const marks = Array.isArray(raw.marks) ? raw.marks.map(sanitizeMark).filter((m): m is RichTextMark => !!m) : [];
    return { type: "text", text: raw.text, ...(marks.length ? { marks } : {}) };
  }
  if (raw.type === "image") {
    const attrs = raw.attrs && typeof raw.attrs === "object" ? raw.attrs as Record<string, unknown> : {};
    const src = typeof attrs.src === "string" ? attrs.src : "";
    const pendingId = typeof attrs.pendingId === "string" ? attrs.pendingId : "";
    const widthPercent = normalizeRichTextImageWidth(attrs.widthPercent);
    if (INTERNAL_IMAGE.test(src)) return { type: "image", attrs: { src, alt: "使用者上傳的問題截圖", widthPercent } };
    if (allowPending && PENDING_ID.test(pendingId)) return { type: "image", attrs: { src: "", pendingId, alt: "使用者上傳的問題截圖", widthPercent } };
    return null;
  }
  const content = Array.isArray(raw.content)
    ? raw.content.map((child) => sanitizeNode(child, allowPending)).filter((child): child is RichTextNode => !!child)
    : [];
  return { type: raw.type, ...(content.length ? { content } : {}) };
}

function plainTextDoc(value: string): RichTextNode {
  const paragraphs = value.split(/\r?\n/).map((line) => ({
    type: "paragraph",
    ...(line ? { content: [{ type: "text", text: line }] } : {}),
  } satisfies RichTextNode));
  return { type: "doc", content: paragraphs.length ? paragraphs : [{ type: "paragraph" }] };
}

export function parseRichTextValue(value: string | null | undefined, options: { allowPending?: boolean } = {}): RichTextEnvelope {
  const source = value ?? "";
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    if (parsed.format === RICH_TEXT_FORMAT && parsed.version === RICH_TEXT_VERSION) {
      const doc = sanitizeNode(parsed.doc, options.allowPending === true);
      if (doc?.type === "doc") return { format: RICH_TEXT_FORMAT, version: RICH_TEXT_VERSION, doc };
    }
  } catch { /* Legacy values are deliberately plain text, never HTML. */ }
  return { format: RICH_TEXT_FORMAT, version: RICH_TEXT_VERSION, doc: plainTextDoc(source) };
}

export function serializeRichTextValue(doc: unknown, options: { allowPending?: boolean } = {}): string {
  assertValidImageWidths(doc);
  const clean = sanitizeNode(doc, options.allowPending === true);
  if (!clean || clean.type !== "doc") throw new Error("富文字內容格式無效");
  return JSON.stringify({ format: RICH_TEXT_FORMAT, version: RICH_TEXT_VERSION, doc: clean });
}

export function sanitizeRichTextValue(value: string, options: { allowPending?: boolean } = {}): string {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.format === RICH_TEXT_FORMAT && parsed.version === RICH_TEXT_VERSION) assertValidImageWidths(parsed.doc);
  } catch (error) {
    if (error instanceof Error && error.message === "圖片顯示尺寸無效") throw error;
  }
  return JSON.stringify(parseRichTextValue(value, options));
}

function assertValidImageWidths(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const raw = node as Record<string, unknown>;
  if (raw.type === "image" && raw.attrs && typeof raw.attrs === "object") {
    const width = (raw.attrs as Record<string, unknown>).widthPercent;
    if (width !== undefined && !(typeof width === "number" && (RICH_TEXT_IMAGE_WIDTHS as readonly number[]).includes(width))) {
      throw new Error("圖片顯示尺寸無效");
    }
  }
  if (Array.isArray(raw.content)) for (const child of raw.content) assertValidImageWidths(child);
}

export function isRichTextValue(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    return parsed?.format === RICH_TEXT_FORMAT && parsed?.version === RICH_TEXT_VERSION && parsed?.doc?.type === "doc";
  } catch { return false; }
}

function collectPlainText(node: RichTextNode, chunks: string[]) {
  if (node.type === "text" && node.text) chunks.push(node.text);
  else if (node.type === "image") chunks.push("[圖片]");
  for (const child of node.content ?? []) collectPlainText(child, chunks);
  if (["paragraph", "blockquote", "listItem"].includes(node.type)) chunks.push("\n");
}

export function getRichTextPlainText(value: string | null | undefined): string {
  const chunks: string[] = [];
  collectPlainText(parseRichTextValue(value).doc, chunks);
  return chunks.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function collectJsonText(value: unknown, chunks: string[]) {
  if (typeof value === "string") {
    const normalized = value.replace(INTERNAL_IMAGE, "[圖片]").trim();
    if (normalized) chunks.push(normalized);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonText(item, chunks);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.format === RICH_TEXT_FORMAT && record.version === RICH_TEXT_VERSION) {
    chunks.push(getRichTextPlainText(JSON.stringify(record)));
    return;
  }
  for (const child of Object.values(record)) collectJsonText(child, chunks);
}

// Audit/history rendering must never expose versioned JSON, raw HTML, attachment URLs, or
// [object Object]. This extractor is deliberately display-only and does not change audit data.
export function getHistoryPlainText(value: string | null | undefined): string {
  const source = value?.trim() ?? "";
  if (!source) return "";
  if (isRichTextValue(source)) return getRichTextPlainText(source);
  try {
    const parsed = JSON.parse(source) as unknown;
    const chunks: string[] = [];
    collectJsonText(parsed, chunks);
    const text = chunks.join("\n").trim();
    if (text) return text;
  } catch { /* Plain historical text continues below. */ }
  return source
    .replace(INTERNAL_IMAGE, "[圖片]")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasValidContent(node: RichTextNode): boolean {
  if (node.type === "text" && !!node.text?.trim()) return true;
  if (node.type === "image" && typeof node.attrs?.src === "string" && INTERNAL_IMAGE.test(node.attrs.src)) return true;
  return (node.content ?? []).some(hasValidContent);
}

export function hasMeaningfulRichTextContent(value: string | null | undefined): boolean {
  return hasValidContent(parseRichTextValue(value).doc);
}

export function pendingRichTextImageIds(value: string): string[] {
  const ids: string[] = [];
  const visit = (node: RichTextNode) => {
    if (node.type === "image" && typeof node.attrs?.pendingId === "string" && PENDING_ID.test(node.attrs.pendingId)) ids.push(node.attrs.pendingId);
    for (const child of node.content ?? []) visit(child);
  };
  visit(parseRichTextValue(value, { allowPending: true }).doc);
  return [...new Set(ids)];
}

export function replacePendingRichTextImages(value: string, urls: ReadonlyMap<string, string>): string {
  const envelope = parseRichTextValue(value, { allowPending: true });
  const replace = (node: RichTextNode): RichTextNode | null => {
    if (node.type === "image" && typeof node.attrs?.pendingId === "string") {
      const src = urls.get(node.attrs.pendingId);
      return src ? { type: "image", attrs: { src, alt: "使用者上傳的問題截圖", widthPercent: normalizeRichTextImageWidth(node.attrs.widthPercent) } } : null;
    }
    const content = node.content?.map(replace).filter((child): child is RichTextNode => !!child);
    return { ...node, ...(content ? { content } : {}) };
  };
  return serializeRichTextValue(replace(envelope.doc));
}
