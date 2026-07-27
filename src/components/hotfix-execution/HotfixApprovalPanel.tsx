"use client";

// Hotfix 操作畫面收斂新增：主管核准／退回面板（需求五）。先前完全沒有 UI 入口呼叫
// approvalService.decideApprovalRecord——只有 verify script 直接呼叫服務層。
//
// 執行人不得自行選擇「主管核准結果」：只有目前關卡的責任角色（isResponsible，由
// evaluateActorEligibilityForStage 現場判斷，服務層 decideApprovalRecord 本身也會在
// transaction 內重新解析核准資格，這裡的 isResponsible 只決定要不要顯示按鈕）才看得到
// 核准／駁回按鈕；其餘角色（含執行人）只看到目前核准狀態的唯讀摘要。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { decideApprovalRecordAction } from "@/app/issues/[id]/workflow-execution-actions";

export interface PendingApprovalInfo {
  approvalRecordId: string;
  requestedByName: string;
  requestedAt: string;
}

export default function HotfixApprovalPanel({
  issueId,
  roleLabel,
  approval,
  isResponsible,
}: {
  issueId: string;
  roleLabel: string;
  approval: PendingApprovalInfo;
  isResponsible: boolean;
}) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(fd: FormData, decision: "APPROVED" | "REJECTED") {
    setError(null);
    fd.set("issueId", issueId);
    fd.set("approvalRecordId", approval.approvalRecordId);
    fd.set("decision", decision);
    startTransition(async () => {
      const result = await decideApprovalRecordAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRejectOpen(false);
      router.refresh();
    });
  }

  return (
    <div id="approval-section" className="rounded-lg border border-gov-blue/30 bg-gov-bluebg/40 p-4">
      <h3 className="text-sm font-semibold text-gray-800">{roleLabel}核准</h3>
      <p className="mt-1 text-xs text-gray-500">
        由 {approval.requestedByName} 於 {new Date(approval.requestedAt).toLocaleString("zh-TW")} 送出，等待{roleLabel}核准。
      </p>

      {!isResponsible ? (
        <p className="mt-3 text-xs text-gray-400">僅目前責任角色（{roleLabel}）可核准或退回，此區塊唯讀。</p>
      ) : (
        <div className="mt-3 space-y-2">
          <ActionErrorText message={error} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(new FormData(e.currentTarget), "APPROVED");
            }}
            className="space-y-2"
          >
            <div>
              <label className="text-xs text-gray-500">核准意見（選填）</label>
              <textarea
                name="decisionComment"
                disabled={isPending}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
                placeholder="填寫核准意見，供後續稽核與歷程參考"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
              >
                {isPending ? "處理中…" : "核准"}
              </button>
              {!rejectOpen && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setRejectOpen(true)}
                  className="rounded-md border border-warning-border bg-white px-3 py-1.5 text-sm font-medium text-warning-text hover:bg-gov-yellowbg disabled:opacity-40"
                >
                  退回修正
                </button>
              )}
            </div>
          </form>
          {rejectOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(new FormData(e.currentTarget), "REJECTED");
              }}
              className="space-y-2 rounded-md border border-warning-border bg-white p-3"
            >
              <ReasonCodeField disabled={isPending} name="decisionReasonCode" label="退回原因（必填）" />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-warning-text px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  {isPending ? "處理中…" : "確認退回"}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setRejectOpen(false)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
                >
                  取消
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
