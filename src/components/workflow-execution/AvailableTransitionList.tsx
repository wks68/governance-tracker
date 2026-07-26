"use client";

// M2-B 新增：目前關卡可用的 FORWARD 動作清單（RETURN／CANCEL 各自有獨立面板，見
// ReturnActionPanel／CancelActionPanel，不混在同一份清單中，避免使用者誤觸）。
//
// `allowed`／`blockedReasons` 來自 getIssueWorkflowRuntime（服務層現場預覽），僅供 UI
// 顯示提示與決定是否 disable 按鈕；即使呼叫端繞過畫面直接送出，Server Action 呼叫的
// executeIssueTransition／completeIssueWorkflow 仍會現場重新驗證一次，UI 的判斷不構成
// 安全邊界。

import TransitionActionForm from "./TransitionActionForm";
import { executeIssueTransitionAction, completeIssueWorkflowAction } from "@/app/issues/[id]/workflow-execution-actions";

export interface AvailableTransitionItem {
  id: string;
  label: string;
  requireReason: boolean;
  targetLabel: string;
  targetIsCompleted: boolean;
  allowed: boolean;
  blockedReasons: string[];
}

export default function AvailableTransitionList({ issueId, transitions }: { issueId: string; transitions: AvailableTransitionItem[] }) {
  if (transitions.length === 0) {
    return <p className="text-xs text-gray-400">目前關卡沒有可執行的前進動作（可能是結束關卡，或尚無合法 FORWARD Transition）。</p>;
  }
  return (
    <div className="space-y-3">
      {transitions.map((t) => (
        <div key={t.id} className="rounded-md border border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-gray-800">{t.label}</div>
              <div className="text-xs text-gray-400">前往：{t.targetLabel}</div>
            </div>
            <TransitionActionForm
              issueId={issueId}
              transitionId={t.id}
              requireReason={t.requireReason}
              submitLabel={t.targetIsCompleted ? "結案" : "執行"}
              action={t.targetIsCompleted ? completeIssueWorkflowAction : executeIssueTransitionAction}
              disabled={!t.allowed}
            />
          </div>
          {!t.allowed && t.blockedReasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 border-t border-gray-100 pt-2">
              {t.blockedReasons.map((r, i) => (
                <li key={i} className="text-xs text-warning-text">
                  ・{r}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
