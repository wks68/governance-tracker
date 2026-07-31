"use client";

import Link from "next/link";
import { CircleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ACTION_ERROR_TOAST_DEDUPE_MS,
  ACTION_ERROR_TOAST_DURATION_MS,
  ACTION_ERROR_TOAST_FADE_MS,
  ACTION_ERROR_TOAST_LIMIT,
  mapActionErrorMessage,
  type ActionErrorInput,
  type MappedActionError,
} from "@/lib/actionErrorToast";

interface ToastEntry extends MappedActionError {
  id: number;
  actionHref?: string;
  actionLabel?: string;
}

interface AppToastContextValue {
  notifyActionError: (input: ActionErrorInput) => void;
}

const AppToastContext = createContext<AppToastContextValue | null>(null);

export default function AppToastProvider({
  children,
  canManageResponsibility = false,
}: {
  children: ReactNode;
  canManageResponsibility?: boolean;
}) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextIdRef = useRef(1);
  const recentRef = useRef(new Map<string, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notifyActionError = useCallback(
    (input: ActionErrorInput) => {
      const mapped = mapActionErrorMessage(input);
      const locationKey = input.itemKey || `${window.location.pathname}${window.location.search}`;
      const dedupeKey = `${mapped.code}:${locationKey}`;
      const now = Date.now();
      const previous = recentRef.current.get(dedupeKey);
      if (previous !== undefined && now - previous < ACTION_ERROR_TOAST_DEDUPE_MS) return;

      for (const [key, shownAt] of recentRef.current) {
        if (now - shownAt >= ACTION_ERROR_TOAST_DEDUPE_MS) recentRef.current.delete(key);
      }
      recentRef.current.set(dedupeKey, now);

      const entry: ToastEntry = {
        ...mapped,
        id: nextIdRef.current++,
        ...(mapped.missingSupervisor && canManageResponsibility
          ? { actionHref: "/settings/approval-governance", actionLabel: "前往權責設定" }
          : {}),
      };
      setToasts((current) => [entry, ...current].slice(0, ACTION_ERROR_TOAST_LIMIT));
    },
    [canManageResponsibility],
  );

  return (
    <AppToastContext.Provider value={{ notifyActionError }}>
      {children}
      <div
        className="pointer-events-none fixed left-4 right-4 top-20 z-[90] flex flex-col gap-2 sm:left-auto sm:right-5 sm:w-[min(27.5rem,calc(100vw-2.5rem))]"
        aria-live="assertive"
        aria-atomic="false"
        aria-label="操作通知"
      >
        {toasts.map((toast) => (
          <ActionErrorToast key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </AppToastContext.Provider>
  );
}

export function useActionErrorToast(): AppToastContextValue {
  const context = useContext(AppToastContext);
  if (!context) throw new Error("useActionErrorToast 必須在 AppToastProvider 內使用");
  return context;
}

function ActionErrorToast({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  const [fading, setFading] = useState(false);
  const remainingRef = useRef(ACTION_ERROR_TOAST_DURATION_MS);
  const startedAtRef = useRef(0);
  const pausedRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    fadeTimerRef.current = null;
    dismissTimerRef.current = null;
  }, []);

  const schedule = useCallback(() => {
    clearTimers();
    startedAtRef.current = Date.now();
    const remaining = remainingRef.current;
    if (remaining <= ACTION_ERROR_TOAST_FADE_MS) {
      setFading(true);
    } else {
      fadeTimerRef.current = setTimeout(() => setFading(true), remaining - ACTION_ERROR_TOAST_FADE_MS);
    }
    dismissTimerRef.current = setTimeout(() => onDismiss(toast.id), remaining);
  }, [clearTimers, onDismiss, toast.id]);

  useEffect(() => {
    schedule();
    return clearTimers;
  }, [clearTimers, schedule]);

  function pause() {
    if (pausedRef.current) return;
    pausedRef.current = true;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    clearTimers();
    setFading(false);
  }

  function resume() {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    schedule();
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) resume();
  }

  function handleMouseLeave(event: MouseEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(document.activeElement)) resume();
  }

  return (
    <div
      role="alert"
      tabIndex={0}
      onMouseEnter={pause}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={pause}
      onBlurCapture={handleBlur}
      className={`app-toast-enter pointer-events-auto relative overflow-hidden rounded-xl border border-danger/25 bg-surface p-4 pr-11 shadow-overlay transition-opacity duration-[400ms] ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger-muted text-danger">
          <CircleAlert className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">{toast.title}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-text-secondary">{toast.description}</p>
          {toast.actionHref && toast.actionLabel && (
            <Link href={toast.actionHref} className="mt-2 inline-flex text-sm font-semibold text-primary hover:text-primary-hover hover:underline">
              {toast.actionLabel}
            </Link>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="關閉錯誤通知"
        onClick={() => onDismiss(toast.id)}
        className="absolute right-2.5 top-2.5 rounded-lg p-1.5 text-text-muted hover:bg-danger-muted hover:text-danger"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
