"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { workflowVersionStatusLabel } from "./WorkflowDefinitionTable";
import { createDraftVersionAction, cloneVersionToDraftAction, archiveVersionAction } from "@/app/admin/workflows/actions";
import { formatDateTime } from "@/lib/datetime";

export interface WorkflowVersionRow {
  id: string;
  versionNo: number;
  status: string;
  publishedAt: string | null;
  archivedAt: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "border-warning-border bg-warning-bg text-warning-text",
  PUBLISHED: "border-success-border bg-success-bg text-success-text",
  ARCHIVED: "border-secondary-border bg-gray-100 text-gray-500",
};

// M2-A3 新增：版本清單（表格式，不建立拖拉圖形編輯器）。Draft 建立／Clone／封存皆在此
// 頁面內完成，Server Action 只呼叫 workflowService，本元件不直接使用 Prisma。
export default function WorkflowVersionList({
  definitionId,
  versions,
  canManageDraft,
  canArchive,
}: {
  definitionId: string;
  versions: WorkflowVersionRow[];
  canManageDraft: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<{ type: "clone" | "archive"; versionId: string } | null>(null);

  function createDraft() {
    setError(null);
    const fd = new FormData();
    fd.set("definitionId", definitionId);
    fd.set("reasonCode", "建立新草稿版本");
    startTransition(async () => {
      const result = await createDraftVersionAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.data?.id) router.push(`/admin/workflows/${definitionId}/versions/${result.data.id}`);
      else router.refresh();
    });
  }

  function onReasonFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pendingAction) return;
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("definitionId", definitionId);
    if (pendingAction.type === "clone") {
      formData.set("sourceVersionId", pendingAction.versionId);
      startTransition(async () => {
        const result = await cloneVersionToDraftAction(formData);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setPendingAction(null);
        if (result.data?.id) router.push(`/admin/workflows/${definitionId}/versions/${result.data.id}`);
        else router.refresh();
      });
    } else {
      formData.set("versionId", pendingAction.versionId);
      startTransition(async () => {
        const result = await archiveVersionAction(formData);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setPendingAction(null);
        router.refresh();
      });
    }
  }

  return (
    <div className="space-y-3">
      <ActionErrorText message={error} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">版本</h2>
        {canManageDraft && (
          <button
            type="button"
            disabled={isPending}
            onClick={createDraft}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            ＋ 建立新草稿版本
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium text-gray-500">
              <th className="px-3 py-2">版本</th>
              <th className="px-3 py-2">狀態</th>
              <th className="px-3 py-2">發布時間</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {versions.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">
                  <Link href={`/admin/workflows/${definitionId}/versions/${v.id}`} className="hover:text-primary hover:underline">
                    v{v.versionNo}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[v.status] ?? ""}`}>{workflowVersionStatusLabel(v.status)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDateTime(v.publishedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {canManageDraft && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setError(null);
                        setPendingAction({ type: "clone", versionId: v.id });
                      }}
                      className="mr-2 text-primary hover:underline disabled:opacity-50"
                    >
                      複製為新草稿
                    </button>
                  )}
                  {canArchive && v.status !== "ARCHIVED" && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setError(null);
                        setPendingAction({ type: "archive", versionId: v.id });
                      }}
                      className="text-danger-text hover:underline disabled:opacity-50"
                    >
                      封存
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pendingAction && (
        <form onSubmit={onReasonFormSubmit} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-700">{pendingAction.type === "clone" ? "複製為新草稿" : "封存此版本"}：請填寫原因</p>
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
              onClick={() => setPendingAction(null)}
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
