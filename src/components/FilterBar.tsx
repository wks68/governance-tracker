"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STATUS_LIGHT_META } from "@/lib/constants";
import { HOTFIX_PRIORITIES } from "@/lib/hotfix-ui/priority";

export interface FilterOptions {
  systemNames: string[];
  waitingRoles: string[];
}

type DraftFilters = {
  quick: string;
  systemName: string;
  light: string;
  urgency: string;
  waitingRole: string;
  overdue: boolean;
};

const PANEL_FILTER_KEYS = ["quick", "systemName", "light", "urgency", "waitingRole", "overdue"] as const;
const ACTIVE_FILTER_KEYS = ["summary", ...PANEL_FILTER_KEYS] as const;
type ActiveFilterKey = (typeof ACTIVE_FILTER_KEYS)[number];

const QUICK_LABELS: Record<string, string> = {
  mine: "待我處理",
  myApprovals: "待我核准",
  claimable: "待團隊接單",
  myTeam: "我團隊處理中",
};

const SUMMARY_LABELS: Record<string, string> = {
  "my-work": "待我處理",
  "pending-approval": "待主管核准",
  "due-this-week": "本週到期",
};

function hrefWithParams(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function FilterBar({
  options,
  showActionability,
}: {
  options: FilterOptions;
  showActionability: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [draft, setDraft] = useState<DraftFilters>(() => readDraft(searchParams));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSearch(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const activeFilters = ACTIVE_FILTER_KEYS.filter((key) => {
    if (!showActionability && (key === "quick" || key === "summary")) return false;
    return searchParams.has(key);
  });

  function openPanel() {
    setDraft(readDraft(searchParams));
    setOpen(true);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    const value = search.trim();
    if (value) params.set("q", value);
    else params.delete("q");
    router.push(hrefWithParams(pathname, params));
  }

  function clearSearch() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    setSearch("");
    router.push(hrefWithParams(pathname, params));
  }

  function applyFilters() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of PANEL_FILTER_KEYS) params.delete(key);
    if (showActionability && draft.quick) params.set("quick", draft.quick);
    if (draft.systemName) params.set("systemName", draft.systemName);
    if (draft.light) params.set("light", draft.light);
    if (draft.urgency) params.set("urgency", draft.urgency);
    if (draft.waitingRole) params.set("waitingRole", draft.waitingRole);
    if (draft.overdue) params.set("overdue", "1");
    router.push(hrefWithParams(pathname, params));
    setOpen(false);
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ACTIVE_FILTER_KEYS) params.delete(key);
    router.push(hrefWithParams(pathname, params));
    setOpen(false);
  }

  function removeFilter(key: ActiveFilterKey) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    router.push(hrefWithParams(pathname, params));
  }

  const controlClass =
    "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20";

  return (
    <div ref={rootRef} className="relative rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={submitSearch} className="flex w-full min-w-0 flex-1 flex-wrap gap-2 sm:w-auto sm:min-w-[16rem] sm:flex-nowrap">
          <input
            type="search"
            aria-label="搜尋 Hotfix 單號、標題或系統名稱"
            placeholder="搜尋 Hotfix 單號、標題或系統名稱"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            搜尋
          </button>
          {(search || searchParams.has("q")) && (
            <button type="button" onClick={clearSearch} className="rounded-md px-2 py-2 text-sm text-text-secondary hover:bg-surface-muted hover:text-text-primary">
              清除搜尋
            </button>
          )}
        </form>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => (open ? setOpen(false) : openPanel())}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-primary hover:text-primary"
        >
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />
          </svg>
          {activeFilters.length > 0 ? `篩選 ${activeFilters.length}` : "篩選"}
        </button>
      </div>

      {activeFilters.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="已套用篩選">
          {activeFilters.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => removeFilter(key)}
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100"
              aria-label={`移除篩選：${filterLabel(key, searchParams.get(key) ?? "")}`}
            >
              {filterLabel(key, searchParams.get(key) ?? "")}
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="進階篩選"
          className="absolute right-3 top-[calc(100%-0.25rem)] z-40 mt-2 w-[min(42rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {showActionability && (
              <label className="text-sm text-gray-700">
                <span className="mb-1 block font-medium">待辦範圍</span>
                <select className={controlClass} value={draft.quick} onChange={(event) => setDraft({ ...draft, quick: event.target.value })}>
                  <option value="">全部</option>
                  <option value="mine">待我處理</option>
                  <option value="myApprovals">待我核准</option>
                  <option value="claimable">待團隊接單</option>
                  <option value="myTeam">我團隊處理中</option>
                </select>
              </label>
            )}
            <label className="text-sm text-gray-700">
              <span className="mb-1 block font-medium">系統名稱</span>
              <select className={controlClass} value={draft.systemName} onChange={(event) => setDraft({ ...draft, systemName: event.target.value })}>
                <option value="">全部</option>
                {options.systemNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700">
              <span className="mb-1 block font-medium">狀態燈號</span>
              <select className={controlClass} value={draft.light} onChange={(event) => setDraft({ ...draft, light: event.target.value })}>
                <option value="">全部</option>
                {Object.entries(STATUS_LIGHT_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700">
              <span className="mb-1 block font-medium">緊急程度</span>
              <select className={controlClass} value={draft.urgency} onChange={(event) => setDraft({ ...draft, urgency: event.target.value })}>
                <option value="">全部</option>
                {HOTFIX_PRIORITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700">
              <span className="mb-1 block font-medium">等待角色</span>
              <select className={controlClass} value={draft.waitingRole} onChange={(event) => setDraft({ ...draft, waitingRole: event.target.value })}>
                <option value="">全部</option>
                {options.waitingRoles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={draft.overdue}
                onChange={(event) => setDraft({ ...draft, overdue: event.target.checked })}
                className="h-4 w-4"
              />
              只看逾期項目
            </label>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
            <button type="button" onClick={clearAll} className="mr-auto text-sm text-gray-500 hover:text-gray-800">
              清除全部
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              取消
            </button>
            <button type="button" onClick={applyFilters} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
              套用篩選
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function readDraft(searchParams: Pick<URLSearchParams, "get">): DraftFilters {
  return {
    quick: searchParams.get("quick") ?? "",
    systemName: searchParams.get("systemName") ?? "",
    light: searchParams.get("light") ?? "",
    urgency: searchParams.get("urgency") ?? "",
    waitingRole: searchParams.get("waitingRole") ?? "",
    overdue: searchParams.get("overdue") === "1",
  };
}

function filterLabel(key: ActiveFilterKey, value: string): string {
  if (key === "summary") return SUMMARY_LABELS[value] ?? "摘要條件";
  if (key === "quick") return QUICK_LABELS[value] ?? "待辦範圍";
  if (key === "systemName") return `系統：${value}`;
  if (key === "light") return `燈號：${STATUS_LIGHT_META[value as keyof typeof STATUS_LIGHT_META]?.label ?? value}`;
  if (key === "urgency") return `緊急程度：${HOTFIX_PRIORITIES.find((item) => item.value === value)?.label ?? value}`;
  if (key === "waitingRole") return `等待：${value}`;
  return "只看逾期";
}
