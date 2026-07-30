"use client";

// RD/QA/OP 接單流程新增：CLAIM 關卡（已接單，待指派）的首次指派執行人面板。
//
// 只有承接團隊的 active Lead 會看到下拉選單＋按鈕；其餘人員（含同團隊一般成員）唯讀顯示
// 「等待 XX 團隊主管指派」或目前指派對象。

import { useState, useTransition } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { assignIssueExecutorAction } from "@/app/issues/[id]/hotfix/claim-actions";
import type { AssignableMembersPreview } from "@/lib/workflowExecutionService";

export interface AssignExecutorPanelProps {
  issueId: string;
  preview: AssignableMembersPreview;
}

export default function AssignExecutorPanel({ issueId, preview }: AssignExecutorPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(preview.currentExecutorUserId ?? "");

  if (!preview.assignable) {
    return null;
  }

  // WORK 關卡的重新指派已移至頁面右上角 Dialog，不得再於正文顯示表單。
  if (preview.isReassignment) {
    return null;
  }

  if (!preview.actorIsLead) {
    const readOnlyText = preview.currentExecutorName
      ? `目前指派：${preview.currentExecutorName}`
      : `已由 ${preview.teamName ?? "承接團隊"} 團隊承接，待指派`;
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">執行人指派</h2>
        <p className="mt-1 text-xs text-gray-500">{readOnlyText}</p>
      </section>
    );
  }

  function submit() {
    if (!selected) return;
    setError(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("executorUserId", selected);
    fd.set("reasonCode", "ASSIGN_EXECUTOR");
    startTransition(async () => {
      const result = await assignIssueExecutorAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">指派執行人</h2>
      <p className="mt-1 text-xs text-gray-500">承接團隊：{preview.teamName}</p>

      <ActionErrorText message={error} />

      <div className="mt-3 space-y-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">請選擇團隊成員</option>
          {preview.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.userName}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={isPending || !selected}
          onClick={submit}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {isPending ? "處理中…" : "確認指派"}
        </button>
      </div>
    </section>
  );
}
