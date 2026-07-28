"use client";

// Hotfix 九階段 UI：問題現象欄位「預設摘要 + 更多... 原地展開/收合」，不得另開頁面。

import { useState } from "react";

export default function ExpandableText({ text, summaryLength = 80 }: { text: string; summaryLength?: number }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  if (!trimmed) return <p className="whitespace-pre-wrap text-sm text-gray-400">（尚未填寫）</p>;

  const needsTruncate = trimmed.length > summaryLength;
  const shown = expanded || !needsTruncate ? trimmed : `${trimmed.slice(0, summaryLength)}…`;

  return (
    <div>
      <p className="whitespace-pre-wrap text-sm text-gray-800">{shown}</p>
      {needsTruncate && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-medium text-primary hover:underline">
          {expanded ? "收合" : "更多..."}
        </button>
      )}
    </div>
  );
}
