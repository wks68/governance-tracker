// Hotfix 九階段 UI：9 個頁面共用外殼——標題、9 階段進度列、工單基本資訊，皆置於頁面最上方。
// 企業風格：白／淺灰背景、白卡片、細灰框、微圓角，無大面積彩色警示卡、無 AI 輔助區塊。

import NineStageProgressBar from "./NineStageProgressBar";
import TicketBasicInfo, { type TicketBasicInfoData } from "./TicketBasicInfo";

export default function HotfixStageShell({
  title,
  subtitle,
  nineStageIndex,
  cancelled,
  ticketBasicInfo,
  backHref,
  children,
}: {
  title: string;
  subtitle?: string;
  nineStageIndex: number | null;
  cancelled: boolean;
  ticketBasicInfo: TicketBasicInfoData;
  backHref: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div>
        <a href={backHref} className="text-xs text-gray-400 hover:text-primary hover:underline">
          ← 回工單詳情
        </a>
        <h1 className="mt-1 text-xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <NineStageProgressBar currentIndex={nineStageIndex} cancelled={cancelled} />
      </div>

      <TicketBasicInfo data={ticketBasicInfo} />

      {children}
    </div>
  );
}
