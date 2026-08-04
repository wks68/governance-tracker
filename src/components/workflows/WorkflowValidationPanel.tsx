"use client";

import { useState, useTransition } from "react";
import { validateWorkflowVersionAction } from "@/app/admin/workflows/actions";
import type { WorkflowValidationIssue } from "@/lib/workflowService";
import { ActionErrorText } from "@/components/ActionResultBanner";

// M2-A3 新增：發布前驗證結果面板——顯示結構化問題清單（code／severity／entityType／
// message／suggestedAction），不得只顯示一段字串。
export default function WorkflowValidationPanel({ versionId }: { versionId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ valid: boolean; issues: WorkflowValidationIssue[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runValidation() {
    setError(null);
    const fd = new FormData();
    fd.set("versionId", versionId);
    startTransition(async () => {
      const res = await validateWorkflowVersionAction(fd);
      if (!res.ok) {
        setError(res.message);
        setResult(null);
        return;
      }
      setResult(res.data ?? null);
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">發布前驗證</h2>
        <button
          type="button"
          disabled={isPending}
          onClick={runValidation}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {isPending ? "驗證中…" : "執行驗證"}
        </button>
      </div>

      <ActionErrorText message={error} />

      {result && (
        <div className="mt-3">
          <p className={`text-xs font-medium ${result.valid ? "text-success-text" : "text-danger-text"}`}>
            {result.valid ? "✓ 驗證通過，可以發布" : `✗ 發現 ${result.issues.length} 項問題，尚不可發布`}
          </p>
          {result.issues.length > 0 && (
            <ul className="mt-2 space-y-2">
              {result.issues.map((issue, idx) => (
                <li key={idx} className="rounded-md border border-danger-border bg-danger-bg p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-danger-text">{issue.code}</span>
                    <span className="text-[10px] text-gray-500">
                      {issue.entityType}
                      {issue.entityId ? `（${issue.entityId}）` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-danger-text">{issue.message}</p>
                  <p className="mt-0.5 text-gray-600">建議：{issue.suggestedAction}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
