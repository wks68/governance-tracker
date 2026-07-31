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

export default async function HotfixStageShell({
  title,
  subtitle,
  nineStageIndex,
  cancelled,
  ticketBasicInfo,
  backHref,
  ctx,
  headerActions,
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
  /** 當前頁面專屬的次要操作，與共用操作一起置於頁面右上角。 */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  // 副標題一律以「目前 Workflow 關卡」為準（見 nineStage.hotfixStageSubtitle）；
  // 頁面傳入的 subtitle 只在該關卡沒有對應說明時作為 fallback，不得覆蓋流程狀態。
  const resolvedSubtitle = (ctx ? hotfixStageSubtitle(ctx.runtime.currentStage.stageKey) : null) ?? subtitle;
  const listHref = backHref.startsWith("/issues?") ? backHref : "/issues";
  const relationView = ctx
    ? await loadGovernanceRelationViewForActor(ctx.actor.id, ctx.issue.id)
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
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

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <NineStageProgressBar currentIndex={nineStageIndex} cancelled={cancelled} />
      </div>

      <TicketBasicInfo data={ticketBasicInfo} />

      {relationView && <GovernanceRelationsCard view={relationView} />}

      {ctx && <CumulativeWorkflowContext ctx={ctx} />}

      {children}
    </div>
  );
}
