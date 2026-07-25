"use client";

import { useState } from "react";

// M1.5-B 新增：危險操作兩段式確認按鈕（終止主管／取消排程／移除 LEAD／撤銷代理皆共用）。
// 第一次點擊只切換成「確定？／取消」狀態，第二次點擊才真正呼叫 onConfirm——不使用
// window.confirm（無法客製樣式、也無法在 disabled 狀態下正確反映提交中）。
export default function ConfirmButton({
  label,
  confirmLabel = "確定？",
  onConfirm,
  disabled = false,
  className,
  confirmClassName,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  confirmClassName?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
          disabled={disabled}
          className={
            confirmClassName ??
            "rounded-md bg-gov-red px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={disabled}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          取消
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={disabled}
      className={
        className ??
        "rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {label}
    </button>
  );
}
