"use client";

// M2-B 新增：RETURN 動作面板——與一般 FORWARD 動作分開顯示，reasonCode 一律必填
// （服務層無論 WorkflowTransition.requireReason 設定為何皆強制要求，UI 對應寫死
// requireReason=true，不提供可跳過理由的路徑）。

import TransitionActionForm from "./TransitionActionForm";
import { returnIssueToStageAction } from "@/app/issues/[id]/workflow-execution-actions";

export interface ReturnTransitionItem {
  id: string;
  label: string;
  targetLabel: string;
  allowed: boolean;
  blockedReasons: string[];
}

export default function ReturnActionPanel({ issueId, transitions }: { issueId: string; transitions: ReturnTransitionItem[] }) {
  if (transitions.length === 0) return null;
  return (
    <div className="rounded-lg border border-warning-border bg-warning-bg p-4">
      <h3 className="text-sm font-semibold text-warning-text">退回（RETURN）</h3>
      <p className="mt-1 text-xs text-gray-500">退回必須填寫原因，且不會清除既有佐證、留言或核准歷程，全程留下紀錄。</p>
      <div className="mt-3 space-y-3">
        {transitions.map((t) => (
          <div key={t.id} className="rounded-md border border-warning-border bg-white p-3">
            <div className="text-sm text-gray-800">
              {t.label}
              <span className="ml-1 text-xs text-gray-400">（退回至：{t.targetLabel}）</span>
            </div>
            {!t.allowed && t.blockedReasons.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {t.blockedReasons.map((r, i) => (
                  <li key={i} className="text-xs text-gray-400">
                    ・{r}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2">
              <TransitionActionForm
                issueId={issueId}
                transitionId={t.id}
                requireReason
                submitLabel="退回"
                action={returnIssueToStageAction}
                disabled={!t.allowed}
                buttonClassName="rounded-md border border-warning-border bg-white px-3 py-1.5 text-xs font-medium text-warning-text hover:bg-gov-yellowbg disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
