"use client";

// M2-B 新增：既有（舊模型）Issue 的管理者明確啟動流程面板（Plan 第十節：不得批次自動
// 綁定既有 Issue，必須管理者明確操作＋清楚 AuditLog）。只在：(1) 此 Issue 尚未啟動
// 任何版本化 Workflow，且 (2) 此 issueType 已有可供選用的 Published 版本，且
// (3) 目前使用者具備 admin.full 能力（由 Server Component 現場查詢後決定是否渲染本
// 元件；本元件本身不做能力判斷，實際授權仍一律由 startIssueWorkflow 服務層現場重新解析）
// 時才會被渲染。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { startIssueWorkflowAction } from "@/app/issues/[id]/workflow-execution-actions";

export interface SelectableVersionOption {
  id: string;
  versionNo: number;
  definitionName: string;
}

export default function StartWorkflowPanel({ issueId, options }: { issueId: string; options: SelectableVersionOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versionId, setVersionId] = useState(options[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (options.length === 0) return null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("issueId", issueId);
    fd.set("workflowVersionId", versionId);
    startTransition(async () => {
      const result = await startIssueWorkflowAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-50">
        啟動新版 Workflow 執行引擎
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-md border border-primary bg-primary-50 p-3">
      <ActionErrorText message={error} />
      <p className="text-xs text-gray-600">此工單將固定綁定所選版本，啟動後不隨日後新版本發布改變，且不可重複啟動或更換版本。</p>
      <select
        value={versionId}
        onChange={(e) => setVersionId(e.target.value)}
        disabled={isPending}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.definitionName}（v{o.versionNo}）
          </option>
        ))}
      </select>
      <ReasonCodeField disabled={isPending} name="reasonCode" label="啟動原因（必填）" />
      <div className="flex gap-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50">
          {isPending ? "啟動中…" : "確認啟動"}
        </button>
        <button type="button" disabled={isPending} onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
          取消
        </button>
      </div>
    </form>
  );
}
