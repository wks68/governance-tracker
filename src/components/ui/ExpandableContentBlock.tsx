"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

export default function ExpandableContentBlock({
  text,
  emptyText = "尚未提供",
  characterThreshold = 220,
}: {
  text: string;
  emptyText?: string;
  characterThreshold?: number;
}) {
  const contentId = useId();
  const contentRef = useRef<HTMLParagraphElement>(null);
  const normalized = text.trim();
  const [expanded, setExpanded] = useState(false);
  // Character length is available during SSR, so long content starts collapsed
  // immediately instead of briefly expanding before the layout effect runs.
  const [expandable, setExpandable] = useState(normalized.length > characterThreshold);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node || !normalized) {
      setExpandable(false);
      return;
    }
    setExpandable(normalized.length > characterThreshold || node.scrollHeight > 152);
  }, [characterThreshold, normalized]);

  if (!normalized) return <p className="text-sm text-text-muted">{emptyText}</p>;

  return (
    <div className="relative min-w-0 max-w-full">
      <div className="relative min-w-0 max-w-full overflow-hidden transition-[max-height] duration-200 ease-out motion-reduce:transition-none">
        <p
          ref={contentRef}
          id={contentId}
          className={`max-w-full break-words whitespace-pre-wrap text-sm leading-6 text-text-primary [overflow-wrap:anywhere] ${expandable && !expanded ? "line-clamp-5" : ""}`}
        >
          {normalized}
        </p>
        {expandable && !expanded && (
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
        )}
      </div>
      {expandable && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
          className="animate-expand-hint-once mt-2 rounded-md px-1 py-0.5 text-xs font-semibold text-primary transition hover:bg-primary-muted motion-reduce:animate-none"
        >
          {expanded ? "顯示更少" : "閱讀更多"}
        </button>
      )}
    </div>
  );
}
