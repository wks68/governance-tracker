"use client";

/* eslint-disable @next/next/no-img-element -- Attachment dimensions are user supplied; max-width containment and the authenticated internal route are required here. */

import { useState, type CSSProperties, type ReactNode } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { normalizeRichTextImageWidth, parseRichTextValue, type RichTextMark, type RichTextNode } from "@/lib/rich-text/value";

function markStyle(marks: RichTextMark[] | undefined): CSSProperties {
  const style: CSSProperties = {};
  const textStyle = marks?.find((mark) => mark.type === "textStyle")?.attrs;
  if (typeof textStyle?.color === "string") style.color = textStyle.color;
  if (typeof textStyle?.fontSize === "string") style.fontSize = textStyle.fontSize;
  if (typeof textStyle?.fontFamily === "string") style.fontFamily = textStyle.fontFamily;
  return style;
}

function TextWithMarks({ node }: { node: RichTextNode }) {
  let child: ReactNode = <span style={markStyle(node.marks)}>{node.text}</span>;
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") child = <strong>{child}</strong>;
    if (mark.type === "italic") child = <em>{child}</em>;
    if (mark.type === "underline") child = <u>{child}</u>;
    if (mark.type === "strike") child = <s>{child}</s>;
  }
  return child;
}

function RichTextImage({ node, onImage }: { node: RichTextNode; onImage: (src: string) => void }) {
  const src = String(node.attrs?.src ?? "");
  const widthPercent = normalizeRichTextImageWidth(node.attrs?.widthPercent);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const style: CSSProperties = { width: `${widthPercent}%`, minWidth: "min(160px, 100%)", maxWidth: "100%" };

  return (
    <div className="my-3 ml-auto mr-auto min-w-0" style={style} data-width-percent={widthPercent}>
      {failed ? (
        <div className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-text-secondary" role="status">
          <p className="font-medium">圖片附件目前無法預覽</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="ui-button-secondary min-h-9 px-3 py-1.5" onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}>
              <RefreshCw className="h-4 w-4" aria-hidden />重新載入
            </button>
            <a href={src} target="_blank" rel="noreferrer" className="ui-button-secondary min-h-9 px-3 py-1.5">
              <ExternalLink className="h-4 w-4" aria-hidden />開啟附件
            </a>
          </div>
        </div>
      ) : (
        <button type="button" className="block w-full cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onImage(src)} aria-label="放大預覽圖片">
          <img key={attempt} src={src} alt="使用者上傳的問題截圖" className="block h-auto w-full max-w-full rounded-lg border border-border object-contain" onError={() => setFailed(true)} />
        </button>
      )}
    </div>
  );
}

function NodeView({ node, onImage }: { node: RichTextNode; onImage: (src: string) => void }): ReactNode {
  const children = node.content?.map((child, index) => <NodeView key={index} node={child} onImage={onImage} />);
  if (node.type === "doc") return <>{children}</>;
  if (node.type === "paragraph") return <p>{children ?? <br />}</p>;
  if (node.type === "text") return <TextWithMarks node={node} />;
  if (node.type === "hardBreak") return <br />;
  if (node.type === "bulletList") return <ul>{children}</ul>;
  if (node.type === "orderedList") return <ol>{children}</ol>;
  if (node.type === "listItem") return <li>{children}</li>;
  if (node.type === "blockquote") return <blockquote>{children}</blockquote>;
  if (node.type === "image" && typeof node.attrs?.src === "string") {
    return <RichTextImage node={node} onImage={onImage} />;
  }
  return null;
}

export default function RichTextViewer({ value, empty = "—", className = "" }: { value: string | null | undefined; empty?: string; className?: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const doc = parseRichTextValue(value).doc;
  const hasContent = (doc.content?.length ?? 0) > 0 && !!(value ?? "").trim();
  return (
    <>
      <div className={`rich-text-viewer min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-sm leading-6 text-text-primary ${className}`}>
        {hasContent ? <NodeView node={doc} onImage={setPreview} /> : <span className="text-text-muted">{empty}</span>}
      </div>
      {preview && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="圖片預覽" onClick={() => setPreview(null)} onKeyDown={(event) => { if (event.key === "Escape") setPreview(null); }} tabIndex={-1}><button type="button" className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-800" aria-label="關閉圖片預覽" onClick={() => setPreview(null)}><X className="h-5 w-5" /></button><img src={preview} alt="使用者上傳的問題截圖（放大預覽）" className="max-h-full max-w-full rounded-lg object-contain" onClick={(event) => event.stopPropagation()} /></div>}
    </>
  );
}
