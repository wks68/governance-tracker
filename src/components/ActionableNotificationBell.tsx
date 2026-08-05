"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/datetime";
import { Bell, X } from "lucide-react";
import { useActionErrorToast } from "@/components/toast/AppToastProvider";

export interface NotificationTask {
  notificationId: string;
  notificationType: "HOTFIX_SUPERVISOR_APPROVAL_REQUIRED" | "HOTFIX_ACTION_REQUIRED" | "INCIDENT_APPROVAL_REQUIRED" | "INCIDENT_ACTION_REQUIRED" | "RCA_APPROVAL_REQUIRED" | "RCA_ACTION_REQUIRED";
  sourceRecordId: string | null;
  recipientUserId: string;
  issueId: string;
  issueKey: string;
  issueTitle: string;
  applicantName: string;
  notificationTitle: string;
  message: string;
  actionKind: "CLAIM" | "ASSIGN_MEMBER" | "ENTER_WORK" | "APPROVE" | "CONFIRM_CLOSE";
  actionLabel: string;
  actionHref: string;
  currentStageLabel: string;
  enteredAt: string | null;
  unread: true;
}

export const ACTIONABLE_NOTIFICATION_POLL_INTERVAL_MS = 4_000;
const MAX_SESSION_TOAST_IDS = 200;

interface NotificationFeedResponse {
  tasks: NotificationTask[];
  generatedAt: string;
}

function taskSignature(tasks: readonly NotificationTask[]): string {
  return tasks.map((task) => task.notificationId).sort().join("|");
}

export default function ActionableNotificationBell({
  tasks,
  userName,
  actorId,
  onTasksChange,
}: {
  tasks: NotificationTask[];
  userName: string;
  actorId: string;
  onTasksChange: (tasks: NotificationTask[]) => void;
}) {
  const router = useRouter();
  const { notifyWorkflowTask } = useActionErrorToast();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tasksRef = useRef(tasks);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    const storageKey = `dms-workflow-task-toasts:${actorId}`;
    const seen = new Set<string>();
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]") as unknown;
      if (Array.isArray(stored)) {
        for (const id of stored) if (typeof id === "string") seen.add(id);
      }
    } catch {
      // sessionStorage 不可用或舊值損毀時，只影響本次 session 的 Toast 去重，不影響待辦。
    }
    // 初次載入只建立基準，不能把所有歷史未完成待辦重新 Toast。
    for (const task of tasksRef.current) seen.add(task.notificationId);

    function persistSeen() {
      try {
        const ids = Array.from(seen).slice(-MAX_SESSION_TOAST_IDS);
        window.sessionStorage.setItem(storageKey, JSON.stringify(ids));
      } catch {
        // 儲存空間不可用時仍由記憶體 Set 保證目前 component lifecycle 不重複提示。
      }
    }
    persistSeen();

    async function refreshFeed() {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/actionable-notifications", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as NotificationFeedResponse;
        if (!Array.isArray(payload.tasks) || stopped) return;

        const previousSignature = taskSignature(tasksRef.current);
        const nextTasks = payload.tasks.filter((task) => task.recipientUserId === actorId);
        for (const task of nextTasks) {
          if (seen.has(task.notificationId)) continue;
          seen.add(task.notificationId);
          notifyWorkflowTask({
            notificationId: task.notificationId,
            title:
              task.notificationType === "HOTFIX_SUPERVISOR_APPROVAL_REQUIRED"
                ? "新的 Hotfix 核准事項"
                : task.notificationTitle,
            description:
              task.notificationType === "HOTFIX_SUPERVISOR_APPROVAL_REQUIRED"
                ? `${task.issueKey} 正在等待你的主管核准。`
                : task.message,
            actionHref: task.actionHref,
            actionLabel: task.actionLabel,
          });
        }
        persistSeen();
        tasksRef.current = nextTasks;
        onTasksChange(nextTasks);

        // Bell／Sidebar 先由本地資料立即更新；只有責任集合真的改變才刷新 Server
        // Components，使摘要卡、Hotfix 清單與工作管理中心同步，不在每次 polling 重讀頁面。
        if (previousSignature !== taskSignature(nextTasks)) router.refresh();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Near-real-time 更新失敗不應破壞目前頁面；下一個週期或 focus 會重試。
        }
      } finally {
        inFlight = false;
      }
    }

    function schedule() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (stopped || document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => {
        await refreshFeed();
        schedule();
      }, ACTIONABLE_NOTIFICATION_POLL_INTERVAL_MS);
    }

    function refreshNow() {
      void refreshFeed().finally(schedule);
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refreshNow();
      else if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    window.addEventListener("focus", refreshNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("focus", refreshNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [actorId, notifyWorkflowTask, onTasksChange, router]);

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
          className="fixed left-4 right-4 top-[4.25rem] z-50 w-auto overflow-hidden rounded-xl border border-border bg-surface shadow-overlay sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(25rem,calc(100vw-2rem))]"
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
                      <span className="font-semibold text-primary">{task.notificationTitle}</span>
                      <span className="shrink-0 rounded-full bg-info-muted px-2 py-0.5 text-xs font-medium text-info">
                        {task.actionLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">{task.applicantName} · {task.issueKey}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-text-primary">{task.issueTitle}</p>
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
