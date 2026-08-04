import { NINE_STAGES, nineStageLabelOfIndex } from "@/lib/hotfix-ui/nineStage";
import { resolveHotfixListAction } from "@/lib/hotfix-list/viewModel";
import type { IssueActionKind } from "@/lib/workflow-execution/responsibilityService";

export interface CurrentHotfixFlowView {
  currentIndex: number | null;
  currentStageLabel: string;
  teamName: string | null;
  cancelled: boolean;
  terminalComplete: boolean;
  /** 目前業務子狀態，直接沿用 responsibilityService 的唯一資格解析結果，依 Stage 動態變化。 */
  currentTodo: string;
  /** 目前等待哪個角色／團隊／執行人，同樣沿用既有 resolver，不自行以角色名稱判斷。 */
  waitingOn: string;
  /** 主管簽核關卡時的實際核准人姓名（沿用既有 buildApprovalReviewViewData 解析結果），
   *  非核准關卡或尚無法解析出單一人選時為 null，只顯示 waitingOn 角色文字，不捏造姓名。 */
  waitingOnName?: string | null;
  /** 目前登入者對這張工單的既有 actionability 結果；null 代表沒有 Workflow Runtime 可判斷。 */
  actionKind: IssueActionKind | null;
  /** 目前這一關送出／進入的時間；沒有可用資料時不顯示，不捏造。 */
  enteredAt?: string | null;
}

function nextStageLabel(view: CurrentHotfixFlowView): string {
  if (view.cancelled) return "流程已取消";
  if (view.terminalComplete || view.currentIndex === NINE_STAGES.length) return "流程已完成";
  if (view.currentIndex === null) return "待確認";
  return nineStageLabelOfIndex(view.currentIndex + 1);
}

const ACTION_BADGE_CLASS: Record<"pending-approval" | "pending-work" | "view", string> = {
  "pending-approval": "bg-action-pending-approval text-action-pending-approval-foreground",
  "pending-work": "bg-action-pending-work text-action-pending-work-foreground",
  view: "border border-action-view-border bg-action-view text-action-view-foreground",
};

export default function CurrentHotfixFlowCard({ view }: { view: CurrentHotfixFlowView }) {
  const terminal = view.cancelled || view.terminalComplete;
  const badge = view.actionKind
    ? resolveHotfixListAction({ actionKind: view.actionKind, actionHref: "#", detailHref: "#", terminal })
    : null;

  return (
    <section className="ui-card p-5 sm:p-6" aria-label="目前 Hotfix 流程">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-text-primary">目前 Hotfix 流程</h2>
        {badge && (
          <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${ACTION_BADGE_CLASS[badge.variant]}`}>
            {badge.label}
          </span>
        )}
      </div>
      <dl className="mt-4 grid gap-4 text-sm">
        <div>
          <dt className="text-xs font-medium text-text-muted">目前階段</dt>
          <dd className="mt-1 font-semibold text-primary">{view.currentStageLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">目前處理部門</dt>
          <dd className="mt-1 font-medium text-text-primary">{view.teamName || "尚待承接"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">目前待辦</dt>
          <dd className="mt-1 font-medium text-text-primary">{view.currentTodo}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">目前等待人員／執行人</dt>
          {view.waitingOnName ? (
            <dd className="mt-1">
              <div className="font-semibold text-text-primary">{view.waitingOnName}</div>
              <div className="mt-0.5 text-xs text-text-secondary">{view.waitingOn}</div>
            </dd>
          ) : (
            <dd className="mt-1 font-medium text-text-primary">{view.waitingOn}</dd>
          )}
        </div>
        {view.enteredAt && (
          <div>
            <dt className="text-xs font-medium text-text-muted">送出時間</dt>
            <dd className="mt-1 font-medium text-text-primary">{view.enteredAt}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium text-text-muted">下一關</dt>
          <dd className="mt-1 font-medium text-text-primary">{nextStageLabel(view)}</dd>
        </div>
      </dl>
    </section>
  );
}
