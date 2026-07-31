"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatDateTime } from "@/lib/datetime";
import { Bell, X } from "lucide-react";

export interface NotificationTask {
  issueId: string;
  issueKey: string;
  title: string;
  actionLabel: string;
  actionHref: string;
  currentStageLabel: string;
  enteredAt: string | null;
}

export default function ActionableNotificationBell({ tasks, userName }: { tasks: NotificationTask[]; userName: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.requestAnimationFrame(() => closeRef.current?.focus());
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const badge = tasks.length > 99 ? "99+" : String(tasks.length);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={tasks.length > 0 ? `待我處理，共 ${tasks.length} 筆` : "待我處理，目前沒有待辦"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2 text-text-secondary hover:bg-primary-muted hover:text-primary focus-visible:ring-2 focus-visible:ring-focus-ring/30"
      >
        <Bell
          aria-hidden="true"
          className={`h-5 w-5 origin-top ${tasks.length > 0 && !open ? "animate-notification-bell" : ""}`}
        />
        {tasks.length > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="待我處理"
          className="absolute right-0 z-50 mt-2 w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-overlay"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div aria-live="polite">
              <h2 className="text-sm font-semibold text-text-primary">
                {tasks.length > 0 ? `${userName}，輪到你處理了` : `${userName}，目前沒有待處理事項`}
              </h2>
              {tasks.length > 0 && <p className="mt-0.5 text-xs text-text-secondary">共 {tasks.length} 件待處理事項</p>}
              <p className="mt-1 text-xs text-text-muted">查看不會清除待辦，完成動作後才會由系統移除。</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              aria-label="關閉通知"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-primary"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {tasks.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">所有需要你處理的事項都已完成。</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto">
              {tasks.map((task) => (
                <li key={task.issueId}>
                  <Link
                    href={task.actionHref}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold text-primary">{task.issueKey} 等待你{task.actionLabel}</span>
                      <span className="shrink-0 rounded-full bg-info-muted px-2 py-0.5 text-xs font-medium text-info">
                        {task.actionLabel}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-text-primary">{task.title}</p>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                      <dt className="text-text-muted">目前階段</dt>
                      <dd className="text-text-secondary">{task.currentStageLabel}</dd>
                      <dt className="text-text-muted">進入待辦</dt>
                      <dd className="text-text-secondary">{formatDateTime(task.enteredAt)}</dd>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
