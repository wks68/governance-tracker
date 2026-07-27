import { requireCurrentUser } from "@/lib/auth";
import { buildGovernanceDashboardViewModel } from "@/lib/governanceDashboardService";
import { GovernanceDashboardAccessDeniedError } from "@/lib/governance-dashboard/types";
import GovernanceFilters from "@/components/governance-dashboard/GovernanceFilters";
import TodayOverviewKpis from "@/components/governance-dashboard/TodayOverviewKpis";
import PhaseBottleneck from "@/components/governance-dashboard/PhaseBottleneck";
import ActionNeededList from "@/components/governance-dashboard/ActionNeededList";
import BottleneckList from "@/components/governance-dashboard/BottleneckList";
import RiskOverview from "@/components/governance-dashboard/RiskOverview";
import ReturnOverview from "@/components/governance-dashboard/ReturnOverview";
import TeamWorkloadTable from "@/components/governance-dashboard/TeamWorkloadTable";
import GovernanceIssueList from "@/components/governance-dashboard/GovernanceIssueList";

export const dynamic = "force-dynamic";

// 治理儀表板首頁。Server Component 只呼叫 buildGovernanceDashboardViewModel 取得
// ViewModel，不直接 import Prisma、不自行計算統計或篩選邏輯——所有邏輯集中在
// src/lib/governance-dashboard/*。
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

  // 注意：這裡刻意不因「目前沒有任何已啟動新版 Workflow 的案件」就整頁替換成單一
  // 空白訊息——治理儀表板架構（KPI／案件目前處理階段／現在需要處理／需關注案件／
  // 各單位待處理案件／進行中案件清單）必須永遠完整渲染，0 筆時每個區塊各自顯示自己
  // 的 0 值或小型說明（見各元件內部的空狀態處理），不得讓使用者以為畫面壞掉或整頁
  // 消失。（先前版本曾經在此以 hasAnyVisibleIssue===false 整頁提早 return，已移除。）
  const inProgressIssueList = viewModel.issueList.filter((row) => row.lifecycleStatus === "IN_PROGRESS");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">治理儀表板</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Hotfix 流程進度、卡點、風險與責任落點總覽（已啟動新版流程案件 {viewModel.kpi.totalVisible} 筆・已完成{" "}
          {viewModel.kpi.completed} 筆・已取消 {viewModel.kpi.cancelled} 筆）
        </p>
      </div>

      <GovernanceFilters options={viewModel.filterOptions} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">治理總覽</h2>
        <TodayOverviewKpis overview={viewModel.todayOverview} phases={viewModel.phaseDistribution} filters={viewModel.filters} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">案件目前處理階段</h2>
        <PhaseBottleneck phases={viewModel.phaseDistribution} stageDistribution={viewModel.stageDistribution} filters={viewModel.filters} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          現在需要處理（共 {viewModel.actionNeeded.length} 筆，依優先順序排列）
        </h2>
        <ActionNeededList issues={viewModel.actionNeeded} staleDaysThreshold={viewModel.kpi.staleDaysThreshold} />
        <details className="mt-2 rounded-lg border border-gray-100">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-400 hover:text-primary">
            依停留天數查看完整清單
          </summary>
          <div className="border-t border-gray-100 p-3">
            <BottleneckList bottleneck={viewModel.bottleneck} filters={viewModel.filters} />
          </div>
        </details>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">需關注案件</h2>
        <div className="space-y-3">
          <RiskOverview overview={viewModel.riskOverview} filters={viewModel.filters} />
          <ReturnOverview overview={viewModel.returnOverview} filters={viewModel.filters} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">各單位待處理案件</h2>
        <TeamWorkloadTable
          entries={viewModel.teamWorkload}
          filters={viewModel.filters}
          staleDaysThreshold={viewModel.kpi.staleDaysThreshold}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">進行中案件清單（共 {inProgressIssueList.length} 筆，依目前篩選）</h2>
        <GovernanceIssueList issues={inProgressIssueList} />
      </section>
    </div>
  );
}
