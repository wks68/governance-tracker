// 治理儀表板 MVP 新增：純邏輯統計計算。
//
// 本檔案完全不依賴 Prisma／資料庫查詢，只對 queries.ts 已正規化好的 GovernanceIssueRow[]
// 陣列做記憶體運算，可獨立單元測試。所有「分類判斷」集中在本檔案最上方的 predicate
// 函式匯出，filters.ts 的 applyFilters 與本檔案的統計聚合共用同一組 predicate，確保
// KPI 卡片數字與下鑽清單筆數永遠一致（Plan 第八節第 9 項）。

import {
  DEFAULT_STALE_DAYS_THRESHOLD,
  type GovernanceBottleneckSummary,
  type GovernanceDashboardFilters,
  type GovernanceHotfixBoardEntry,
  type GovernanceIssueRow,
  type GovernanceKpiSummary,
  type GovernancePhaseDistributionEntry,
  type GovernanceReturnOverview,
  type GovernanceReturnStageAggregate,
  type GovernanceRiskOverview,
  type GovernanceStageDistributionEntry,
  type GovernanceTeamWorkloadEntry,
  type GovernanceTodayOverview,
  STALE_DAYS_OPTIONS,
  type StaleDaysOption,
} from "./types";
import { GOVERNANCE_PHASE_ORDER, HOTFIX_BOARD_BUCKET_ORDER, hotfixBoardBucketOf, stagePhaseOf } from "./stagePhase";

// ---------------------------------------------------------------------------
// 共用分類 predicate（filters.applyFilters 與本檔案統計聚合唯一共用來源）
// ---------------------------------------------------------------------------

export function isLegacyIssue(row: GovernanceIssueRow): boolean {
  return row.lifecycleStatus === "LEGACY";
}
export function isInProgressIssue(row: GovernanceIssueRow): boolean {
  return row.lifecycleStatus === "IN_PROGRESS";
}
export function isCompletedIssue(row: GovernanceIssueRow): boolean {
  return row.lifecycleStatus === "COMPLETED";
}
export function isCancelledIssue(row: GovernanceIssueRow): boolean {
  return row.lifecycleStatus === "CANCELLED";
}
export function isPendingApprovalIssue(row: GovernanceIssueRow): boolean {
  return row.pendingApproval;
}
export function isHighRiskIssue(row: GovernanceIssueRow): boolean {
  return row.riskStatus === "YES";
}
export function isRiskUnknownIssue(row: GovernanceIssueRow): boolean {
  return row.riskStatus === "UNKNOWN";
}
export function isRiskUnansweredIssue(row: GovernanceIssueRow): boolean {
  return row.riskStatus === "UNANSWERED";
}
export function isStaleIssue(row: GovernanceIssueRow, thresholdDays: number): boolean {
  return row.dwellDays !== null && row.dwellDays >= thresholdDays;
}
export function hasReturnIssue(row: GovernanceIssueRow): boolean {
  return row.returnCount >= 1;
}
export function hasRepeatedReturnIssue(row: GovernanceIssueRow): boolean {
  return row.returnCount >= 2;
}
// Category B：尚未啟動新版 Workflow，但依 legacy 語意尚未結案的案件（見 queries.ts
// deriveLifecycleStatus 的根因修正）。這類案件 lifecycleStatus 仍是 IN_PROGRESS，
// 但沒有 currentStage 可用，Hotfix 管理看板一律歸類到「開單／待處理」桶。
export function isPreWorkflowOpenIssue(row: GovernanceIssueRow): boolean {
  return isInProgressIssue(row) && row.currentStage === null;
}

// ---------------------------------------------------------------------------
// KPI 總覽
// ---------------------------------------------------------------------------

