"use client";

// Hotfix 九階段 UI：4 個獨立主管簽核頁共用的「主管簽核」區塊——只有同意（實心藍）／
// 駁回（紅色外框）兩個按鈕。駁回一律開啟必填的「駁回意見」視窗（500 字上限，取消／確認
// 駁回）；同意不強制填寫意見。非目前責任角色時完全唯讀，只顯示應由誰核准。

import { useState, useTransition } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { decideHotfixApprovalAction } from "@/app/issues/[id]/hotfix/approval-actions";
import { formatDateTime } from "@/lib/datetime";

const MAX_REASON_LENGTH = 500;

function RejectModal({ onCancel, onConfirm, isPending, title }: { onCancel: () => void; onConfirm: (reason: string) => void; isPending: boolean; title: string }) {
  const [reason, setReason] = useState("");
  const blank = reason.trim().length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="mt-1 text-xs text-gray-500">請填寫駁回原因，將完整記錄於工單歷程，供後續稽核與追蹤。</p>
        <textarea
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
          <button type="button" disabled={isPending} onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
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
  roleLabel: string;
  requestedByName: string;
  requestedAt: string;
  isResponsible: boolean;
  expectedApproverLabel: string | null;
  onDoneRedirectTo?: string;
}

export default function ApprovalReviewPanel({ issueId, approvalRecordId, roleLabel, requestedByName, requestedAt, isResponsible, expectedApproverLabel }: ApprovalReviewPanelProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(decision: "APPROVED" | "REJECTED", reason: string) {
    setError(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("approvalRecordId", approvalRecordId);
    fd.set("decision", decision);
    fd.set("decisionReasonCode", reason);
    startTransition(async () => {
      const result = await decideHotfixApprovalAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRejectOpen(false);
      // Server Action 內已 revalidatePath；頁面本身在下一次載入會依目前關卡自動轉址。
      window.location.reload();
    });
  }

  return (
    <section id="approval-section" className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">主管簽核</h2>
      <p className="mt-1 text-xs text-gray-500">
        由 {requestedByName} 於 {formatDateTime(requestedAt)} 送出，等待{roleLabel}簽核。
      </p>

      {!isResponsible ? (
        <p className="mt-3 text-xs text-gray-400">僅{roleLabel}可簽核，此頁為唯讀。{expectedApproverLabel ? `目前應由：${expectedApproverLabel}` : ""}</p>
      ) : (
        <>
          <ActionErrorText message={error} />
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

      {rejectOpen && <RejectModal title="駁回意見" isPending={isPending} onCancel={() => setRejectOpen(false)} onConfirm={(reason) => submit("REJECTED", reason)} />}
    </section>
  );
}
