"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { cancelHotfixAction } from "@/app/issues/[id]/hotfix/cancel-actions";
import { resolveIssueDetailHref } from "@/lib/issue-detail-href";

const MAX_REASON_LENGTH = 500;

export default function CancelHotfixButton({ issueId, issueKey }: { issueId: string; issueKey: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("reason", reason);
    startTransition(async () => {
      const result = await cancelHotfixAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.replace(
        resolveIssueDetailHref({ id: issueId, issueType: "Hotfix", currentStageKey: "cancelled" }),
      );
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setReason("");
          setOpen(true);
        }}
        className="rounded-md border border-danger-border px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-bg"
      >
        取消 Hotfix
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="取消 Hotfix" isSubmitting={isPending}>
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs text-gray-400">工單編號</div>
            <div className="font-medium text-gray-900">{issueKey}</div>
          </div>
          <p className="rounded-md bg-danger-bg px-3 py-2 text-danger-text">取消後此工單將停止正式處理流程，確定要取消嗎？</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              取消原因<span className="ml-1 text-danger">*</span>
            </label>
            <textarea
              rows={3}
              maxLength={MAX_REASON_LENGTH}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
            <p className="mt-0.5 text-right text-xs text-gray-400">{reason.length}/{MAX_REASON_LENGTH}</p>
          </div>
          <ActionErrorText message={error} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending || !reason.trim()}
              onClick={submit}
              className="rounded-md bg-gov-red px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "處理中…" : "確認取消"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              返回
            </button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
