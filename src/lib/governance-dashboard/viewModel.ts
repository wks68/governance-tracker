// 治理儀表板 MVP 新增：整合 access／filters／queries／metrics 為單一 ViewModel。
//
// Server Component（src/app/governance/page.tsx）只呼叫本檔案取得 ViewModel，不直接
// import Prisma、不自行決定篩選或統計邏輯（Plan 第五節）。
//
// 設計：整頁（KPI／Stage 分布／風險／瓶頸／RETURN／Team 負載／最近異常／下鑽清單）
// 一律基於同一份「套用篩選條件後」的 rows 計算，因此點擊 KPI／Stage／Team／風險項目
// 加入對應篩選條件後，頁面所有卡片與下方下鑽清單會同時反映同一個篩選範圍，天然保證
// 「KPI 下鑽結果與明細清單筆數一致」（Plan 第八節第 9 項）。

import { applyGovernanceDashboardFilters, type GovernanceDashboardSearchParams, parseGovernanceDashboardFilters } from "./filters";
import {
  computeActionNeededList,
  computeBottleneckSummary,
  computeKpiSummary,
  computeLegacySummary,
  computePhaseDistribution,
  computeReturnOverview,
  computeRiskOverview,
  computeStageDistribution,
  computeTeamWorkload,
  computeTodayOverview,
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
  const filteredRows = applyGovernanceDashboardFilters(allRows, filters);
  const staleDaysThreshold = filters.staleDaysThreshold ?? DEFAULT_STALE_DAYS_THRESHOLD;

  return {
    filters,
    filterOptions: buildFilterOptions(allRows),
    kpi: computeKpiSummary(filteredRows, staleDaysThreshold),
    todayOverview: computeTodayOverview(filteredRows, staleDaysThreshold),
    stageDistribution: computeStageDistribution(filteredRows),
    phaseDistribution: computePhaseDistribution(filteredRows),
    riskOverview: computeRiskOverview(filteredRows),
    bottleneck: computeBottleneckSummary(filteredRows),
    returnOverview: computeReturnOverview(filteredRows),
    teamWorkload: computeTeamWorkload(filteredRows, staleDaysThreshold),
    actionNeeded: computeActionNeededList(filteredRows, staleDaysThreshold),
    legacy: computeLegacySummary(filteredRows),
    issueList: filteredRows,
    hasAnyVisibleIssue: allRows.length > 0,
  };
}
