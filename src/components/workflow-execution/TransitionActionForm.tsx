"use client";

// M2-B 新增：單一 Transition 的送出表單，供 AvailableTransitionList／ReturnActionPanel／
// CancelActionPanel 共用（不各自重複一套表單邏輯）。只負責把 issueId／transitionId／
// reasonCode 組成 FormData 交給呼叫端傳入的 Server Action——本身完全不判斷這個 Transition
// 合不合法，`disabled` 只是唯讀提示（來自服務層現場預覽），實際授權與所有規則一律由
// Server Action 呼叫的 workflowExecutionService 現場重新驗證。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import type { ActionResult } from "@/lib/actionResult";

export default function TransitionActionForm({
  issueId,
  transitionId,
  requireReason,
  submitLabel,
  confirmMessage,
  action,
  disabled = false,
  buttonClassName,
}: {
  issueId: string;
  transitionId: string;
  requireReason: boolean;
  submitLabel: string;
  confirmMessage?: string;
  action: (formData: FormData) => Promise<ActionResult>;
  disabled?: boolean;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const needsForm = requireReason || !!confirmMessage;

  function submit(formData: FormData) {
    formData.set("issueId", issueId);
    formData.set("transitionId", transitionId);
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const defaultButtonClass = "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40";

  if (!needsForm) {
    return (
      <div>
        <ActionErrorText message={error} code={errorCode} itemKey={issueId} />
        <button type="button" disabled={disabled || isPending} onClick={() => submit(new FormData())} className={buttonClassName ?? defaultButtonClass}>
          {isPending ? "處理中…" : submitLabel}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={buttonClassName ?? defaultButtonClass}>
        {submitLabel}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3"
    >
      <ActionErrorText message={error} code={errorCode} itemKey={issueId} />
      {confirmMessage && <p className="text-xs font-medium text-danger-text">{confirmMessage}</p>}
      {requireReason && <ReasonCodeField disabled={isPending} name="reasonCode" />}
      <div className="flex gap-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50">
          {isPending ? "處理中…" : "確認"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
            setErrorCode(null);
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
        >
          取消
        </button>
      </div>
    </form>
  );
}