export function computeKpiSummary(
  rows: readonly GovernanceIssueRow[],
  staleDaysThreshold: StaleDaysOption = DEFAULT_STALE_DAYS_THRESHOLD,
): GovernanceKpiSummary {
  return {
    inProgress: rows.filter(isInProgressIssue).length,
    completed: rows.filter(isCompletedIssue).length,
    cancelled: rows.filter(isCancelledIssue).length,
    pendingApproval: rows.filter(isPendingApprovalIssue).length,
    highRisk: rows.filter(isHighRiskIssue).length,
    stale: rows.filter((r) => isStaleIssue(r, staleDaysThreshold)).length,
    staleDaysThreshold,
    totalVisible: rows.length,
  };
}

// ---------------------------------------------------------------------------
// 首頁頂部 5 張 KPI（治理儀表板第四輪：四區塊治理管理看板版型）。
//
// 「進行中」四項一律用 isInProgressIssue（lifecycleStatus==="IN_PROGRESS"）判斷，
// 這個 predicate 在 queries.ts 根因修正後，同時涵蓋：
//   A. 已啟動新版 Workflow 且尚未 COMPLETED／CANCELLED 的案件。
//   B. 尚未啟動新版 Workflow、但依既有 legacy 語意尚未結案的案件（isPreWorkflowOpenIssue）。
// 兩者的聯集才是「使用者可見範圍內所有尚未結案的案件」，不得只看其中一種
// （這正是「已建立 Hotfix 工單，但 KPI 仍顯示 0」的根因修正重點）。
// ---------------------------------------------------------------------------

export function computeTodayOverview(
  rows: readonly GovernanceIssueRow[],
  staleDaysThreshold: StaleDaysOption = DEFAULT_STALE_DAYS_THRESHOLD,
): GovernanceTodayOverview {
  const inProgress = rows.filter(isInProgressIssue);
  return {
    hotfixInProgress: inProgress.filter((r) => r.issueType === "Hotfix").length,
    rcaInProgress: inProgress.filter((r) => r.issueType === "RCA").length,
    incidentInProgress: inProgress.filter((r) => r.issueType === "Incident").length,
    riskExceptionOpen: inProgress.filter((r) => r.issueType === "RiskException").length,
    stale: rows.filter((r) => isStaleIssue(r, staleDaysThreshold)).length,
    staleDaysThreshold,
  };
}

// ---------------------------------------------------------------------------
// 現在需要處理：首頁核心清單，依「高風險／風險待確認 > 待主管核准 > 停留最久 >
// 重複退回 > 一般進行中」排序，只納入進行中案件（不含舊制／已完成／已取消）。
// ---------------------------------------------------------------------------

export function actionPriorityScore(row: GovernanceIssueRow, staleDaysThreshold: number): number {
  if (isHighRiskIssue(row) || isRiskUnknownIssue(row)) return 0;
  if (isPendingApprovalIssue(row)) return 1;
  if (isStaleIssue(row, staleDaysThreshold)) return 2;
  if (hasRepeatedReturnIssue(row)) return 3;
  return 4;
}

export function computeActionNeededList(
  rows: readonly GovernanceIssueRow[],
  staleDaysThreshold: StaleDaysOption = DEFAULT_STALE_DAYS_THRESHOLD,
  limit = 20,
): GovernanceIssueRow[] {
  return rows
    .filter(isInProgressIssue)
    .slice()
    .sort((a, b) => {
      const scoreDiff = actionPriorityScore(a, staleDaysThreshold) - actionPriorityScore(b, staleDaysThreshold);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.dwellDays ?? -1) - (a.dwellDays ?? -1);
    })
    .slice(0, limit);
}

export function deriveSuggestedAction(row: GovernanceIssueRow, staleDaysThreshold: number): string {
  if (isHighRiskIssue(row)) return "確認風險項目並決定處理方式";
  if (isRiskUnknownIssue(row)) return "釐清風險狀態";
  if (isPendingApprovalIssue(row)) return "等待主管核准";
  if (isStaleIssue(row, staleDaysThreshold)) return "確認卡關原因並推進";
  if (hasRepeatedReturnIssue(row)) return "檢視退回原因，避免重複退回";
  return "持續處理中";
}

