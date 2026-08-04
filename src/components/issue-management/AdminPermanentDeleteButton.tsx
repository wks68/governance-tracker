"use client";

// 建立工單／團隊整合修正新增：Admin 永久刪除工單 Modal——填寫原因、再次輸入工單編號確認、
// 顯示不可復原警告與關聯資料摘要，不使用瀏覽器原生 confirm。

import { useState, useTransition } from "react";
import Drawer from "@/components/Drawer";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { adminPermanentDeleteIssueAction } from "@/app/issues/[id]/delete-actions";
import type { AdminDeleteImpactSummary } from "@/lib/issue-management/issueDeletionService";

const MAX_REASON_LENGTH = 500;

export default function AdminPermanentDeleteButton({ issueId, summary }: { issueId: string; summary: AdminDeleteImpactSummary }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmIssueKey, setConfirmIssueKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canSubmit = reason.trim().length > 0 && confirmIssueKey.trim() === summary.issueKey;

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("reason", reason);
    fd.set("confirmIssueKey", confirmIssueKey);
    startTransition(async () => {
      const result = await adminPermanentDeleteIssueAction(fd);
      if (result && !result.ok) setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setReason("");
          setConfirmIssueKey("");
          setOpen(true);
        }}
        className="rounded-md border border-danger-border px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-bg"
      >
        永久刪除工單
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="永久刪除工單" isSubmitting={isPending}>
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-2 rounded-md bg-gray-50 p-3">
            <div>
              <dt className="text-xs text-gray-400">工單編號</dt>
              <dd className="font-medium text-gray-900">{summary.issueKey}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">目前階段</dt>
              <dd className="font-medium text-gray-900">{summary.currentStageLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">申請人</dt>
              <dd className="font-medium text-gray-900">{summary.applicantName}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">團隊</dt>
              <dd className="font-medium text-gray-900">{summary.teamName ?? "（未指派）"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-gray-400">標題</dt>
              <dd className="font-medium text-gray-900">{summary.title}</dd>
            </div>
            <div className="col-span-2 text-xs text-gray-500">
              關聯核准紀錄 {summary.approvalRecordCount} 筆・流程歷程 {summary.historyCount} 筆・附件 {summary.attachmentCount} 筆，將一併清除。
            </div>
          </dl>
          <p className="rounded-md bg-danger-bg px-3 py-2 text-danger-text">此操作將永久刪除此工單與所有關聯資料，無法復原。</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              刪除原因<span className="ml-1 text-danger">*</span>
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
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              請再次輸入工單編號「{summary.issueKey}」以確認<span className="ml-1 text-danger">*</span>
            </label>
            <input
              value={confirmIssueKey}
              onChange={(e) => setConfirmIssueKey(e.target.value)}
              disabled={isPending}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <ActionErrorText message={error} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending || !canSubmit}
              onClick={submit}
              className="rounded-md bg-gov-red px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "刪除中…" : "永久刪除"}
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
