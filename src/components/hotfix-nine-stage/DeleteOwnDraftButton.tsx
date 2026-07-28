"use client";

import { useState, useTransition } from "react";
import Drawer from "@/components/Drawer";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { deleteOwnDraftIssueAction } from "@/app/issues/[id]/delete-actions";

export default function DeleteOwnDraftButton({
  issueId,
  issueKey,
  title,
  modalTitle = "刪除工單",
}: {
  issueId: string;
  issueKey: string;
  title: string;
  modalTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    startTransition(async () => {
      const result = await deleteOwnDraftIssueAction(fd);
      // 成功時 Server Action 內部會 redirect，不會回傳到這裡；只有失敗才會走到這行。
      if (result && !result.ok) setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md border border-danger-border px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-bg"
      >
        刪除工單
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={modalTitle} isSubmitting={isPending}>
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs text-gray-400">工單編號</div>
            <div className="font-medium text-gray-900">{issueKey}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">標題</div>
            <div className="font-medium text-gray-900">{title}</div>
          </div>
          <p className="rounded-md bg-danger-bg px-3 py-2 text-danger-text">刪除後將無法復原，確定要刪除此工單嗎？</p>
          <ActionErrorText message={error} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={submit}
              className="rounded-md bg-gov-red px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "刪除中…" : "確認刪除"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
