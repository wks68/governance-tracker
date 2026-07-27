// Hotfix 操作畫面收斂新增：前進／退回／取消動作，改用實際工作語意文案（需求三），並依
// 「目前責任角色」決定要不要顯示動作按鈕（需求五：非目前責任角色只能唯讀）。
//
// `allowed`／`blockedReasons` 與實際執行仍完全沿用既有 workflow-execution 服務
// （TransitionActionForm → executeIssueTransitionAction／returnIssueToStageAction／
// cancelIssueWorkflowAction → workflowExecutionService），本檔案只負責：
//   1. 用 transitionCopy 取代 actionKey 對應的技術詞彙（FORWARD／RETURN／CANCEL 不出現）。
//   2. 非目前責任角色（isResponsible=false）時完全不顯示動作按鈕，只顯示唯讀說明。
// 不可執行的按鈕不只是前端隱藏——Server Action 呼叫的服務層一律重新驗證資格。

import TransitionActionForm from "@/components/workflow-execution/TransitionActionForm";
import { executeIssueTransitionAction, completeIssueWorkflowAction, returnIssueToStageAction, cancelIssueWorkflowAction } from "@/app/issues/[id]/workflow-execution-actions";
import { transitionCopyOf } from "@/lib/hotfix-ui/transitionCopy";

export interface ActionTransitionItem {
  id: string;
  actionKey: string;
  label: string;
  requireReason: boolean;
  targetLabel: string;
  targetIsCompleted: boolean;
  allowed: boolean;
  blockedReasons: string[];
}

function ForwardActions({ issueId, transitions, isResponsible }: { issueId: string; transitions: ActionTransitionItem[]; isResponsible: boolean }) {
  if (transitions.length === 0) return <p className="text-xs text-gray-400">目前階段沒有可執行的下一步（可能是結束階段）。</p>;
  return (
    <div className="space-y-3">
      {transitions.map((t) => {
        const copy = transitionCopyOf(t.actionKey, t.label);
        return (
          <div key={t.id} className="rounded-md border border-gray-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-gray-800">{copy.label}</div>
                <div className="text-xs text-gray-400">完成後送往：{t.targetLabel}</div>
              </div>
              {isResponsible ? (
                <TransitionActionForm
                  issueId={issueId}
                  transitionId={t.id}
                  requireReason={t.requireReason}
                  submitLabel={t.targetIsCompleted ? "確認完成並結案" : copy.label}
                  action={t.targetIsCompleted ? completeIssueWorkflowAction : executeIssueTransitionAction}
                  disabled={!t.allowed}
                />
              ) : (
                <span className="text-xs text-gray-400">僅目前責任角色可操作</span>
              )}
            </div>
            {isResponsible && !t.allowed && t.blockedReasons.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t border-gray-100 pt-2">
                {t.blockedReasons.map((r, i) => (
                  <li key={i} className="text-xs text-warning-text">
                    ・{r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReturnActions({ issueId, transitions, isResponsible }: { issueId: string; transitions: ActionTransitionItem[]; isResponsible: boolean }) {
  if (transitions.length === 0) return null;
  return (
    <div className="rounded-lg border border-warning-border bg-warning-bg p-4">
      <h3 className="text-sm font-semibold text-warning-text">退回重作</h3>
      <p className="mt-1 text-xs text-gray-500">退回必須填寫原因，且不會清除既有佐證、留言或核准歷程，全程留下紀錄。</p>
      <div className="mt-3 space-y-3">
        {transitions.map((t) => {
          const copy = transitionCopyOf(t.actionKey, t.label);
          return (
            <div key={t.id} className="rounded-md border border-warning-border bg-white p-3">
              <div className="text-sm text-gray-800">
                {copy.label}
                <span className="ml-1 text-xs text-gray-400">（退回至：{t.targetLabel}）</span>
              </div>
              {!isResponsible ? (
                <p className="mt-1 text-xs text-gray-400">僅目前責任角色可操作，此區塊唯讀。</p>
              ) : (
                <>
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
                      submitLabel={copy.label}
                      action={returnIssueToStageAction}
                      disabled={!t.allowed}
                      buttonClassName="rounded-md border border-warning-border bg-white px-3 py-1.5 text-xs font-medium text-warning-text hover:bg-gov-yellowbg disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CancelActions({ issueId, transitions, isResponsible }: { issueId: string; transitions: ActionTransitionItem[]; isResponsible: boolean }) {
  if (transitions.length === 0) return null;
  return (
    <div className="rounded-lg border border-danger-border bg-danger-bg p-4">
      <h3 className="text-sm font-semibold text-danger-text">取消 Hotfix</h3>
      <p className="mt-1 text-xs text-gray-500">取消後將無法再執行一般前進動作，且不等同刪除工單——所有既有資料、佐證與歷程仍完整保留。</p>
      {!isResponsible ? (
        <p className="mt-2 text-xs text-gray-400">僅目前責任角色可操作，此區塊唯讀。</p>
      ) : (
        <div className="mt-3 space-y-3">
          {transitions.map((t) => {
            const copy = transitionCopyOf(t.actionKey, t.label);
            return (
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
                  submitLabel={copy.label}
                  confirmMessage="請再次確認：取消後無法復原為一般前進流程。"
                  action={cancelIssueWorkflowAction}
                  disabled={!t.allowed}
                  buttonClassName="rounded-md border border-danger-border bg-white px-3 py-1.5 text-xs font-medium text-danger-text hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-40"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HotfixActionPanels({
  issueId,
  forward,
  ret,
  cancel,
  isResponsible,
}: {
  issueId: string;
  forward: ActionTransitionItem[];
  ret: ActionTransitionItem[];
  cancel: ActionTransitionItem[];
  isResponsible: boolean;
}) {
  return (
    <div className="space-y-4">
      <ForwardActions issueId={issueId} transitions={forward} isResponsible={isResponsible} />
      <ReturnActions issueId={issueId} transitions={ret} isResponsible={isResponsible} />
      <CancelActions issueId={issueId} transitions={cancel} isResponsible={isResponsible} />
    </div>
  );
}
