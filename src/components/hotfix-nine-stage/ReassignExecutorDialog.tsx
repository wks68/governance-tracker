"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText, ActionSuccessText } from "@/components/ActionResultBanner";
import { reassignIssueExecutorAction } from "@/app/issues/[id]/hotfix/claim-actions";
import type { AssignableMembersPreview } from "@/lib/workflowExecutionService";

export default function ReassignExecutorDialog({ issueId, preview }: { issueId: string; preview: AssignableMembersPreview }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, isPending]);

  if (!preview.assignable || !preview.isReassignment || !preview.actorIsLead) return null;

  const isCurrentExecutor = selected !== "" && selected === preview.currentExecutorUserId;
  const canSubmit = selected !== "" && !isCurrentExecutor && !isPending;

  function showDialog() {
    setSelected("");
    setError(null);
    setOpen(true);
  }

  function closeDialog() {
    if (isPending) return;
    setOpen(false);
    setSelected("");
    setError(null);
  }

  function submit() {
    if (!canSubmit) return;
    setError(null);
    const formData = new FormData();
    formData.set("issueId", issueId);
    formData.set("executorUserId", selected);

    startTransition(async () => {
      const result = await reassignIssueExecutorAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      setOpen(false);
      setSelected("");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-col items-end">
        <button
          type="button"
          onClick={showDialog}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          重新指派
        </button>
        <div className="mt-2 max-w-xs">
          <ActionSuccessText message={success} />
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reassign-executor-title"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="reassign-executor-title" className="text-base font-semibold text-gray-900">
              重新指派執行人
            </h2>

            <dl className="mt-4 grid gap-3 rounded-md bg-gray-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">承接團隊</dt>
                <dd className="font-medium text-gray-800">{preview.teamName ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">目前執行人</dt>
                <dd className="font-medium text-gray-800">{preview.currentExecutorName ?? "—"}</dd>
              </div>
            </dl>

            <ActionErrorText message={error} />

            <div className="mt-4">
              <label htmlFor="new-executor" className="mb-1 block text-sm font-medium text-gray-700">
                新執行人
              </label>
              <select
                id="new-executor"
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setError(null);
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
              {isCurrentExecutor && <p className="mt-1.5 text-xs text-gray-500">已是目前執行人</p>}
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
                disabled={!canSubmit}
                onClick={submit}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPending ? "處理中…" : "確認重新指派"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
