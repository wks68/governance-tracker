// 治理儀表板 MVP 新增：URL search params ⇄ 篩選條件轉換，以及篩選條件套用。
//
// 篩選條件一律以 URL search params 表達（可分享／可重新整理／可返回／可下鑽，見 Plan
// 第六節）。輸入不合法時一律使用安全預設（忽略該條件或退回 null），不得拋出例外、
// 不得直接拼接 SQL 字串——本模組全程只做字串解析與陣列 filter，未曾接觸原始 SQL。

import {
  isGovernanceLifecycleFilter,
  isGovernanceRiskFilter,
  isStaleDaysOption,
  type GovernanceDashboardFilters,
  type GovernanceIssueRow,
} from "./types";
import {
  hasRepeatedReturnIssue,
  hasReturnIssue,
  isCancelledIssue,
  isCompletedIssue,
  isInProgressIssue,
  isLegacyIssue,
  isPendingApprovalIssue,
  isStaleIssue,
} from "./metrics";

export type GovernanceDashboardSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseFlag(value: string | undefined): boolean {
  return value === "1";
}

// stageId 一律以逗號分隔多個 WorkflowStage id：單一巨集階段（見 stagePhase.ts）在目前
// 資料中可能對應好幾個真實 WorkflowStage，下鑽時需要能同時篩選這幾個 id。
function parseStageIds(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseGovernanceDashboardFilters(searchParams: GovernanceDashboardSearchParams): GovernanceDashboardFilters {
  const riskStatusRaw = firstValue(searchParams.riskStatus);
  const lifecycleStatusRaw = firstValue(searchParams.lifecycleStatus);
  const staleDaysRaw = firstValue(searchParams.staleDaysThreshold);
  const staleDaysParsed = staleDaysRaw ? Number(staleDaysRaw) : NaN;

  return {
    dateFrom: parseDate(firstValue(searchParams.dateFrom)),
    dateTo: parseDate(firstValue(searchParams.dateTo)),
    workflowDefinitionId: firstValue(searchParams.workflowDefinitionId) || null,
    issueType: firstValue(searchParams.issueType) || null,
    stageIds: parseStageIds(firstValue(searchParams.stageId)),
    teamId: firstValue(searchParams.teamId) || null,
    riskStatus: riskStatusRaw && isGovernanceRiskFilter(riskStatusRaw) ? riskStatusRaw : null,
    lifecycleStatus: lifecycleStatusRaw && isGovernanceLifecycleFilter(lifecycleStatusRaw) ? lifecycleStatusRaw : null,
    staleDaysThreshold: isStaleDaysOption(staleDaysParsed) ? staleDaysParsed : null,
    pendingApprovalOnly: parseFlag(firstValue(searchParams.pendingApprovalOnly)),
    returnOnly: parseFlag(firstValue(searchParams.returnOnly)),
    repeatedReturnOnly: parseFlag(firstValue(searchParams.repeatedReturnOnly)),
    legacyOnly: parseFlag(firstValue(searchParams.legacyOnly)),
  };
}

export function governanceDashboardFiltersToSearchParams(filters: GovernanceDashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom.toISOString().slice(0, 10));
  if (filters.dateTo) params.set("dateTo", filters.dateTo.toISOString().slice(0, 10));
  if (filters.workflowDefinitionId) params.set("workflowDefinitionId", filters.workflowDefinitionId);
  if (filters.issueType) params.set("issueType", filters.issueType);
  if (filters.stageIds.length > 0) params.set("stageId", filters.stageIds.join(","));
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.riskStatus) params.set("riskStatus", filters.riskStatus);
  if (filters.lifecycleStatus) params.set("lifecycleStatus", filters.lifecycleStatus);
  if (filters.staleDaysThreshold) params.set("staleDaysThreshold", String(filters.staleDaysThreshold));
  if (filters.pendingApprovalOnly) params.set("pendingApprovalOnly", "1");
  if (filters.returnOnly) params.set("returnOnly", "1");
  if (filters.repeatedReturnOnly) params.set("repeatedReturnOnly", "1");
  if (filters.legacyOnly) params.set("legacyOnly", "1");
  return params;
}

// 供下鑽連結使用：以目前篩選條件為基礎，套用部分欄位覆寫後組出 /governance 的
// href（Server／Client Component 皆可用的純函式）。點擊 KPI／Stage／Team／風險卡片
// 時，只覆寫該卡片對應的欄位，其餘目前篩選條件維持不變。
export function withGovernanceFilterOverride(
  filters: GovernanceDashboardFilters,
  overrides: Partial<GovernanceDashboardFilters>,
): string {
  const merged: GovernanceDashboardFilters = { ...filters, ...overrides };
  const query = governanceDashboardFiltersToSearchParams(merged).toString();
  return query ? `/governance?${query}` : "/governance";
}

// 套用篩選條件；一律呼叫 metrics.ts 匯出的 predicate 函式，確保與 KPI／統計卡片使用
// 完全相同的分類邏輯（Plan 第八節第 9 項：KPI 下鑽結果與明細數量必須一致）。
export function applyGovernanceDashboardFilters(
  rows: readonly GovernanceIssueRow[],
  filters: GovernanceDashboardFilters,
): GovernanceIssueRow[] {
  return rows.filter((row) => {
    if (filters.dateFrom && row.createdAt.getTime() < filters.dateFrom.getTime()) return false;
    if (filters.dateTo && row.createdAt.getTime() > filters.dateTo.getTime()) return false;
    if (filters.workflowDefinitionId && row.workflowDefinition?.id !== filters.workflowDefinitionId) return false;
    if (filters.issueType && row.issueType !== filters.issueType) return false;
    if (filters.stageIds.length > 0 && (!row.currentStage || !filters.stageIds.includes(row.currentStage.id))) return false;
    if (filters.teamId && row.assignedTeamId !== filters.teamId) return false;

    if (filters.riskStatus === "YES" && row.riskStatus !== "YES") return false;
    if (filters.riskStatus === "UNKNOWN" && row.riskStatus !== "UNKNOWN") return false;
    if (filters.riskStatus === "UNANSWERED" && row.riskStatus !== "UNANSWERED") return false;

    if (filters.lifecycleStatus === "IN_PROGRESS" && !isInProgressIssue(row)) return false;
    if (filters.lifecycleStatus === "COMPLETED" && !isCompletedIssue(row)) return false;
    if (filters.lifecycleStatus === "CANCELLED" && !isCancelledIssue(row)) return false;

    if (filters.staleDaysThreshold !== null && !isStaleIssue(row, filters.staleDaysThreshold)) return false;
    if (filters.pendingApprovalOnly && !isPendingApprovalIssue(row)) return false;
    if (filters.returnOnly && !hasReturnIssue(row)) return false;
    if (filters.repeatedReturnOnly && !hasRepeatedReturnIssue(row)) return false;
    if (filters.legacyOnly && !isLegacyIssue(row)) return false;

    return true;
  });
}
