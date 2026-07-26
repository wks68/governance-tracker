"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { setWorkflowDefinitionActiveAction } from "@/app/admin/workflows/actions";

// M2-A3 新增：Workflow 定義啟用／停用控制。停用後不得供新 Issue 選用，但不影響已綁定
// 既有 Version 的 Issue 繼續執行（M2-B 範圍）。
export default function WorkflowDefinitionActivePanel({ definitionId, isActive }: { definitionId: string; isActive: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("definitionId", definitionId);
    formData.set("nextActive", isActive ? "false" : "true");
    startTransition(async () => {
      const result = await setWorkflowDefinitionActiveAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div className="text-right">
        <ActionErrorText message={error} />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={
            "rounded-md border px-3 py-1.5 text-xs font-medium " +
            (isActive ? "border-danger-border text-danger-text hover:bg-danger-bg" : "border-success-border text-success-text hover:bg-success-bg")
          }
        >
          {isActive ? "停用此定義" : "重新啟用此定義"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-72 rounded-lg border border-gray-200 bg-gray-50 p-3 text-left">
      <ActionErrorText message={error} />
      <p className="mb-2 text-xs font-medium text-gray-700">{isActive ? "停用" : "重新啟用"}此定義：請填寫原因</p>
      <ReasonCodeField disabled={isPending} />
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          確定
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setConfirming(false)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
        >
          取消
        </button>
      </div>
    </form>
  );
}
