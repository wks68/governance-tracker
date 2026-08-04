"use client";

// Hotfix 九階段 UI：4 個獨立主管簽核頁共用的「主管簽核」區塊——只有同意（實心藍）／
// 駁回（紅色外框）兩個按鈕。駁回一律開啟必填的「駁回意見」視窗（500 字上限，取消／確認
// 駁回）；同意不強制填寫意見。非目前責任角色時完全唯讀，只顯示應由誰核准。

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { decideHotfixApprovalAction } from "@/app/issues/[id]/hotfix/approval-actions";
import { formatDateTime } from "@/lib/datetime";

const MAX_REASON_LENGTH = 500;

function RejectModal({ onCancel, onConfirm, isPending, title }: { onCancel: () => void; onConfirm: (reason: string) => void; isPending: boolean; title: string }) {
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
      <div role="dialog" aria-modal="true" aria-labelledby="reject-dialog-title" className={`${closing ? "animate-dialog-content-out" : "animate-dialog-content-in"} w-full max-w-md rounded-lg bg-white p-4 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <h3 id="reject-dialog-title" className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="mt-1 text-xs text-gray-500">請填寫駁回原因，將完整記錄於工單歷程，供後續稽核與追蹤。</p>
        <textarea
          ref={inputRef}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON_LENGTH))}
          rows={4}
          maxLength={MAX_REASON_LENGTH}
          disabled={isPending}
          className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          placeholder="請說明駁回原因（必填，最多 500 字）"
        />
        <p className="mt-1 text-right text-xs text-gray-400">{reason.length}/{MAX_REASON_LENGTH}</p>
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
            {isPending ? "處理中…" : "確認駁回"}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface ApprovalReviewPanelProps {
  issueId: string;
  approvalRecordId: string;
  /** 簽核關卡名稱，例如「申請人直屬主管簽核」。 */
  stageLabel: string;
  roleLabel: string;
  requestedByName: string;
  requestedAt: string;
  isResponsible: boolean;
  expectedApproverLabel: string | null;
  onDoneRedirectTo?: string;
}

export default function ApprovalReviewPanel({ issueId, approvalRecordId, stageLabel, roleLabel, requestedByName, requestedAt, isResponsible, expectedApproverLabel }: ApprovalReviewPanelProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rejectTriggerRef = useRef<HTMLButtonElement>(null);

  function closeReject() {
    setRejectOpen(false);
    window.requestAnimationFrame(() => rejectTriggerRef.current?.focus());
  }

  function submit(decision: "APPROVED" | "REJECTED", reason: string) {
    setError(null);
    setErrorCode(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("approvalRecordId", approvalRecordId);
    fd.set("decision", decision);
    fd.set("decisionReasonCode", reason);
    startTransition(async () => {
      const result = await decideHotfixApprovalAction(fd);
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      setRejectOpen(false);
      // Server Action 內已 revalidatePath；頁面本身在下一次載入會依目前關卡自動轉址。
      window.location.reload();
    });
  }

  return (
    <section id="approval-section" className="ui-card p-5 sm:p-6">
      <h2 className="text-base font-semibold text-text-primary">主管簽核</h2>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-text-muted">簽核關卡</dt>
          <dd className="mt-1 font-medium text-text-primary">{stageLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">應核准人</dt>
          <dd className="mt-1 font-medium text-text-primary">{expectedApproverLabel ?? roleLabel}</dd>
          <dd className="mt-0.5 text-xs text-text-secondary">{roleLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">送簽人</dt>
          <dd className="mt-1 font-medium text-text-primary">{requestedByName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">送簽時間</dt>
          <dd className="mt-1 font-medium text-text-primary">{formatDateTime(requestedAt)}</dd>
        </div>
      </dl>

      {!isResponsible ? (
        <p className="mt-4 text-xs text-gray-400">僅{roleLabel}可執行簽核。</p>
      ) : (
        <>
          <ActionErrorText message={error} code={errorCode} itemKey={issueId} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => submit("APPROVED", "")}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
            >
              {isPending ? "處理中…" : "同意"}
            </button>
            <button
              ref={rejectTriggerRef}
              type="button"
              disabled={isPending}
              onClick={() => setRejectOpen(true)}
              className="rounded-md border border-danger-border bg-white px-4 py-2 text-sm font-medium text-danger-text hover:bg-danger-bg disabled:opacity-40"
            >
              駁回
            </button>
          </div>
        </>
      )}

      {rejectOpen && <RejectModal title="駁回意見" isPending={isPending} onCancel={closeReject} onConfirm={(reason) => submit("REJECTED", reason)} />}
    </section>
  );
}
