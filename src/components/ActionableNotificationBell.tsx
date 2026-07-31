"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatDateTime } from "@/lib/datetime";

export interface NotificationTask {
  issueId: string;
  issueKey: string;
  title: string;
  actionLabel: string;
  actionHref: string;
  currentStageLabel: string;
  enteredAt: string | null;
}

export default function ActionableNotificationBell({ tasks }: { tasks: NotificationTask[] }) {
  const [open, setOpen] = useState(false);
  const [wiggling, setWiggling] = useState(tasks.length > 0);
  const previousCount = useRef(tasks.length);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const increased = tasks.length > previousCount.current;
    previousCount.current = tasks.length;
    if (tasks.length === 0 || (!increased && !wiggling)) return;
    setWiggling(true);
    const timer = window.setTimeout(() => setWiggling(false), 700);
    return () => window.clearTimeout(timer);
  }, [tasks.length, wiggling]);

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

  const badge = tasks.length > 99 ? "99+" : String(tasks.length);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={tasks.length > 0 ? `待我處理，共 ${tasks.length} 筆` : "待我處理，目前沒有待辦"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={`h-5 w-5 origin-top ${wiggling ? "animate-notification-bell" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path strokeLinecap="round" d="M10 21h4" />
        </svg>
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
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">待我處理</h2>
            <p className="mt-0.5 text-xs text-gray-500">僅顯示目前確實由你執行的工作，不會因查看而清除。</p>
          </div>
          {tasks.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">目前沒有待處理工單。</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto">
              {tasks.map((task) => (
                <li key={task.issueId}>
                  <Link
                    href={task.actionHref}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-primary">{task.issueKey}</span>
                      <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {task.actionLabel}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-800">{task.title}</p>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                      <dt className="text-gray-400">目前階段</dt>
                      <dd className="text-gray-600">{task.currentStageLabel}</dd>
                      <dt className="text-gray-400">進入待辦</dt>
                      <dd className="text-gray-600">{formatDateTime(task.enteredAt)}</dd>
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