// ---------------------------------------------------------------------------
// Hotfix 管理看板（A 區）：5 桶固定管線（開單／待處理 → RD 修正 → QA 驗證 → OP 上版 →
// 正式環境確認），只計入 issueType==="Hotfix" 且 isInProgressIssue 的案件——這包含
// Category A（新版 Workflow 進行中）與 Category B（尚未啟動新版 Workflow 但依 legacy
// 語意尚未結案），兩者一律計入，不得因為沒有 currentStage 就漏算（根因修正重點）。
// 各桶加總即為「進行中 Hotfix」KPI（見 computeTodayOverview.hotfixInProgress）。
// preview 依 actionPriorityScore 排序（風險／待核准／停留最久優先），只取前幾筆供卡片
// 展示，count 才是該桶完整件數。桶位固定顯示（即使 0 件也顯示，不得因排版好看而省略）。
// ---------------------------------------------------------------------------

export function computeHotfixBoard(
  rows: readonly GovernanceIssueRow[],
  staleDaysThreshold: StaleDaysOption = DEFAULT_STALE_DAYS_THRESHOLD,
  previewLimit = 4,
): GovernanceHotfixBoardEntry[] {
  const hotfixInProgress = rows.filter((r) => r.issueType === "Hotfix" && isInProgressIssue(r));
  const byBucket = new Map<string, GovernanceIssueRow[]>();
  for (const row of hotfixInProgress) {
    const bucket = hotfixBoardBucketOf(row.currentStage);
    const list = byBucket.get(bucket) ?? [];
    list.push(row);
    byBucket.set(bucket, list);
  }
  return HOTFIX_BOARD_BUCKET_ORDER.map((bucket) => {
    const list = byBucket.get(bucket) ?? [];
    const sorted = [...list].sort((a, b) => {
      const diff = actionPriorityScore(a, staleDaysThreshold) - actionPriorityScore(b, staleDaysThreshold);
      return diff !== 0 ? diff : (b.dwellDays ?? -1) - (a.dwellDays ?? -1);
    });
    return { bucket, count: list.length, preview: sorted.slice(0, previewLimit) };
  });
}

// ---------------------------------------------------------------------------
// 流程卡點（巨集階段）：以 stagePhase.ts 的分組取代直接顯示 StageType／WorkflowStage
// key，只計入新版 Workflow「進行中」案件。依業務流程順序排列，資料中沒有出現的階段
// 不顯示；未落入既定分組的關卡以其自身 label 個別呈現（fallback，見 stagePhase.ts）。
// ---------------------------------------------------------------------------

