"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { publishWorkflowVersionAction } from "@/app/admin/workflows/actions";

// M2-A3 新增：發布面板——二次確認 + reasonCode 必填。發布後不可再修改（服務層
// assertDraftVersion 為最終防線）。發布前驗證未通過時，服務層會 fail closed 拒絕，
// 這裡只顯示錯誤訊息，請使用者回到「發布前驗證」面板查看詳細問題清單。
export default function PublishWorkflowPanel({ definitionId, versionId }: { definitionId: string; versionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("definitionId", definitionId);
    fd.set("versionId", versionId);
    startTransition(async () => {
      const result = await publishWorkflowVersionAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">發布此版本</h2>
      <p className="mt-1 text-xs text-gray-500">發布後 Stage／Transition／Requirement 皆不可再修改，如需異動請複製為新草稿版本。</p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
        >
          發布
        </button>
      ) : (
        <form onSubmit={onSubmit} className="mt-3 space-y-2">
          <ActionErrorText message={error} />
          <p className="text-xs font-medium text-danger-text">請再次確認：發布後不可修改此版本。</p>
          <ReasonCodeField disabled={isPending} label="發布原因（必填）" />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-danger-text px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "發布中…" : "確認發布"}
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
      )}
    </div>
  );
}
