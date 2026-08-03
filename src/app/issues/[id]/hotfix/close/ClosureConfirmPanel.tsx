"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { confirmHotfixClosureAction, rejectHotfixClosureAction } from "../closure-actions";

const MAX_REASON_LENGTH = 500;

function RejectModal({ onCancel, onConfirm, isPending }: { onCancel: () => void; onConfirm: (reason: string) => void; isPending: boolean }) {
  const [reason, setReason] = useState("");
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const blank = reason.trim().length === 0;

  const requestClose = useCallback(() => {
    if (isPending || closing) return;
    setClosing(true);
    window.setTimeout(onCancel, 160);
  }, [closing, isPending, onCancel]);

  useEffect(() => {
    inputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  return (
    <div className={`${closing ? "animate-dialog-overlay-out" : "animate-dialog-overlay-in"} fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4`} onClick={requestClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="closure-reject-title" className={`${closing ? "animate-dialog-content-out" : "animate-dialog-content-in"} w-full max-w-md rounded-lg bg-white p-4 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <h3 id="closure-reject-title" className="text-sm font-semibold text-gray-800">退回處理意見</h3>
        <p className="mt-1 text-xs text-gray-500">請說明退回原因，將完整記錄於工單歷程。</p>
        <textarea
          ref={inputRef}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON_LENGTH))}
          rows={4}
          maxLength={MAX_REASON_LENGTH}
          disabled={isPending}
          className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          placeholder="請說明退回原因（必填，最多 500 字）"
        />
        <p className="mt-1 text-right text-xs text-gray-400">
          {reason.length}/{MAX_REASON_LENGTH}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" disabled={isPending || closing} onClick={requestClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            type="button"
            disabled={isPending || blank}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {isPending ? "處理中…" : "確認退回"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClosureConfirmPanel({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rejectTriggerRef = useRef<HTMLButtonElement>(null);

  function closeReject() {
    setRejectOpen(false);
    window.requestAnimationFrame(() => rejectTriggerRef.current?.focus());
  }

  function confirm() {
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("issueId", issueId);
      const result = await confirmHotfixClosureAction(fd);
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      router.refresh();
    });
  }

  function reject(reason: string) {
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("issueId", issueId);
      fd.set("reason", reason);
      const result = await rejectHotfixClosureAction(fd);
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      setRejectOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">確認結案</h2>
      <p className="mt-1 text-sm text-gray-500">請確認全部流程資料；此處不會修改任何已提交或已核准的內容。</p>
      <ActionErrorText message={error} code={errorCode} itemKey={issueId} />
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={isPending} onClick={confirm} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40">
          {isPending ? "處理中…" : "確認結案"}
        </button>
        <button
          ref={rejectTriggerRef}
          type="button"
          disabled={isPending}
          onClick={() => setRejectOpen(true)}
          className="rounded-md border border-danger-border bg-white px-4 py-2 text-sm font-medium text-danger-text hover:bg-danger-bg disabled:opacity-40"
        >
          退回處理
        </button>
      </div>
      {rejectOpen && <RejectModal isPending={isPending} onCancel={closeReject} onConfirm={reject} />}
    </section>
  );
}