export function computePhaseDistribution(rows: readonly GovernanceIssueRow[]): GovernancePhaseDistributionEntry[] {
  const groups = new Map<string, { count: number; stageIds: Set<string> }>();
  for (const row of rows) {
    if (!isInProgressIssue(row) || !row.currentStage) continue;
    const phase = stagePhaseOf(row.currentStage)!;
    const g = groups.get(phase) ?? { count: 0, stageIds: new Set<string>() };
    g.count += 1;
    g.stageIds.add(row.currentStage.id);
    groups.set(phase, g);
  }

  const ordered: GovernancePhaseDistributionEntry[] = [];
  for (const phase of GOVERNANCE_PHASE_ORDER) {
    const g = groups.get(phase);
    if (g) ordered.push({ phase, count: g.count, stageIds: [...g.stageIds] });
  }
  for (const [phase, g] of groups) {
    if (!(GOVERNANCE_PHASE_ORDER as readonly string[]).includes(phase)) {
      ordered.push({ phase, count: g.count, stageIds: [...g.stageIds] });
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// 目前階段分布（各關卡明細）：只計入新版 Workflow「進行中」案件，不得混入舊制案件或
// 已結束案件。完全依實際資料出現的 WorkflowStage 動態分組，不硬編碼任何階段 key／label。
// ---------------------------------------------------------------------------

export function computeStageDistribution(rows: readonly GovernanceIssueRow[]): GovernanceStageDistributionEntry[] {
  const groups = new Map<string, GovernanceStageDistributionEntry>();
  for (const row of rows) {
    if (!isInProgressIssue(row) || !row.currentStage) continue;
    const key = row.currentStage.id;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { stage: row.currentStage, count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.stage.label.localeCompare(b.stage.label));
}

// ---------------------------------------------------------------------------
// 風險監控
// ---------------------------------------------------------------------------

export function computeRiskOverview(rows: readonly GovernanceIssueRow[]): GovernanceRiskOverview {
  return {
    yes: rows.filter(isHighRiskIssue).length,
    unknown: rows.filter(isRiskUnknownIssue).length,
    unanswered: rows.filter(isRiskUnansweredIssue).length,
    noRecord: rows.filter((r) => r.riskStatus === "NONE").length,
  };
}

// ---------------------------------------------------------------------------
// 流程瓶頸
// ---------------------------------------------------------------------------

export function computeBottleneckSummary(rows: readonly GovernanceIssueRow[]): GovernanceBottleneckSummary {
  const dwelling = rows.filter((r) => isInProgressIssue(r) && r.dwellDays !== null);
  const thresholdCounts = Object.fromEntries(
    STALE_DAYS_OPTIONS.map((threshold) => [threshold, dwelling.filter((r) => isStaleIssue(r, threshold)).length]),
  ) as Record<StaleDaysOption, number>;
  const longestDwelling = [...dwelling]
    .sort((a, b) => (b.dwellDays ?? 0) - (a.dwellDays ?? 0))
    .slice(0, 20);
  return { thresholdCounts, longestDwelling };
}

// ---------------------------------------------------------------------------
// RETURN 監控：主要退回階段以「退回後進入的關卡」（toStage）分組，因為那才是實際
// 承接被退回案件、需要處理的關卡。
// ---------------------------------------------------------------------------

export function computeReturnOverview(rows: readonly GovernanceIssueRow[]): GovernanceReturnOverview {
  const withReturn = rows.filter(hasReturnIssue);
  const totalReturns = rows.reduce((sum, r) => sum + r.returnCount, 0);
  const repeatedReturnIssues = rows.filter(hasRepeatedReturnIssue).length;

  const stageAgg = new Map<string, GovernanceReturnStageAggregate>();
  for (const row of rows) {
    for (const event of row.returnEvents) {
      const existing = stageAgg.get(event.toStageId);
      if (existing) {
        existing.count += 1;
      } else {
        stageAgg.set(event.toStageId, { stageId: event.toStageId, stageLabel: event.toStageLabel, count: 1 });
      }
    }
  }
  const topReturnStages = [...stageAgg.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  return {
    issuesWithReturn: withReturn.length,
    totalReturns,
    repeatedReturnIssues,
    topReturnStages,
  };
}

// ---------------------------------------------------------------------------
// Team 負載
// ---------------------------------------------------------------------------

export function computeTeamWorkload(
  rows: readonly GovernanceIssueRow[],
  staleDaysThreshold: StaleDaysOption = DEFAULT_STALE_DAYS_THRESHOLD,
): GovernanceTeamWorkloadEntry[] {
  const byTeam = new Map<string, GovernanceTeamWorkloadEntry>();
  for (const row of rows) {
    if (!row.assignedTeamId) continue;
    const entry = byTeam.get(row.assignedTeamId) ?? {
      teamId: row.assignedTeamId,
      teamName: row.assignedTeamName ?? row.assignedTeamId,
      inProgress: 0,
      pendingApproval: 0,
      stale: 0,
      longestDwellDays: null as number | null,
    };
    if (isInProgressIssue(row)) entry.inProgress += 1;
    if (isPendingApprovalIssue(row)) entry.pendingApproval += 1;
    if (isStaleIssue(row, staleDaysThreshold)) entry.stale += 1;
    if (row.dwellDays !== null && (entry.longestDwellDays === null || row.dwellDays > entry.longestDwellDays)) {
      entry.longestDwellDays = row.dwellDays;
    }
    byTeam.set(row.assignedTeamId, entry);
  }
  return [...byTeam.values()].sort((a, b) => b.inProgress - a.inProgress || a.teamName.localeCompare(b.teamName));
}
