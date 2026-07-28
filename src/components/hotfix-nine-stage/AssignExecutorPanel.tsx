"use client";

// RD/QA/OP 接單流程新增：CLAIM 關卡（已接單，待指派）的指派執行人面板，以及 WORK 關卡內
// 承接團隊 Lead 於執行人正式送出前重新指派的面板。
//
// 只有承接團隊的 active Lead 會看到下拉選單＋按鈕；其餘人員（含同團隊一般成員）唯讀顯示
// 「等待 XX 團隊主管指派」或目前指派對象。

import { useState, useTransition } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { assignIssueExecutorAction, reassignIssueExecutorAction } from "@/app/issues/[id]/hotfix/claim-actions";
import type { AssignableMembersPreview } from "@/lib/workflowExecutionService";

export interface AssignExecutorPanelProps {
  issueId: string;
  preview: AssignableMembersPreview;
}

export default function AssignExecutorPanel({ issueId, preview }: AssignExecutorPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(preview.currentExecutorUserId ?? "");
  const [reason, setReason] = useState("");

  if (!preview.assignable) {
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

  const needsReasonForReassign = preview.isReassignment && selected !== preview.currentExecutorUserId;

  function submit() {
    if (!selected) return;
    setError(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("executorUserId", selected);
    if (preview.isReassignment) {
      fd.set("reasonCode", reason.trim());
    } else {
      fd.set("reasonCode", "ASSIGN_EXECUTOR");
    }
    startTransition(async () => {
      const result = preview.isReassignment ? await reassignIssueExecutorAction(fd) : await assignIssueExecutorAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">{preview.isReassignment ? "重新指派執行人" : "指派執行人"}</h2>
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

        {needsReasonForReassign && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            disabled={isPending}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
            placeholder="重新指派原因（必填）"
          />
        )}

        <button
          type="button"
          disabled={isPending || !selected || (needsReasonForReassign && !reason.trim())}
          onClick={submit}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {isPending ? "處理中…" : preview.isReassignment ? "確認重新指派" : "確認指派"}
        </button>
      </div>
    </section>
  );
}
