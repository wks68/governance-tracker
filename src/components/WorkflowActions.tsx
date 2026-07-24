"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionStatusAction, sendBackToRdAction } from "@/lib/actions";

export default function WorkflowActions({
  issueId,
  nextStatus,
  nextStatusLabel,
  prevStatus,
  gatePassed,
  canSendBackToRd,
}: {
  issueId: string;
  nextStatus: string | null;
  nextStatusLabel?: string | null;
  prevStatus: string | null;
  gatePassed: boolean;
  canSendBackToRd?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showSendBack, setShowSendBack] = useState(false);
  const [sendBackMessage, setSendBackMessage] = useState("");
  const [sendBackError, setSendBackError] = useState("");

  function advance() {
    startTransition(async () => {
      await transitionStatusAction(issueId, "next");
      router.refresh();
    });
  }
  function rollback() {
    startTransition(async () => {
      await transitionStatusAction(issueId, "back");
      router.refresh();
    });
  }
  function sendBackToRd() {
    if (!sendBackMessage.trim()) {
      setSendBackError("請先填寫發回訊息");
      return;
    }
    setSendBackError("");
    const formData = new FormData();
    formData.set("message", sendBackMessage.trim());
    startTransition(async () => {
      await sendBackToRdAction(issueId, formData);
      setSendBackMessage("");
      setShowSendBack(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={rollback}
          disabled={!prevStatus || isPending}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          退回上一關
        </button>
        <button
          onClick={advance}
          disabled={!nextStatus || !gatePassed || isPending}
          title={!gatePassed ? "關卡卡控未通過，請先補齊下方缺漏項目" : undefined}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {nextStatus ? `推進至下一關卡：${nextStatusLabel ?? nextStatus}` : "已是最終關卡"}
        </button>
        {canSendBackToRd && (
          <button
            onClick={() => setShowSendBack((v) => !v)}
            disabled={isPending}
            className="rounded-md border border-danger-border px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-gov-redbg disabled:cursor-not-allowed disabled:opacity-40"
          >
            發回給 RD
          </button>
        )}
        {!gatePassed && nextStatus && (
          <span className="text-xs text-warning-text">關卡卡控未通過，請先補齊下方缺漏項目後才能推進</span>
        )}
      </div>
      {canSendBackToRd && showSendBack && (
        <div className="rounded-md border border-danger-border bg-danger-bg p-3">
          <label className="mb-1 block text-xs font-medium text-gray-700">
            發回訊息（必填，將記錄為留言並發回至「RD修正」）
          </label>
          <textarea
            value={sendBackMessage}
            onChange={(e) => setSendBackMessage(e.target.value)}
            rows={2}
            placeholder="請說明發回原因，例如：QA 複測未通過的項目"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          {sendBackError && <p className="mt-1 text-xs text-danger-text">{sendBackError}</p>}
          <div className="mt-2 flex gap-2">
            <button
              onClick={sendBackToRd}
              disabled={isPending}
              className="rounded-md bg-gov-red px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              確認發回
            </button>
            <button
              onClick={() => {
                setShowSendBack(false);
                setSendBackError("");
              }}
              disabled={isPending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
