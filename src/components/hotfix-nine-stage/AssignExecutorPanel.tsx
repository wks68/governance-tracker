"use client";

// RD/QA/OP 接單流程新增：CLAIM 關卡（已接單，待指派）的共用首次指派 Dialog。
//
// 只有承接團隊的 active Lead 會看到右上角按鈕與 Dialog；其餘人員不渲染操作入口，
// 正文由 ExecutorAssignmentSummary 唯讀顯示目前承接狀態。

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { assignIssueExecutorAction } from "@/app/issues/[id]/hotfix/claim-actions";
import type { AssignableMembersPreview } from "@/lib/workflowExecutionService";

export interface AssignExecutorPanelProps {
  issueId: string;
  preview: AssignableMembersPreview;
}

export default function AssignExecutorPanel({ issueId, preview }: AssignExecutorPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, isPending]);

  if (!preview.assignable || preview.isReassignment || !preview.actorIsLead || !preview.domain) return null;

  const dialogTitle = `指派 ${preview.domain} 成員`;

  function closeDialog() {
    if (isPending) return;
    setOpen(false);
    setSelected("");
    setError(null);
    setErrorCode(null);
  }

  function submit() {
    if (!selected) return;
    setError(null);
    setErrorCode(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("executorUserId", selected);
    fd.set("reasonCode", "ASSIGN_EXECUTOR");
    startTransition(async () => {
      const result = await assignIssueExecutorAction(fd);
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSelected("");
          setError(null);
          setErrorCode(null);
          setOpen(true);
        }}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        指派成員
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-executor-title"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="assign-executor-title" className="text-base font-semibold text-gray-900">
              {dialogTitle}
            </h2>
            <p className="mt-1 text-xs text-gray-500">承接團隊：{preview.teamName}</p>

            <div className="mt-4">
              <label htmlFor="assign-executor" className="mb-1 block text-sm font-medium text-gray-700">
                執行人
              </label>
              <select
                id="assign-executor"
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setError(null);
                  setErrorCode(null);
                }}
                disabled={isPending}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">請選擇團隊成員</option>
                {preview.members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.userName}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3">
              <ActionErrorText message={error} code={errorCode} itemKey={issueId} />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={closeDialog}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isPending || !selected}
                onClick={submit}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPending ? "處理中…" : "確認指派"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
