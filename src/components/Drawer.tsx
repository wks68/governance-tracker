"use client";

import { useEffect, useRef, useState } from "react";

// M1.5-B 新增：輕量 slide-over 面板，供「新增/編輯」表單共用（Supervisor／Team LEAD／
// 核准代理三個區塊皆會用到）。Drawer 本身只負責開關殼層（Escape／關閉按鈕／背景點擊），
// 表單內容、送出中狀態與錯誤訊息一律由呼叫端（children）自行管理並傳入 isSubmitting，
// 送出中時 Escape／關閉按鈕／背景點擊一律停用，避免使用者中途關閉造成重複送出的誤解。
export default function Drawer({
  open,
  onClose,
  title,
  isSubmitting = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  isSubmitting?: boolean;
  children: React.ReactNode;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    const timer = window.setTimeout(() => setRendered(false), 220);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSubmitting) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [open, isSubmitting, onClose]);

  if (!rendered) return null;

  return (
    <div className={`fixed inset-0 z-50 flex justify-end transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open}>
      <div
        className="animate-dialog-overlay-in absolute inset-0 bg-black/30"
        aria-hidden="true"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
      />
      <div className={`${open ? "animate-drawer-panel-in translate-x-0" : "translate-x-full"} relative flex h-full w-full max-w-md flex-col bg-white shadow-xl transition-transform duration-200 motion-reduce:transition-none`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="關閉"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
