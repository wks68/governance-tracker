// Hotfix 九階段 UI：9 個頁面共用外殼——標題、9 階段進度列、工單基本資訊，皆置於頁面最上方。
// 企業風格：白／淺灰背景、白卡片、細灰框、微圓角，無大面積彩色警示卡、無 AI 輔助區塊。

import NineStageProgressBar from "./NineStageProgressBar";
import Link from "next/link";
import { hotfixStageSubtitle, nineStageLabelOfIndex } from "@/lib/hotfix-ui/nineStage";
import TicketBasicInfo, { type TicketBasicInfoData } from "./TicketBasicInfo";
import HotfixHeaderActions from "./HotfixHeaderActions";
import type { HotfixPageContext } from "@/lib/hotfix-ui/pageContext";
import CumulativeWorkflowContext from "./CumulativeWorkflowContext";
import GovernanceRelationsCard from "@/components/issue-relations/GovernanceRelationsCard";
import { loadGovernanceRelationViewForActor } from "@/lib/issue-relations/viewService";
import WorkflowZLayout from "@/components/workflow-execution/WorkflowZLayout";
import CurrentHotfixFlowCard from "./CurrentHotfixFlowCard";
import { loadCancelledFromNineStageIndex } from "@/lib/hotfix-ui/pageContext";
import type { GovernanceRelationView } from "@/lib/issue-relations/viewService";
import { evaluateCurrentActorTask } from "@/lib/workflow-execution/responsibilityService";
import { buildApprovalReviewViewData } from "@/lib/hotfix-ui/pageContext";
import { canActorEditHotfixDraft } from "@/lib/hotfix-ui/draftService";
import AppPageBreadcrumb from "@/components/app-shell/AppPageBreadcrumb";
import { formatDateTime } from "@/lib/datetime";

