"use client";

// M2-B 新增：CANCEL 動作面板——與一般 FORWARD／RETURN 動作分開顯示，reasonCode 一律
// 必填，且要求二次確認文字（見 TransitionActionForm 的 confirmMessage），避免誤觸。
// CANCEL 不得等同刪除 Issue：執行後 Issue 仍完整存在，只是進入 terminalOutcome=CANCELLED
// 的結束關卡，且往後不得再執行一般 FORWARD（見服務層 currentStage 檢查）。

import TransitionActionForm from "./TransitionActionForm";
import { cancelIssueWorkflowAction } from "@/app/issues/[id]/workflow-execution-actions";

export interface CancelTransitionItem {
  id: string;
  label: string;
  allowed: boolean;
  blockedReasons: string[];
}

export default function CancelActionPanel({ issueId, transitions }: { issueId: string; transitions: CancelTransitionItem[] }) {
  if (transitions.length === 0) return null;
  return (
    <div className="rounded-lg border border-danger-border bg-danger-bg p-4">
      <h3 className="text-sm font-semibold text-danger-text">取消工單流程（CANCEL）</h3>
      <p className="mt-1 text-xs text-gray-500">取消後將無法再執行一般前進動作，且不等同刪除工單——所有既有資料、佐證與歷程仍完整保留。</p>
      <div className="mt-3 space-y-3">
        {transitions.map((t) => (
          <div key={t.id}>
            {!t.allowed && t.blockedReasons.length > 0 && (
              <ul className="mb-1 space-y-0.5">
                {t.blockedReasons.map((r, i) => (
                  <li key={i} className="text-xs text-gray-400">
                    ・{r}
                  </li>
                ))}
              </ul>
            )}
            <TransitionActionForm
              issueId={issueId}
              transitionId={t.id}
              requireReason
              submitLabel={t.label}
              confirmMessage="請再次確認：取消後無法復原為一般前進流程。"
              action={cancelIssueWorkflowAction}
              disabled={!t.allowed}
              buttonClassName="rounded-md border border-danger-border bg-white px-3 py-1.5 text-xs font-medium text-danger-text hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
