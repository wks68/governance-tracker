// 治理儀表板 MVP 新增：整合 access／filters／queries／metrics 為單一 ViewModel。
//
// Server Component（src/app/governance/page.tsx）只呼叫本檔案取得 ViewModel，不直接
// import Prisma、不自行決定篩選或統計邏輯（Plan 第五節）。
//
// 設計：整頁（KPI／Stage 分布／風險／瓶頸／RETURN／Team 負載／下鑽清單）一律基於同一份
// 「套用篩選條件後」的 rows 計算，因此點擊 KPI／Stage／Team／風險項目加入對應篩選條件後，
// 頁面所有卡片與下方下鑽清單會同時反映同一個篩選範圍，天然保證「KPI 下鑽結果與明細清單
// 筆數一致」（Plan 第八節第 9 項）。
//
// 治理儀表板 UI 收斂（第二輪）：本頁只統計「已啟動新版 Workflow」的案件——
// getVisibleGovernanceIssueRows 回傳的是使用者可見的「完整」Issue 集合（含舊制），
// 本函式在套用任何篩選條件之前，先以 isLegacyIssue 濾除 lifecycleStatus="LEGACY"
// 的列，之後的 KPI／階段分布／風險／待核准／Team 負載／案件清單全部只看
// governedRows，舊制案件不會出現在治理儀表板的任何查詢結果或統計裡。舊制案件本身
// 完全不受影響（不讀取／不修改／不刪除 workflowVersionId／currentWorkflowStageId／
// Risk／History／Approval 等既有資料），仍可透過 /issues 一般工單清單與 /issues/[id]
// 明細頁查閱——這裡只是「治理儀表板這個特定畫面選擇不顯示它」，不是資料層面的刪除。
import { applyGovernanceDashboardFilters, type GovernanceDashboardSearchParams, parseGovernanceDashboardFilters } from "./filters";
import {
  computeActionNeededList,
  computeBottleneckSummary,
  computeKpiSummary,
  computePhaseDistribution,
  computeReturnOverview,
  computeRiskOverview,
  computeStageDistribution,
  computeTeamWorkload,
  computeTodayOverview,
  isLegacyIssue,
} from "./metrics";
import { getVisibleGovernanceIssueRows } from "./queries";
import {
  DEFAULT_STALE_DAYS_THRESHOLD,
  type GovernanceDashboardViewModel,
  type GovernanceFilterOptions,
  type GovernanceIssueRow,
  type GovernanceWorkflowDefinitionRef,
} from "./types";

function buildFilterOptions(rows: readonly GovernanceIssueRow[]): GovernanceFilterOptions {
  const definitionMap = new Map<string, GovernanceWorkflowDefinitionRef>();
  const issueTypes = new Set<string>();
  const stageMap = new Map<string, GovernanceFilterOptions["stages"][number]>();
  const teamMap = new Map<string, string>();

  for (const row of rows) {
    if (row.workflowDefinition) definitionMap.set(row.workflowDefinition.id, row.workflowDefinition);
    issueTypes.add(row.issueType);
    if (row.currentStage) stageMap.set(row.currentStage.id, row.currentStage);
    if (row.assignedTeamId) teamMap.set(row.assignedTeamId, row.assignedTeamName ?? row.assignedTeamId);
  }

  return {
    workflowDefinitions: [...definitionMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    issueTypes: [...issueTypes].sort(),
    stages: [...stageMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    teams: [...teamMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function buildGovernanceDashboardViewModel(
  actorId: string,
  searchParams: GovernanceDashboardSearchParams,
): Promise<GovernanceDashboardViewModel> {
  const filters = parseGovernanceDashboardFilters(searchParams);
  const allRows = await getVisibleGovernanceIssueRows(actorId);
  // 治理儀表板只統計已啟動新版 Workflow 的案件；舊制案件在此就被濾除，之後的篩選、
  // 統計、清單一律看不到它們（見上方檔案頂端說明）。
  const governedRows = allRows.filter((row) => !isLegacyIssue(row));
  const filteredRows = applyGovernanceDashboardFilters(governedRows, filters);
  const staleDaysThreshold = filters.staleDaysThreshold ?? DEFAULT_STALE_DAYS_THRESHOLD;

  return {
    filters,
    filterOptions: buildFilterOptions(governedRows),
    kpi: computeKpiSummary(filteredRows, staleDaysThreshold),
    todayOverview: computeTodayOverview(filteredRows, staleDaysThreshold),
    stageDistribution: computeStageDistribution(filteredRows),
    phaseDistribution: computePhaseDistribution(filteredRows),
    riskOverview: computeRiskOverview(filteredRows),
    bottleneck: computeBottleneckSummary(filteredRows),
    returnOverview: computeReturnOverview(filteredRows),
    teamWorkload: computeTeamWorkload(filteredRows, staleDaysThreshold),
    actionNeeded: computeActionNeededList(filteredRows, staleDaysThreshold),
    issueList: filteredRows,
    hasAnyVisibleIssue: governedRows.length > 0,
  };
}
