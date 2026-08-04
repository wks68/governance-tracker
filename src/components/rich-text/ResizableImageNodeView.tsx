"use client";

/* eslint-disable @next/next/no-img-element -- authenticated user attachment URLs are rendered inside the editor */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { MoveHorizontal } from "lucide-react";
import { RICH_TEXT_IMAGE_WIDTHS, normalizeRichTextImageWidth } from "@/lib/rich-text/value";

function nearestWidth(value: number): (typeof RICH_TEXT_IMAGE_WIDTHS)[number] {
  return RICH_TEXT_IMAGE_WIDTHS.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest,
  );
}

export default function ResizableImageNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const width = normalizeRichTextImageWidth(node.attrs.widthPercent);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number; containerWidth: number } | null>(null);
  const displayedWidth = dragWidth ?? width;

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const wrapper = event.currentTarget.closest("[data-node-view-wrapper]") as HTMLElement | null;
    const container = wrapper?.closest(".ProseMirror") as HTMLElement | null;
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startWidth: width,
      containerWidth: Math.max(container.clientWidth, 1),
    };
    setDragWidth(width);
  }

  function resize(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaPercent = ((event.clientX - drag.startX) / drag.containerWidth) * 100;
    setDragWidth(Math.min(100, Math.max(25, drag.startWidth + deltaPercent)));
  }

  function finishResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const next = nearestWidth(dragWidth ?? width);
    dragRef.current = null;
    setDragWidth(null);
    updateAttributes({ widthPercent: next });
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    const index = RICH_TEXT_IMAGE_WIDTHS.indexOf(width);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      updateAttributes({ widthPercent: RICH_TEXT_IMAGE_WIDTHS[Math.max(0, index - 1)] });
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      updateAttributes({ widthPercent: RICH_TEXT_IMAGE_WIDTHS[Math.min(RICH_TEXT_IMAGE_WIDTHS.length - 1, index + 1)] });
    } else if (event.key === "Home") {
      event.preventDefault();
      updateAttributes({ widthPercent: 25 });
    } else if (event.key === "End") {
      event.preventDefault();
      updateAttributes({ widthPercent: 100 });
    }
  }

  return (
    <NodeViewWrapper
      className={`rich-text-image-node relative my-3 max-w-full ${selected ? "is-selected" : ""}`}
      style={{ width: `${displayedWidth}%`, minWidth: "min(160px, 100%)", maxWidth: "100%" }}
      data-width-percent={width}
    >
      <img
        src={node.attrs.src}
        alt={node.attrs.alt || "使用者上傳的問題截圖"}
        draggable={false}
        className="block h-auto w-full max-w-full rounded-lg border border-border object-contain"
      />
      {selected && (
        <div contentEditable={false} className="mt-2 flex max-w-full flex-wrap items-center gap-1 rounded-md border border-primary/30 bg-white p-1 shadow-sm" role="group" aria-label="圖片顯示尺寸">
          {RICH_TEXT_IMAGE_WIDTHS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={width === candidate}
              className="min-h-9 rounded px-2 text-xs font-medium text-text-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-pressed:bg-primary aria-pressed:text-white"
              onClick={() => updateAttributes({ widthPercent: candidate })}
            >
              {candidate === 25 ? "小" : candidate === 50 ? "中" : candidate === 75 ? "大" : "滿版"} {candidate}%
            </button>
          ))}
          <button
            type="button"
            aria-label="拖曳調整圖片尺寸；方向鍵可逐級調整"
            className="ml-auto inline-flex min-h-9 min-w-9 cursor-ew-resize items-center justify-center rounded text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onPointerDown={beginResize}
            onPointerMove={resize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onKeyDown={resizeWithKeyboard}
          >
            <MoveHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
