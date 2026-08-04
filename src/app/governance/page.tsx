import { requireCurrentUser } from "@/lib/auth";
import { buildGovernanceDashboardViewModel } from "@/lib/governanceDashboardService";
import { GovernanceDashboardAccessDeniedError } from "@/lib/governance-dashboard/types";
import TopKpiRow from "@/components/governance-dashboard/TopKpiRow";
import HotfixBoard from "@/components/governance-dashboard/HotfixBoard";
import RcaCapaTracker from "@/components/governance-dashboard/RcaCapaTracker";
import IncidentStatusBoard from "@/components/governance-dashboard/IncidentStatusBoard";
import QuarterlyReleaseOverview from "@/components/governance-dashboard/QuarterlyReleaseOverview";

export const dynamic = "force-dynamic";

// 治理儀表板首頁：四區塊治理管理看板版型（治理儀表板第四輪）。Server Component 只呼叫
// buildGovernanceDashboardViewModel 取得 ViewModel，不直接 import Prisma、不自行計算
// 統計或篩選邏輯——所有邏輯集中在 src/lib/governance-dashboard/*。
//
// 注意：不因 0 筆資料就整頁 early return——KPI／四區塊架構必須永遠完整渲染，見各
// 元件內部的空狀態處理（小型說明，不佔大面積空白）。
export default async function GovernanceDashboardPage() {
  const actor = await requireCurrentUser();

  let viewModel;
  try {
    viewModel = await buildGovernanceDashboardViewModel(actor.id, {});
  } catch (err) {
    if (err instanceof GovernanceDashboardAccessDeniedError) {
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          {err.message}
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">治理儀表板</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          已啟動治理案件 {viewModel.kpi.totalVisible} 筆・已完成 {viewModel.kpi.completed} 筆・已取消 {viewModel.kpi.cancelled} 筆
        </p>
      </div>

      <TopKpiRow overview={viewModel.todayOverview} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <HotfixBoard board={viewModel.hotfixBoard} />
        </div>
        <RcaCapaTracker entries={viewModel.rcaEntries} />
        <IncidentStatusBoard entries={viewModel.incidentEntries} />
        <div className="lg:col-span-2">
          <QuarterlyReleaseOverview enabled={viewModel.quarterlyReleaseEnabled} />
        </div>
      </div>
    </div>
  );
}
