// Hotfix 九階段 UI：9 個頁面共用外殼——標題、9 階段進度列、工單基本資訊，皆置於頁面最上方。
// 企業風格：白／淺灰背景、白卡片、細灰框、微圓角，無大面積彩色警示卡、無 AI 輔助區塊。

import NineStageProgressBar from "./NineStageProgressBar";
import Link from "next/link";
import { hotfixStageSubtitle } from "@/lib/hotfix-ui/nineStage";
import TicketBasicInfo, { type TicketBasicInfoData } from "./TicketBasicInfo";
import HotfixHeaderActions from "./HotfixHeaderActions";
import type { HotfixPageContext } from "@/lib/hotfix-ui/pageContext";
import CumulativeWorkflowContext from "./CumulativeWorkflowContext";
import GovernanceRelationsCard from "@/components/issue-relations/GovernanceRelationsCard";
import { loadGovernanceRelationViewForActor } from "@/lib/issue-relations/viewService";
import WorkflowZLayout from "@/components/workflow-execution/WorkflowZLayout";
import CurrentResponsibilityCard, { type LegacyHotfixResponsibilityView } from "./CurrentResponsibilityCard";
import CurrentStageGuidanceCard, { type LegacyHotfixGuidanceView } from "./CurrentStageGuidanceCard";
import { loadCancelledFromNineStageIndex } from "@/lib/hotfix-ui/pageContext";
import type { GovernanceRelationView } from "@/lib/issue-relations/viewService";

export default async function HotfixStageShell({
  title,
  subtitle,
  nineStageIndex,
  cancelled,
  ticketBasicInfo,
  backHref,
  ctx,
  legacyView,
  relationViewOverride,
  headerActions,
  main,
  side,
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
    responsibility: LegacyHotfixResponsibilityView;
    guidance: LegacyHotfixGuidanceView;
    cancelledAtIndex: number | null;
    terminalComplete: boolean;
  };
  /** 舊制 Hotfix summary 沒有 pageContext，仍可沿用同一張關聯治理卡。 */
  relationViewOverride?: GovernanceRelationView | null;
  /** 當前頁面專屬的次要操作，與共用操作一起置於頁面右上角。 */
  headerActions?: React.ReactNode;
  /** 左下：目前關卡的主要工作或唯讀快照。未提供時沿用 children，便於既有頁面漸進收斂。 */
  main?: React.ReactNode;
  /** 右下：附件、佐證與本階段行動。 */
  side?: React.ReactNode;
  children?: React.ReactNode;
}) {
  // 副標題一律以「目前 Workflow 關卡」為準（見 nineStage.hotfixStageSubtitle）；
  // 頁面傳入的 subtitle 只在該關卡沒有對應說明時作為 fallback，不得覆蓋流程狀態。
  const resolvedSubtitle = (ctx ? hotfixStageSubtitle(ctx.runtime.currentStage.stageKey) : null) ?? subtitle;
  const listHref = backHref.startsWith("/issues?") ? backHref : "/issues";
  const relationView = relationViewOverride ?? (ctx
    ? await loadGovernanceRelationViewForActor(ctx.actor.id, ctx.issue.id)
    : null);
  const cancelledAtIndex = ctx?.cancelled
    ? await loadCancelledFromNineStageIndex(ctx.issue.id)
    : legacyView?.cancelledAtIndex ?? null;
  const terminalComplete = legacyView?.terminalComplete ?? Boolean(ctx && !ctx.cancelled && ctx.runtime.currentStage.stageKey === "closed");
  const cumulativeContext = ctx
    ? <CumulativeWorkflowContext ctx={ctx} />
    : legacyView
      ? <CumulativeWorkflowContext legacyIssueId={legacyView.issueId} />
      : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={listHref} className="text-xs text-gray-500 hover:text-primary hover:underline">
            ← 工單清單
          </Link>
          <h1 className="mt-1 text-xl font-bold text-gray-900">{title}</h1>
          {resolvedSubtitle && <p className="mt-0.5 text-sm text-gray-500">{resolvedSubtitle}</p>}
        </div>
        {(headerActions || ctx) && (
          <div className="flex flex-wrap items-start justify-end gap-2">
            {headerActions}
            {ctx && <HotfixHeaderActions ctx={ctx} />}
          </div>
        )}
      </div>

      <div className="ui-card p-4">
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
        topRight={ctx ? <CurrentResponsibilityCard ctx={ctx} /> : <CurrentResponsibilityCard legacyView={legacyView?.responsibility} />}
        middleRight={ctx ? <CurrentStageGuidanceCard ctx={ctx} /> : <CurrentStageGuidanceCard legacyView={legacyView?.guidance} />}
        bottomLeft={main ?? children}
        bottomRight={side}
        after={<div className="space-y-5">
          {relationView && <GovernanceRelationsCard view={relationView} />}
          {cumulativeContext}
        </div>}
      />
    </div>
  );
}
