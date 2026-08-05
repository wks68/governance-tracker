"use client";

// 快速通報介面共用的搜尋式多選（受影響使用者／受影響單位，第 6.4 節），不要求逐一輸入
// 大量人員——選了「大量使用者」影響範圍時清單本來就不必填。

import { useMemo, useState } from "react";

export interface SearchableMultiSelectOption {
  id: string;
  label: string;
}

export default function SearchableMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly SearchableMultiSelectOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  }

  const selectedLabels = options.filter((o) => selected.includes(o.id)).map((o) => o.label);

  return (
    <div>
      <label className="block text-xs font-medium text-text-muted">{label}</label>
      {selectedLabels.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {selectedLabels.map((l) => <span key={l} className="rounded-full bg-primary-muted px-2 py-0.5 text-xs text-primary">{l}</span>)}
        </div>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="輸入關鍵字搜尋"
        className="ui-input mt-1"
      />
      <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border">
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-text-muted">找不到符合的選項</li>
        ) : (
          filtered.map((opt) => (
            <li key={opt.id}>
              <label className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm hover:bg-surface-muted">
                <input type="checkbox" checked={selected.includes(opt.id)} onChange={() => toggle(opt.id)} className="h-4 w-4" />
                {opt.label}
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
