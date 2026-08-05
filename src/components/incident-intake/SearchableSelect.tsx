"use client";

// 快速通報介面共用的搜尋式單選下拉（任務規格第五節：系統／服務一律搜尋式下拉，支援關鍵字
// 搜尋、常用／最近使用、「不確定」「其他」）。單一元件，System／Service／事件類型以外的
// 搜尋式欄位都重用這個，不在多處各自刻一份 combobox。

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface SearchableSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  recentOptions?: readonly string[];
  placeholder?: string;
  required?: boolean;
  error?: string | null;
}

export default function SearchableSelect({ label, value, onChange, options, recentOptions = [], placeholder = "搜尋或選擇…", required, error }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return base;
  }, [options, query]);

  const showRecent = !query.trim() && recentOptions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-medium text-text-muted" htmlFor={inputId}>{label}{required ? "（必填）" : ""}</label>
      <button
        type="button"
        id={inputId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="ui-input flex min-h-11 w-full items-center justify-between text-left"
      >
        <span className={value ? "text-text-primary" : "text-text-muted"}>{value || placeholder}</span>
        <span aria-hidden className="ml-2 text-text-muted">▾</span>
      </button>
      {error && <p className="mt-1 text-xs text-danger-text">{error}</p>}
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-white shadow-lg">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="輸入關鍵字搜尋"
            className="w-full border-b border-border px-3 py-2 text-sm focus:outline-none"
          />
          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {showRecent && (
              <>
                <li className="px-3 py-1 text-[11px] font-medium uppercase text-text-muted">常用</li>
                {recentOptions.map((opt) => (
                  <li key={`recent-${opt}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === opt}
                      onClick={() => { onChange(opt); setOpen(false); setQuery(""); }}
                      className={`min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-primary-muted ${value === opt ? "bg-primary-muted font-medium text-primary" : "text-text-primary"}`}
                    >
                      {opt}
                    </button>
                  </li>
                ))}
                <li className="my-1 border-t border-border" />
              </>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-muted">找不到符合的選項</li>
            ) : (
              filtered.map((opt) => (
                <li key={opt}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === opt}
                    onClick={() => { onChange(opt); setOpen(false); setQuery(""); }}
                    className={`min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-primary-muted ${value === opt ? "bg-primary-muted font-medium text-primary" : "text-text-primary"}`}
                  >
                    {opt}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
