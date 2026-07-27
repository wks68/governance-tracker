import { requireCurrentUser } from "@/lib/auth";
import { buildGovernanceDashboardViewModel } from "@/lib/governanceDashboardService";
import { GovernanceDashboardAccessDeniedError } from "@/lib/governance-dashboard/types";
import GovernanceFilters from "@/components/governance-dashboard/GovernanceFilters";
import GovernanceKpiCards from "@/components/governance-dashboard/GovernanceKpiCards";
import WorkflowStageDistribution from "@/components/governance-dashboard/WorkflowStageDistribution";
import RiskOverview from "@/components/governance-dashboard/RiskOverview";
import BottleneckList from "@/components/governance-dashboard/BottleneckList";
import ReturnOverview from "@/components/governance-dashboard/ReturnOverview";
import TeamWorkloadTable from "@/components/governance-dashboard/TeamWorkloadTable";
import RecentExceptions from "@/components/governance-dashboard/RecentExceptions";
import EmptyDashboardState from "@/components/governance-dashboard/EmptyDashboardState";

export const dynamic = "force-dynamic";

// 治理儀表板 MVP 首頁（Plan 全文）。Server Component 只呼叫
// buildGovernanceDashboardViewModel 取得 ViewModel，不直接 import Prisma、不自行計算
// 統計或篩選邏輯——所有邏輯集中在 src/lib/governance-dashboard/*。
//
// 本輪（commit 2）先建立總覽卡片；下鑽清單見下一輪 commit（GovernanceIssueList）。
export default async function GovernanceDashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireCurrentUser();

  let viewModel;
  try {
    viewModel = await buildGovernanceDashboardViewModel(actor.id, searchParams);
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

  if (!viewModel.hasAnyVisibleIssue) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">治理儀表板</h1>
          <p className="mt-0.5 text-sm text-gray-500">流程進度、瓶頸、風險與責任落點總覽</p>
        </div>
        <EmptyDashboardState message="目前尚無任何可見案件，尚無資料可統計。" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">治理儀表板</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          流程進度、瓶頸、風險與責任落點總覽（可見範圍 {viewModel.kpi.totalVisible} 筆）
        </p>
      </div>

      <GovernanceFilters options={viewModel.filterOptions} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">KPI 總覽</h2>
        <GovernanceKpiCards kpi={viewModel.kpi} filters={viewModel.filters} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">目前階段分布</h2>
        <WorkflowStageDistribution entries={viewModel.stageDistribution} filters={viewModel.filters} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">風險監控</h2>
        <RiskOverview overview={viewModel.riskOverview} filters={viewModel.filters} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">流程瓶頸</h2>
        <BottleneckList bottleneck={viewModel.bottleneck} filters={viewModel.filters} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">RETURN 監控</h2>
        <ReturnOverview overview={viewModel.returnOverview} filters={viewModel.filters} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Team 負載</h2>
        <TeamWorkloadTable
          entries={viewModel.teamWorkload}
          filters={viewModel.filters}
          staleDaysThreshold={viewModel.kpi.staleDaysThreshold}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">最近異常</h2>
        <RecentExceptions exceptions={viewModel.recentExceptions} />
      </section>
    </div>
  );
}