export default async function HotfixStageShell({
  subtitle,
  nineStageIndex,
  cancelled,
  ticketBasicInfo,
  ctx,
  legacyView,
  relationViewOverride,
  headerActions,
  main,
  side,
  approval,
  attachments,
  children,
}: {
  title: string;
  subtitle?: string;
  nineStageIndex: number | null;
  cancelled: boolean;
  ticketBasicInfo: TicketBasicInfoData;
  backHref: string;
  /** 提供時會在標題下方顯示取消／刪除／Admin 改派等動作列，不提供則不顯示（唯讀情境）。 */
  ctx?: HotfixPageContext;
  /** 沒有正式 runtime 的 Hotfix 僅提供唯讀資料；不據此產生任何 Workflow 操作。 */
  legacyView?: {
    issueId: string;
    currentStageLabel: string;
    teamName: string | null;
    cancelledAtIndex: number | null;
    terminalComplete: boolean;
  };
  /** 舊制 Hotfix summary 沒有 pageContext，仍可沿用同一張關聯治理卡。 */
  relationViewOverride?: GovernanceRelationView | null;
  /** 當前頁面專屬的次要操作，與共用操作一起置於頁面右上角。 */
  headerActions?: React.ReactNode;
  /** 主要送簽／執行內容快照，固定全寬呈現。未提供時沿用 children，便於既有頁面漸進收斂。 */
  main?: React.ReactNode;
  /** 舊制右欄內容；提供 approval／attachments 的頁面不應再使用，僅供尚未遷移的頁面相容。 */
  side?: React.ReactNode;
  /** 主管簽核：獨立全寬區塊，固定位於治理關聯之後、附件之前。 */
  approval?: React.ReactNode;
  /** 附件：獨立全寬區塊，固定位於主管簽核之後、簽核紀錄歷程之前。 */
  attachments?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const task = ctx ? await evaluateCurrentActorTask(ctx.issue.id, ctx.actor.id) : null;
  const approvalReview = ctx ? await buildApprovalReviewViewData(ctx) : null;
  const canHandleCurrentStage = ctx
    ? ctx.runtime.currentStage.stageKey === "draft"
      ? await canActorEditHotfixDraft(ctx.issue.id, ctx.actor.id)
      : task?.action !== "VIEW_ONLY"
    : false;
  const resolvedSubtitle = canHandleCurrentStage
    ? hotfixStageSubtitle(ctx!.runtime.currentStage.stageKey) ?? subtitle
    : "您不屬於本單流程處理團隊，本頁僅提供簽核進度及相關紀錄查閱。";
  const relationView = relationViewOverride ?? (ctx
    ? await loadGovernanceRelationViewForActor(ctx.actor.id, ctx.issue.id)
    : null);
  const cancelledAtIndex = ctx?.cancelled
    ? await loadCancelledFromNineStageIndex(ctx.issue.id)
    : legacyView?.cancelledAtIndex ?? null;
  const terminalComplete = legacyView?.terminalComplete ?? Boolean(ctx && !ctx.cancelled && ctx.runtime.currentStage.stageKey === "closed");
  const currentStageLabel = ctx
    ? ctx.nineStageIndex === null
      ? ctx.runtime.currentStage.label
      : nineStageLabelOfIndex(ctx.nineStageIndex)
    : legacyView?.currentStageLabel ?? "待確認";
  const cumulativeContext = ctx
    ? <CumulativeWorkflowContext ctx={ctx} />
    : legacyView
      ? <CumulativeWorkflowContext legacyIssueId={legacyView.issueId} />
      : null;
  const currentTodo = task?.businessStatusLabel ?? (cancelled ? "已取消" : terminalComplete ? "已結案" : "—");
  const waitingOn = task?.waitingRoleLabel ?? "—";
  // 主管簽核關卡的 waitingOn 只有角色名稱（例如「申請人直屬主管」），實際核准人姓名沿用既有
  // buildApprovalReviewViewData 已解析出的 expectedApproverLabel（僅在有待核准紀錄時非
  // null，等同已在該關卡），不在此另行判斷。
  const waitingOnName = approvalReview?.expectedApproverLabel ?? null;
  const enteredAt = ctx?.runtime.pendingApproval?.requestedAt ? formatDateTime(ctx.runtime.pendingApproval.requestedAt) : null;

  return (
    <div className="hotfix-shell mx-auto max-w-[100rem] space-y-4 pb-20 sm:space-y-5 xl:space-y-6">
      <AppPageBreadcrumb label={`工作管理／Hotfix（${ticketBasicInfo.issueKey}）`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/work-management" className="text-sm font-medium text-text-secondary hover:text-primary hover:underline">
            ← 回工作管理
          </Link>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-text-primary sm:text-2xl">Hotfix（{ticketBasicInfo.issueKey}）簽核流程狀態</h1>
          {resolvedSubtitle && <p className="mt-2 max-w-4xl text-sm leading-6 text-text-secondary">{resolvedSubtitle}</p>}
        </div>
        {(headerActions || ctx) && (
          <div className="flex flex-wrap items-start justify-end gap-2">
            {headerActions}
            {ctx && <HotfixHeaderActions ctx={ctx} />}
          </div>
        )}
      </div>

      <div data-hotfix-scroll-section className="ui-card scroll-mt-24 p-4 sm:p-5">
        <NineStageProgressBar
          issueId={ctx?.issue.id ?? legacyView?.issueId ?? ticketBasicInfo.issueKey}
          currentIndex={nineStageIndex}
          cancelled={cancelled}
          cancelledAtIndex={cancelledAtIndex}
          terminalComplete={terminalComplete}
        />
      </div>

      <WorkflowZLayout
        topLeft={<TicketBasicInfo data={ticketBasicInfo} />}
        topRight={<CurrentHotfixFlowCard view={{
          currentIndex: nineStageIndex,
          currentStageLabel,
          teamName: ctx?.ticketBasicInfo.teamName ?? legacyView?.teamName ?? null,
          cancelled,
          terminalComplete,
          currentTodo,
          waitingOn,
          waitingOnName,
          actionKind: task?.action ?? null,
          enteredAt,
        }} />}
        contentLeft={main ?? children}
        contentRight={approval || attachments ? undefined : side}
        governance={relationView && <GovernanceRelationsCard view={relationView} presentation="hotfix-flow" hotfixCurrentStageLabel={currentStageLabel} />}
        approval={approval}
        attachments={attachments}
        after={cumulativeContext}
      />
    </div>
  );
}
