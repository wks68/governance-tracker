// 治理儀表板驗證腳本。
//
// 涵蓋治理儀表板查詢層／統計層／UI 收斂正確性，分三類：
//   A. 純邏輯測試（metrics.ts／filters.ts）：不依賴資料庫，使用手造 GovernanceIssueRow[]
//      驗證統計與篩選邏輯本身，包含空資料狀態與 URL 篩選輸入驗證，也涵蓋 UI 收斂新增的
//      今日治理總覽／流程卡點（巨集階段）／現在需要處理排序等純邏輯。
//   B. DB 整合測試：在專用 scratch 資料庫建立涵蓋各種狀態的 Issue／WorkflowStage／
//      IssueWorkflowStageHistory／ApprovalRecord／StageRiskCheck 資料，驗證
//      queries.ts／viewModel.ts 產出的統計與可見性正確。
//   C. 原始碼層級靜態檢查：UI／Page 不直接 import Prisma、Client Component 不 import
//      伺服端專用模組、governance-dashboard 模組完全不讀取 workflowStatus；UI 收斂驗收
//      （Nav 只剩單一 /governance 入口、舊 /dashboard 改為 redirect、正式畫面不得出現
//      「MVP」「Mock」字樣）。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 執行方式（DATABASE_URL 指向的檔案必須已存在，腳本本身會對它執行一次
// `prisma migrate deploy`）：
//   touch /path/to/scratch.db
//   DATABASE_URL="file:/path/to/scratch.db" node_modules/.bin/tsx scripts/governance_dashboard-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import {
  parseGovernanceDashboardFilters,
  applyGovernanceDashboardFilters,
  withGovernanceFilterOverride,
  computeKpiSummary,
  computeStageDistribution,
  computeRiskOverview,
  computeBottleneckSummary,
  computeReturnOverview,
  computeTeamWorkload,
  computeTodayOverview,
  computePhaseDistribution,
  computeActionNeededList,
  computeHotfixBoard,
  isPreWorkflowOpenIssue,
  hotfixBoardBucketOf,
  hotfixBoardApprovalBadge,
  deriveSuggestedAction,
  resolveGovernanceDashboardAccess,
  getVisibleGovernanceIssueRows,
  buildGovernanceDashboardViewModel,
  DEFAULT_STALE_DAYS_THRESHOLD,
  GovernanceDashboardAccessDeniedError,
  type GovernanceIssueRow,
  type GovernanceDashboardFilters,
} from "../src/lib/governanceDashboardService";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

async function checkAsync(name: string, fn: () => Promise<boolean>) {
  try {
    check(name, await fn());
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name}（未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, matcher: (err: unknown) => boolean) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期拋出例外，但沒有拋出）`);
  } catch (err) {
    if (matcher(err)) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（拋出了非預期的例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

const REPO_ROOT = path.resolve(__dirname, "..");
const RUN_TAG = `gdv${Date.now()}`;

const EMPTY_FILTERS: GovernanceDashboardFilters = {
  dateFrom: null,
  dateTo: null,
  workflowDefinitionId: null,
  issueType: null,
  stageIds: [],
  teamId: null,
  riskStatus: null,
  lifecycleStatus: null,
  staleDaysThreshold: null,
  pendingApprovalOnly: false,
  returnOnly: false,
  repeatedReturnOnly: false,
};

function makeRow(overrides: Partial<GovernanceIssueRow> & Pick<GovernanceIssueRow, "id" | "issueKey">): GovernanceIssueRow {
  return {
    title: "測試案件",
    issueType: "Hotfix",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    assignedTeamId: null,
    assignedTeamName: null,
    workflowDefinition: null,
    lifecycleStatus: "IN_PROGRESS",
    currentStage: null,
    dwellDays: null,
    returnEvents: [],
    returnCount: 0,
    pendingApproval: false,
    riskStatus: "NONE",
    ownerName: null,
    dueDate: null,
    systemName: null,
    priority: null,
    preWorkflowStatusLabel: null,
    ...overrides,
  };
}

// ===========================================================================
// A. 純邏輯測試：metrics.ts／filters.ts
// ===========================================================================

function runPureMetricsTests() {
  console.log("\n=== A1. metrics.ts 純邏輯測試（含 Plan 第七節空資料狀態） ===");

  // ---- 空資料（Plan 第七節：0 件、尚無資料，不得顯示成錯誤） ----
  const emptyKpi = computeKpiSummary([]);
  check(
    "[17-1] computeKpiSummary([]) 全部欄位為 0，不拋出例外",
    emptyKpi.inProgress === 0 &&
      emptyKpi.completed === 0 &&
      emptyKpi.cancelled === 0 &&
      emptyKpi.pendingApproval === 0 &&
      emptyKpi.highRisk === 0 &&
      emptyKpi.stale === 0 &&
      emptyKpi.totalVisible === 0,
  );
  check("[17-2] computeStageDistribution([]) 回傳空陣列", computeStageDistribution([]).length === 0);
  const emptyRisk = computeRiskOverview([]);
  check(
    "[17-3] computeRiskOverview([]) 全部為 0（尚無風險紀錄）",
    emptyRisk.yes === 0 && emptyRisk.unknown === 0 && emptyRisk.unanswered === 0 && emptyRisk.noRecord === 0,
  );
  const emptyBottleneck = computeBottleneckSummary([]);
  check(
    "[17-4] computeBottleneckSummary([]) 尚無可計算完成時間，thresholdCounts 全 0、longestDwelling 空",
    Object.values(emptyBottleneck.thresholdCounts).every((v) => v === 0) && emptyBottleneck.longestDwelling.length === 0,
  );
  const emptyReturn = computeReturnOverview([]);
  check(
    "[17-5] computeReturnOverview([]) 尚無 RETURN 紀錄，全部為 0",
    emptyReturn.issuesWithReturn === 0 && emptyReturn.totalReturns === 0 && emptyReturn.repeatedReturnIssues === 0 && emptyReturn.topReturnStages.length === 0,
  );
  check("[17-6] computeTeamWorkload([]) 回傳空陣列", computeTeamWorkload([]).length === 0);
  const emptyOverview = computeTodayOverview([]);
  check(
    "[17-7] computeTodayOverview([]) 全部欄位為 0，不拋出例外",
    emptyOverview.hotfixInProgress === 0 &&
      emptyOverview.rcaInProgress === 0 &&
      emptyOverview.incidentInProgress === 0 &&
      emptyOverview.riskExceptionOpen === 0 &&
      emptyOverview.stale === 0,
  );
  check("[17-7b] computePhaseDistribution([]) 回傳空陣列", computePhaseDistribution([]).length === 0);
  check("[17-7c] computeActionNeededList([]) 回傳空陣列", computeActionNeededList([]).length === 0);

  // ---- KPI／Stage 分布／風險／RETURN／Team 負載聚合邏輯（單元層級） ----
  const stageA = { id: "stage-a", stageKey: "a", label: "A 關卡", stageType: "WORK", assignedTeamId: "team-1", assignedTeamName: "Team 1" };
  const stageB = { id: "stage-b", stageKey: "b", label: "B 關卡", stageType: "REVIEW", assignedTeamId: null, assignedTeamName: null };

  const rows: GovernanceIssueRow[] = [
    makeRow({ id: "1", issueKey: "K1", lifecycleStatus: "IN_PROGRESS", currentStage: stageA, assignedTeamId: "team-1", assignedTeamName: "Team 1", dwellDays: 10 }),
    makeRow({ id: "2", issueKey: "K2", lifecycleStatus: "IN_PROGRESS", currentStage: stageA, assignedTeamId: "team-1", assignedTeamName: "Team 1", dwellDays: 2 }),
    makeRow({ id: "3", issueKey: "K3", lifecycleStatus: "IN_PROGRESS", currentStage: stageB, riskStatus: "YES", pendingApproval: true }),
    makeRow({ id: "4", issueKey: "K4", lifecycleStatus: "COMPLETED", currentStage: null }),
    makeRow({ id: "5", issueKey: "K5", lifecycleStatus: "CANCELLED", currentStage: null }),
    makeRow({ id: "6", issueKey: "K6", lifecycleStatus: "LEGACY", currentStage: null, riskStatus: "UNKNOWN" }),
    makeRow({
      id: "7",
      issueKey: "K7",
      lifecycleStatus: "IN_PROGRESS",
      currentStage: stageA,
      returnEvents: [
        { toStageId: "stage-a", toStageLabel: "A 關卡", fromStageId: "stage-b", fromStageLabel: "B 關卡", executedAt: new Date() },
        { toStageId: "stage-a", toStageLabel: "A 關卡", fromStageId: "stage-b", fromStageLabel: "B 關卡", executedAt: new Date() },
      ],
      returnCount: 2,
      assignedTeamId: "team-1",
      assignedTeamName: "Team 1",
    }),
    makeRow({ id: "8", issueKey: "K8", issueType: "RCA", lifecycleStatus: "IN_PROGRESS", currentStage: null }),
    makeRow({ id: "9", issueKey: "K9", issueType: "Incident", lifecycleStatus: "IN_PROGRESS", currentStage: null }),
    makeRow({ id: "10", issueKey: "K10", issueType: "RiskException", lifecycleStatus: "IN_PROGRESS", currentStage: null }),
  ];

  const kpi = computeKpiSummary(rows, 7);
  check("[1-1] computeKpiSummary：進行中計數（IN_PROGRESS，K1/K2/K3/K7/K8/K9/K10）", kpi.inProgress === 7, `實際 ${kpi.inProgress}`);
  check("[1-2] computeKpiSummary：已完成計數（COMPLETED）", kpi.completed === 1);
  check("[1-3] computeKpiSummary：已取消計數（CANCELLED）", kpi.cancelled === 1);
  check("[3-1] computeKpiSummary：待核准計數（ApprovalRecord PENDING+ACTIVE）", kpi.pendingApproval === 1);
  check("[4-1] computeKpiSummary：高風險計數（Risk=YES）", kpi.highRisk === 1);
  check("[7-1] computeKpiSummary：停留超過 7 天計數（只有 K1 dwellDays=10）", kpi.stale === 1);

  const stageDist = computeStageDistribution(rows);
  check(
    "[2-1] computeStageDistribution：只計入 IN_PROGRESS，K4/K5/K6 不計入",
    stageDist.reduce((s, e) => s + e.count, 0) === 4,
  );
  check("[2-2] computeStageDistribution：stage-a 有 3 件（K1/K2/K7），stage-b 有 1 件（K3）", stageDist.find((e) => e.stage.id === "stage-a")?.count === 3 && stageDist.find((e) => e.stage.id === "stage-b")?.count === 1);

  const risk = computeRiskOverview(rows);
  check(
    "[4-2] computeRiskOverview：yes=1 unknown=1（純函式本身不區分 LEGACY，濾除舊制案件是呼叫端 viewModel.ts 的責任，見 [LEGACY-*] 系列 DB 整合測試）",
    risk.yes === 1 && risk.unknown === 1,
  );
  check("[4-3] computeRiskOverview：noRecord 計入其餘完全無風險紀錄的案件", risk.noRecord === rows.length - risk.yes - risk.unknown);

  const bottleneck = computeBottleneckSummary(rows);
  check("[7-2] computeBottleneckSummary：thresholdCounts[1]=2（K1=10,K2=2 皆 >=1）", bottleneck.thresholdCounts[1] === 2);
  check("[7-3] computeBottleneckSummary：thresholdCounts[7]=1（只有 K1）", bottleneck.thresholdCounts[7] === 1);
  check("[7-4] computeBottleneckSummary：thresholdCounts[14]=0", bottleneck.thresholdCounts[14] === 0);
  check("[7-5] computeBottleneckSummary：longestDwelling 依天數由大到小排序，K1 排第一", bottleneck.longestDwelling[0]?.id === "1");

  const ret = computeReturnOverview(rows);
  check("[5-1] computeReturnOverview：issuesWithReturn=1（僅 K7）", ret.issuesWithReturn === 1);
  check("[5-2] computeReturnOverview：totalReturns=2", ret.totalReturns === 2);
  check("[5-3] computeReturnOverview：repeatedReturnIssues=1（K7 returnCount>=2）", ret.repeatedReturnIssues === 1);
  check("[5-4] computeReturnOverview：主要退回關卡聚合到 stage-a，count=2", ret.topReturnStages.find((s) => s.stageId === "stage-a")?.count === 2);

  const team = computeTeamWorkload(rows, 7);
  const team1 = team.find((t) => t.teamId === "team-1");
  check("[6-1] computeTeamWorkload：team-1 進行中 3 件（K1/K2/K7）", team1?.inProgress === 3);
  check("[6-2] computeTeamWorkload：team-1 停留超過門檻 1 件（K1）", team1?.stale === 1);
  check("[6-4] computeTeamWorkload：team-1 最長停留天數＝10（K1）", team1?.longestDwellDays === 10);

  const overview = computeTodayOverview(rows, 7);
  check("[TO-1] computeTodayOverview：hotfixInProgress＝進行中且 issueType=Hotfix 的件數（K1/K2/K3/K7）", overview.hotfixInProgress === 4);
  check("[TO-2] computeTodayOverview：rcaInProgress＝1（K8）", overview.rcaInProgress === 1);
  check("[TO-3] computeTodayOverview：incidentInProgress＝1（K9）", overview.incidentInProgress === 1);
  check("[TO-3b] computeTodayOverview：riskExceptionOpen＝1（K10）", overview.riskExceptionOpen === 1);
  check("[TO-4] computeTodayOverview：stale＝1（僅 K1 dwellDays=10>=7）", overview.stale === 1);

  // ---- Hotfix 管理看板（A 區）：5 桶固定管線＋ Category B（尚未啟動新版 Workflow，
  // 但依 legacy 語意尚未結案）一律歸類到「開單／待處理」。這是本輪根因修正
  // （已建立 Hotfix 工單，但 KPI 仍顯示 0）對應的核心展示邏輯。 ----
  const stageDraft = { id: "s-draft", stageKey: "draft", label: "草稿", stageType: "SUBMISSION", assignedTeamId: null, assignedTeamName: null };
  const stageRd = { id: "s-rd", stageKey: "rdInProgress", label: "RD 修正中", stageType: "WORK", assignedTeamId: null, assignedTeamName: null };
  const stageRdLead = { id: "s-rdlead", stageKey: "pendingRdLeadApproval", label: "待 RD 主管核准", stageType: "APPROVAL", assignedTeamId: null, assignedTeamName: null };
  const stageQa = { id: "s-qa", stageKey: "qaInProgress", label: "QA 驗證中", stageType: "WORK", assignedTeamId: null, assignedTeamName: null };
  const stageOp = { id: "s-op", stageKey: "opPreparing", label: "OP 部署準備中", stageType: "WORK", assignedTeamId: null, assignedTeamName: null };
  const stageConfirm = { id: "s-conf", stageKey: "reporterConfirming", label: "開單人確認中", stageType: "CONFIRMATION", assignedTeamId: null, assignedTeamName: null };

  check("[HBH-1] hotfixBoardBucketOf：null stage（Category B）歸類「開單／待處理」", hotfixBoardBucketOf(null) === "開單／待處理");
  check("[HBH-2] hotfixBoardBucketOf：pendingRdLeadApproval 併入「RD 修正」桶", hotfixBoardBucketOf(stageRdLead) === "RD 修正");
  check("[HBH-3] hotfixBoardApprovalBadge：pendingRdLeadApproval 顯示「待 RD 主管核准」badge", hotfixBoardApprovalBadge(stageRdLead) === "待 RD 主管核准");
  check("[HBH-4] hotfixBoardApprovalBadge：一般 WORK 關卡不顯示 badge", hotfixBoardApprovalBadge(stageRd) === null);

  const hotfixBoardRows: GovernanceIssueRow[] = [
    makeRow({ id: "hb1", issueKey: "HB1", lifecycleStatus: "IN_PROGRESS", currentStage: stageDraft }),
    makeRow({ id: "hb2", issueKey: "HB2", lifecycleStatus: "IN_PROGRESS", currentStage: stageRd }),
    makeRow({ id: "hb3", issueKey: "HB3", lifecycleStatus: "IN_PROGRESS", currentStage: stageRdLead }),
    makeRow({ id: "hb4", issueKey: "HB4", lifecycleStatus: "IN_PROGRESS", currentStage: stageQa }),
    makeRow({ id: "hb5", issueKey: "HB5", lifecycleStatus: "IN_PROGRESS", currentStage: stageOp }),
    makeRow({ id: "hb6", issueKey: "HB6", lifecycleStatus: "IN_PROGRESS", currentStage: stageConfirm }),
    makeRow({ id: "hb7", issueKey: "HB7", lifecycleStatus: "IN_PROGRESS", currentStage: null }),
    makeRow({ id: "hb8", issueKey: "HB8", issueType: "RCA", lifecycleStatus: "IN_PROGRESS", currentStage: null }),
    makeRow({ id: "hb9", issueKey: "HB9", lifecycleStatus: "COMPLETED", currentStage: null }),
  ];
  check("[PWO-1] isPreWorkflowOpenIssue：hb7（IN_PROGRESS 且無 currentStage）為 true", isPreWorkflowOpenIssue(hotfixBoardRows[6]) === true);
  check("[PWO-2] isPreWorkflowOpenIssue：hb9（COMPLETED）為 false", isPreWorkflowOpenIssue(hotfixBoardRows[8]) === false);

  const board = computeHotfixBoard(hotfixBoardRows, 7);
  check("[HB-1] computeHotfixBoard：5 桶固定順序", board.map((b) => b.bucket).join(",") === "開單／待處理,RD 修正,QA 驗證,OP 上版,正式環境確認");
  check(
    "[HB-2] computeHotfixBoard：「開單／待處理」桶含 hb1（draft）與 hb7（Category B），count=2（根因修正核心案例：不得因沒有 currentStage 就漏算）",
    board.find((b) => b.bucket === "開單／待處理")?.count === 2,
  );
  check("[HB-3] computeHotfixBoard：「RD 修正」桶含 hb2＋hb3（待 RD 主管核准併入），count=2", board.find((b) => b.bucket === "RD 修正")?.count === 2);
  check("[HB-4] computeHotfixBoard：「QA 驗證」桶 count=1（hb4）", board.find((b) => b.bucket === "QA 驗證")?.count === 1);
  check("[HB-5] computeHotfixBoard：「OP 上版」桶 count=1（hb5）", board.find((b) => b.bucket === "OP 上版")?.count === 1);
  check("[HB-6] computeHotfixBoard：「正式環境確認」桶 count=1（hb6）", board.find((b) => b.bucket === "正式環境確認")?.count === 1);
  check(
    "[HB-7] computeHotfixBoard：只計入 issueType=Hotfix 且 IN_PROGRESS，hb8（RCA）／hb9（COMPLETED）不計入任何桶，各桶加總＝7＝進行中 Hotfix 數",
    board.reduce((s, b) => s + b.count, 0) === 7,
  );

  const phases = computePhaseDistribution(rows);
  check(
    "[PH-1] computePhaseDistribution：只計入 IN_PROGRESS 且有 currentStage，未落入既定分組時以 stage.label 個別呈現",
    phases.reduce((s, p) => s + p.count, 0) === 4 && phases.find((p) => p.phase === "A 關卡")?.count === 3 && phases.find((p) => p.phase === "B 關卡")?.count === 1,
  );

  const actionNeeded = computeActionNeededList(rows, 7);
  check(
    "[AN-1] computeActionNeededList：只納入 IN_PROGRESS（K4/K5/K6 排除），依「高風險 > 待核准 > 停留最久 > 重複退回 > 一般」排序（K2/K8/K9/K10 同為一般案件，穩定排序維持原陣列相對順序）",
    actionNeeded.map((r) => r.id).join(",") === "3,1,7,2,8,9,10",
  );
  check("[AN-2] deriveSuggestedAction：高風險案件建議確認風險", deriveSuggestedAction(rows.find((r) => r.id === "3")!, 7) === "確認風險項目並決定處理方式");
  check("[AN-3] deriveSuggestedAction：重複退回案件建議檢視退回原因", deriveSuggestedAction(rows.find((r) => r.id === "7")!, 7) === "檢視退回原因，避免重複退回");
  check("[AN-4] deriveSuggestedAction：一般進行中案件回傳「持續處理中」", deriveSuggestedAction(rows.find((r) => r.id === "2")!, 7) === "持續處理中");

  // ---- workflowStatus 不是權威來源：即使欄位文字具誤導性，統計仍以正式來源判斷 ----
  const misleadingRow = makeRow({ id: "8", issueKey: "K8", lifecycleStatus: "IN_PROGRESS", currentStage: stageA });
  check(
    "[11-1] 統計結果只看 GovernanceIssueRow.lifecycleStatus（由正式來源推導），與任何顯示文字無關",
    computeKpiSummary([misleadingRow]).inProgress === 1,
  );
}

function runPureFilterTests() {
  console.log("\n=== A2. filters.ts 純邏輯測試（URL 篩選輸入驗證＋KPI／下鑽一致性） ===");

  // ---- [16] URL filter validation：不合法輸入一律安全預設，不拋出例外 ----
  const garbage = parseGovernanceDashboardFilters({
    dateFrom: "not-a-date",
    dateTo: ["", "also-bad"],
    riskStatus: "'; DROP TABLE Issue; --",
    lifecycleStatus: "DELETED_ALL_DATA",
    staleDaysThreshold: "-5",
    workflowDefinitionId: "<script>alert(1)</script>",
    pendingApprovalOnly: "true",
  });
  check(
    "[16-1] parseGovernanceDashboardFilters：不合法日期／enum／天數門檻一律回傳 null，不拋出例外",
    garbage.dateFrom === null && garbage.dateTo === null && garbage.riskStatus === null && garbage.lifecycleStatus === null && garbage.staleDaysThreshold === null,
  );
  check("[16-2] parseGovernanceDashboardFilters：pendingApprovalOnly 只有明確 \"1\" 才算 true", garbage.pendingApprovalOnly === false);
  check(
    "[16-3] parseGovernanceDashboardFilters：不合法字串原樣保留於 workflowDefinitionId（只作為比對值，從不組 SQL，比對不到任何列時安全地回傳空清單）",
    garbage.workflowDefinitionId === "<script>alert(1)</script>",
  );

  const valid = parseGovernanceDashboardFilters({ staleDaysThreshold: "7", riskStatus: "YES", lifecycleStatus: "IN_PROGRESS", pendingApprovalOnly: "1" });
  check("[16-4] parseGovernanceDashboardFilters：合法輸入正確解析", valid.staleDaysThreshold === 7 && valid.riskStatus === "YES" && valid.lifecycleStatus === "IN_PROGRESS" && valid.pendingApprovalOnly === true);

  // ---- [9] KPI 下鑽結果與明細數量一致：applyGovernanceDashboardFilters 與
  //      computeKpiSummary 對同一組 rows 使用相同 predicate，數字必然一致。 ----
  const stage = { id: "s1", stageKey: "s1", label: "S1", stageType: "WORK", assignedTeamId: null, assignedTeamName: null };
  const rows: GovernanceIssueRow[] = [
    makeRow({ id: "1", issueKey: "K1", lifecycleStatus: "IN_PROGRESS", currentStage: stage, riskStatus: "YES", assignedTeamId: "team-1" }),
    makeRow({ id: "2", issueKey: "K2", lifecycleStatus: "IN_PROGRESS", currentStage: stage, riskStatus: "NONE", assignedTeamId: "team-1" }),
    makeRow({ id: "3", issueKey: "K3", lifecycleStatus: "COMPLETED", currentStage: null }),
    makeRow({ id: "4", issueKey: "K4", lifecycleStatus: "CANCELLED", currentStage: null }),
  ];
  const kpi = computeKpiSummary(rows);
  check(
    "[9-1] lifecycleStatus=IN_PROGRESS 下鑽清單筆數＝KPI 進行中數字",
    applyGovernanceDashboardFilters(rows, { ...EMPTY_FILTERS, lifecycleStatus: "IN_PROGRESS" }).length === kpi.inProgress,
  );
  check(
    "[9-2] riskStatus=YES 下鑽清單筆數＝KPI 高風險數字",
    applyGovernanceDashboardFilters(rows, { ...EMPTY_FILTERS, riskStatus: "YES" }).length === kpi.highRisk,
  );
  check(
    "[9-3] teamId 篩選筆數＝該 Team 底下的實際案件數",
    applyGovernanceDashboardFilters(rows, { ...EMPTY_FILTERS, teamId: "team-1" }).length === 2,
  );
  check(
    "[8-1] stageIds 篩選：只回傳目前階段等於指定 stage 的案件（COMPLETED/CANCELLED 無 currentStage 故排除）",
    applyGovernanceDashboardFilters(rows, { ...EMPTY_FILTERS, stageIds: ["s1"] }).length === 2,
  );
  check(
    "[8-1b] stageIds 篩選：可同時指定多個真實 WorkflowStage id（巨集階段下鑽情境）",
    applyGovernanceDashboardFilters(rows, { ...EMPTY_FILTERS, stageIds: ["s1", "does-not-exist"] }).length === 2,
  );

  // ---- [8] 日期區間篩選 ----
  const dateRows: GovernanceIssueRow[] = [
    makeRow({ id: "old", issueKey: "OLD", createdAt: new Date("2026-01-01T00:00:00Z") }),
    makeRow({ id: "new", issueKey: "NEW", createdAt: new Date("2026-06-01T00:00:00Z") }),
  ];
  check(
    "[8-2] dateFrom 篩選排除較早的案件",
    applyGovernanceDashboardFilters(dateRows, { ...EMPTY_FILTERS, dateFrom: new Date("2026-03-01T00:00:00Z") }).map((r) => r.id).join(",") === "new",
  );
  check(
    "[8-3] dateTo 篩選排除較晚的案件",
    applyGovernanceDashboardFilters(dateRows, { ...EMPTY_FILTERS, dateTo: new Date("2026-03-01T00:00:00Z") }).map((r) => r.id).join(",") === "old",
  );

  // ---- withGovernanceFilterOverride：可分享／可下鑽的 URL 組成 ----
  const href = withGovernanceFilterOverride(EMPTY_FILTERS, { riskStatus: "YES" });
  check("[6-3]/href 下鑽連結：只覆寫指定欄位，組出可分享的 /governance URL", href === "/governance?riskStatus=YES");
}

// ===========================================================================
// B. DB 整合測試
// ===========================================================================

interface Fixtures {
  userIds: string[];
  teamIds: string[];
  issueIds: string[];
  definitionIds: string[];
}

async function createUser(fx: Fixtures, name: string, role: string, opts: { noRole?: boolean; roleActive?: boolean; userActive?: boolean } = {}) {
  const user = await prisma.user.create({
    data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive: opts.userActive ?? true },
  });
  fx.userIds.push(user.id);
  if (!opts.noRole) {
    await prisma.userRole.create({ data: { userId: user.id, role, isActive: opts.roleActive ?? true } });
  }
  return user;
}

async function createTeam(fx: Fixtures, name: string) {
  const team = await prisma.team.create({ data: { name: `${RUN_TAG}-${name}` } });
  fx.teamIds.push(team.id);
  return team;
}

async function main() {
  console.log(`[assertSafeTestDatabase 已通過] 對 ${process.env.DATABASE_URL} 執行 prisma migrate deploy ...`);
  execSync("npx prisma migrate deploy", { cwd: REPO_ROOT, env: process.env, stdio: "pipe" });

  console.log("=== 治理儀表板 MVP 驗證 ===");

  runPureMetricsTests();
  runPureFilterTests();

  console.log("\n=== B. DB 整合測試 ===");

  const fx: Fixtures = { userIds: [], teamIds: [], issueIds: [], definitionIds: [] };

  try {
    const admin = await createUser(fx, "Admin", "Admin");
    const pm = await createUser(fx, "PM", "PM");
    const rd = await createUser(fx, "RD", "RD");
    const qa = await createUser(fx, "QA", "QA");
    const op = await createUser(fx, "OP", "OP");
    const sec = await createUser(fx, "Sec", "資安推動小組");
    const dms = await createUser(fx, "Dms", "DMS主管");
    const noRoleActor = await createUser(fx, "NoRole", "Admin", { noRole: true });
    const inactiveRoleActor = await createUser(fx, "InactiveRole", "PM", { roleActive: false });
    const inactiveAccountActor = await createUser(fx, "InactiveAccount", "PM", { userActive: false });

    const teamA = await createTeam(fx, "TeamA");
    const teamB = await createTeam(fx, "TeamB");

    const definition = await prisma.workflowDefinition.create({
      data: { key: `${RUN_TAG}-def`, name: "治理儀表板測試流程", issueType: "Hotfix", isActive: true, createdByUserId: admin.id },
    });
    fx.definitionIds.push(definition.id);
    const version = await prisma.workflowVersion.create({
      data: { workflowDefinitionId: definition.id, versionNo: 1, status: "PUBLISHED", publishedAt: new Date(), publishedByUserId: admin.id, createdByUserId: admin.id },
    });

    const stageTriage = await prisma.workflowStage.create({
      data: { workflowVersionId: version.id, stageKey: "triage", label: "分流關卡", stageType: "TRIAGE", sortOrder: 1, isStart: true },
    });
    const stageWork = await prisma.workflowStage.create({
      data: { workflowVersionId: version.id, stageKey: "work", label: "處理中", stageType: "WORK", sortOrder: 2, assignedTeamId: teamA.id },
    });
    const stageReview = await prisma.workflowStage.create({
      data: { workflowVersionId: version.id, stageKey: "review", label: "覆核中", stageType: "REVIEW", sortOrder: 3 },
    });
    const stageDone = await prisma.workflowStage.create({
      data: { workflowVersionId: version.id, stageKey: "done", label: "結案", stageType: "CLOSURE", sortOrder: 4, isEnd: true, terminalOutcome: "COMPLETED" },
    });
    const stageCancelled = await prisma.workflowStage.create({
      data: { workflowVersionId: version.id, stageKey: "cancelled", label: "已取消", stageType: "CLOSURE", sortOrder: 5, isEnd: true, terminalOutcome: "CANCELLED" },
    });

    const now = new Date();
    const staleEnteredAt = new Date(Date.now() - 10 * 86_400_000 - 5000);

    async function issue(key: string, data: {
      issueType?: string;
      workflowVersionId?: string | null;
      currentWorkflowStageId?: string | null;
      assignedTeamId?: string | null;
      createdAt?: Date;
      workflowStatus?: string;
    }) {
      const created = await prisma.issue.create({
        data: {
          issueKey: `${RUN_TAG}-${key}`,
          issueType: data.issueType ?? "Hotfix",
          title: `測試案件 ${key}`,
          workflowStatus: data.workflowStatus ?? "n/a",
          workflowVersionId: data.workflowVersionId ?? null,
          currentWorkflowStageId: data.currentWorkflowStageId ?? null,
          assignedTeamId: data.assignedTeamId ?? null,
          createdAt: data.createdAt ?? now,
        },
      });
      fx.issueIds.push(created.id);
      return created;
    }

    async function openHistory(issueId: string, toStageId: string, fromStageId: string | null, executedAt: Date, transitionType: "ENTERED" | "FORWARDED" | "RETURNED" = "ENTERED") {
      return prisma.issueWorkflowStageHistory.create({
        data: { issueId, toStageId, fromStageId, transitionType, actorUserId: admin.id, executedAt, exitedAt: null },
      });
    }
    async function closedHistory(issueId: string, toStageId: string, fromStageId: string | null, executedAt: Date, exitedAt: Date, transitionType: "ENTERED" | "FORWARDED" | "RETURNED" = "RETURNED") {
      return prisma.issueWorkflowStageHistory.create({
        data: { issueId, toStageId, fromStageId, transitionType, actorUserId: admin.id, executedAt, exitedAt },
      });
    }

    // [11] workflowStatus 蓄意設定成誤導文字（「已完成」），驗證統計仍以正式來源判斷
    const issueFresh = await issue("FRESH", { workflowVersionId: version.id, currentWorkflowStageId: stageTriage.id, workflowStatus: "已完成" });
    await openHistory(issueFresh.id, stageTriage.id, null, now);

    const issueStale = await issue("STALE", { workflowVersionId: version.id, currentWorkflowStageId: stageWork.id, assignedTeamId: teamA.id });
    await openHistory(issueStale.id, stageWork.id, stageTriage.id, staleEnteredAt, "FORWARDED");

    const issueCompleted = await issue("COMPLETED", { workflowVersionId: version.id, currentWorkflowStageId: stageDone.id, createdAt: new Date(Date.now() - 30 * 86_400_000) });

    const issueCancelled = await issue("CANCELLED", { workflowVersionId: version.id, currentWorkflowStageId: stageCancelled.id });

    const issuePendingApproval = await issue("PENDING", { workflowVersionId: version.id, currentWorkflowStageId: stageReview.id, assignedTeamId: teamA.id });
    await openHistory(issuePendingApproval.id, stageReview.id, stageWork.id, now, "FORWARDED");
    await prisma.approvalRecord.create({
      data: { issueId: issuePendingApproval.id, approvalType: "QA_LEAD_APPROVAL", relatedStageKey: "review", requestedByUserId: pm.id, decision: "PENDING", recordStatus: "ACTIVE" },
    });

    const issueRiskYes = await issue("RISKYES", { workflowVersionId: version.id, currentWorkflowStageId: stageWork.id, assignedTeamId: teamA.id });
    await openHistory(issueRiskYes.id, stageWork.id, stageTriage.id, now, "FORWARDED");
    await prisma.stageRiskCheck.create({
      data: { issueId: issueRiskYes.id, stageKey: "work", assessmentRound: 1, checkKey: "c1", answer: "YES", answeredByUserId: admin.id, answeredAt: now },
    });

    const issueRiskUnknown = await issue("RISKUNK", { workflowVersionId: version.id, currentWorkflowStageId: stageReview.id });
    await openHistory(issueRiskUnknown.id, stageReview.id, stageWork.id, now, "FORWARDED");
    await prisma.stageRiskCheck.create({
      data: { issueId: issueRiskUnknown.id, stageKey: "review", assessmentRound: 1, checkKey: "c1", answer: "UNKNOWN", answeredByUserId: admin.id, answeredAt: now },
    });

    const issueRiskUnanswered = await issue("RISKUNA", { workflowVersionId: version.id, currentWorkflowStageId: stageTriage.id });
    await openHistory(issueRiskUnanswered.id, stageTriage.id, null, now);
    await prisma.stageRiskCheck.create({
      data: { issueId: issueRiskUnanswered.id, stageKey: "triage", assessmentRound: 1, checkKey: "c1", answer: null },
    });

    const issueNoRiskRecord = await issue("NORISK", { workflowVersionId: version.id, currentWorkflowStageId: stageTriage.id });
    await openHistory(issueNoRiskRecord.id, stageTriage.id, null, now);

    const issueReturnedOnce = await issue("RET1", { workflowVersionId: version.id, currentWorkflowStageId: stageWork.id, assignedTeamId: teamA.id });
    await openHistory(issueReturnedOnce.id, stageWork.id, stageReview.id, now, "RETURNED");

    const issueReturnedTwice = await issue("RET2", { workflowVersionId: version.id, currentWorkflowStageId: stageWork.id, assignedTeamId: teamA.id });
    await closedHistory(issueReturnedTwice.id, stageWork.id, stageReview.id, new Date(now.getTime() - 60_000), new Date(now.getTime() - 30_000), "RETURNED");
    await openHistory(issueReturnedTwice.id, stageWork.id, stageReview.id, new Date(now.getTime() - 30_000), "RETURNED");

    const issueTeamB = await issue("TEAMB", { workflowVersionId: version.id, currentWorkflowStageId: stageTriage.id, assignedTeamId: teamB.id });
    await openHistory(issueTeamB.id, stageTriage.id, null, now);

    // workflowStatus 明確設為 "closed"（該 issueType 在 src/lib/workflow.ts
    // CLOSED_STATUS 的既有結案值）：這兩筆代表「真正已結案、沒有治理價值」的舊制案件，
    // 必須維持 LEGACY（隱藏）。若沿用 issue() 預設值 "n/a"，依本輪根因修正後的
    // deriveLifecycleStatus，會被誤判為尚未結案而變成 IN_PROGRESS——這正是撰寫本輪
    // 測試時發現的一個真實陷阱，特別留下這段註解防止之後回歸。
    const legacyIssue1 = await issue("LEGACY1", { issueType: "Hotfix", workflowStatus: "closed" });
    await prisma.approvalRecord.create({
      data: { issueId: legacyIssue1.id, approvalType: "BUSINESS_APPROVAL", relatedStageKey: "legacy", requestedByUserId: pm.id, decision: "PENDING", recordStatus: "ACTIVE" },
    });
    const legacyIssue2 = await issue("LEGACY2", { issueType: "Incident", assignedTeamId: teamA.id, workflowStatus: "closed" });

    const allIssueIds = [
      issueFresh.id, issueStale.id, issueCompleted.id, issueCancelled.id, issuePendingApproval.id,
      issueRiskYes.id, issueRiskUnknown.id, issueRiskUnanswered.id, issueNoRiskRecord.id,
      issueReturnedOnce.id, issueReturnedTwice.id, issueTeamB.id, legacyIssue1.id, legacyIssue2.id,
    ];
    check("[fixture] 共建立 14 筆測試案件", allIssueIds.length === 14);

    // ---- [12][14] 不同角色可見範圍／Admin 全域可見：既有唯一 issue.view 規則下，
    //      所有具能力角色皆看得到全部 14 筆（與 /issues 頁面既有行為一致）。 ----
    for (const [label, actor] of [
      ["PM", pm], ["RD", rd], ["QA", qa], ["OP", op], ["資安推動小組", sec], ["DMS主管", dms], ["Admin", admin],
    ] as const) {
      await checkAsync(`[12/14-${label}] ${label} 具 issue.view，可見全部 14 筆 Issue`, async () => {
        const access = await resolveGovernanceDashboardAccess(actor.id);
        const rows = await getVisibleGovernanceIssueRows(actor.id);
        return access.canView === true && rows.length === 14;
      });
    }

    // ---- [15] User.role 不能授權 ----
    await checkAsync("[15-1] User.role=\"Admin\" 但無任何 active UserRole 時 canView=false", async () => {
      const access = await resolveGovernanceDashboardAccess(noRoleActor.id);
      return access.canView === false;
    });
    await checkAsync("[15-2] UserRole 存在但 isActive=false 時 canView=false", async () => {
      const access = await resolveGovernanceDashboardAccess(inactiveRoleActor.id);
      return access.canView === false;
    });
    await checkAsync("[15-3] User.isActive=false 時（即使有 active UserRole）canView=false", async () => {
      const access = await resolveGovernanceDashboardAccess(inactiveAccountActor.id);
      return access.canView === false;
    });

    // ---- [13][19] 隱藏案件不出現在 KPI／Service 層必須重新授權：直接呼叫查詢函式
    //      （繞過任何頁面層檢查）仍會被拒絕，不會回傳任何一筆資料或部分 KPI。 ----
    await expectError(
      "[19-1] getVisibleGovernanceIssueRows 對無 issue.view 的 actor 直接拒絕（Service 層重新授權，不信任呼叫端）",
      () => getVisibleGovernanceIssueRows(noRoleActor.id),
      (e) => e instanceof GovernanceDashboardAccessDeniedError,
    );
    await expectError(
      "[13-1] buildGovernanceDashboardViewModel 對無 issue.view 的 actor 直接拒絕，不會建構出任何部分 KPI（無隱藏資料外洩）",
      () => buildGovernanceDashboardViewModel(noRoleActor.id, {}),
      (e) => e instanceof GovernanceDashboardAccessDeniedError,
    );

    // ---- ViewModel 端到端整合驗證 ----
    const viewModel = await buildGovernanceDashboardViewModel(admin.id, {});
    check("[1-6] ViewModel KPI 進行中＝10（triage4+work4+review2）", viewModel.kpi.inProgress === 10, `實際 ${viewModel.kpi.inProgress}`);
    check("[1-7] ViewModel KPI 已完成＝1", viewModel.kpi.completed === 1);
    check("[1-8] ViewModel KPI 已取消＝1", viewModel.kpi.cancelled === 1);
    check(
      "[3-3] ViewModel KPI 待核准＝1（僅新版 issuePendingApproval；legacyIssue1 的 PENDING ApprovalRecord 不得計入，舊制案件已在 viewModel 層被濾除）",
      viewModel.kpi.pendingApproval === 1,
    );
    check("[4-5] ViewModel KPI 高風險＝1", viewModel.kpi.highRisk === 1);
    check(`[7-7] ViewModel KPI 停留超過 ${DEFAULT_STALE_DAYS_THRESHOLD} 天＝1`, viewModel.kpi.stale === 1);
    check(
      "[LEGACY-1] ViewModel KPI 可見總數＝12（14 筆可見 Issue 中排除 2 筆舊制，只計已啟動新版 Workflow 的案件）",
      viewModel.kpi.totalVisible === 12,
      `實際 ${viewModel.kpi.totalVisible}`,
    );

    check("[2-3] ViewModel Stage 分布：triage=4 work=4 review=2", (() => {
      const byId = new Map(viewModel.stageDistribution.map((e) => [e.stage.id, e.count]));
      return byId.get(stageTriage.id) === 4 && byId.get(stageWork.id) === 4 && byId.get(stageReview.id) === 2;
    })());
    check("[2-4] ViewModel Stage 分布：work 關卡帶出範本預設負責 Team（TeamA）", viewModel.stageDistribution.find((e) => e.stage.id === stageWork.id)?.stage.assignedTeamName?.includes("TeamA") === true);

    check(
      "[LEGACY-2] ViewModel 風險監控：yes=1 unknown=1 unanswered=1 noRecord=9（舊制案件不得計入「尚無風險紀錄」，14 筆中 2 筆舊制已被排除）",
      viewModel.riskOverview.yes === 1 && viewModel.riskOverview.unknown === 1 && viewModel.riskOverview.unanswered === 1 && viewModel.riskOverview.noRecord === 9,
      JSON.stringify(viewModel.riskOverview),
    );

    check("[5-6] ViewModel RETURN 監控：issuesWithReturn=2 totalReturns=3 repeatedReturnIssues=1", viewModel.returnOverview.issuesWithReturn === 2 && viewModel.returnOverview.totalReturns === 3 && viewModel.returnOverview.repeatedReturnIssues === 1, JSON.stringify(viewModel.returnOverview));
    check("[5-7] ViewModel RETURN 監控：主要退回關卡聚合到 work，count=3", viewModel.returnOverview.topReturnStages.find((s) => s.stageId === stageWork.id)?.count === 3);

    check("[6-4] ViewModel Team 負載：TeamA 進行中=5 待核准=1 停留超過門檻=1（舊制 LEGACY2 不計入進行中）", (() => {
      const teamAEntry = viewModel.teamWorkload.find((t) => t.teamId === teamA.id);
      return teamAEntry?.inProgress === 5 && teamAEntry?.pendingApproval === 1 && teamAEntry?.stale === 1;
    })(), JSON.stringify(viewModel.teamWorkload));
    check("[6-5] ViewModel Team 負載：TeamB 進行中=1", viewModel.teamWorkload.find((t) => t.teamId === teamB.id)?.inProgress === 1);

    check("[7-8] ViewModel 流程瓶頸：門檻 1/3/7 各 1 件，14 天 0 件", viewModel.bottleneck.thresholdCounts[1] === 1 && viewModel.bottleneck.thresholdCounts[7] === 1 && viewModel.bottleneck.thresholdCounts[14] === 0);
    check("[7-9] ViewModel 流程瓶頸：停留最久案件第一筆為 issueStale", viewModel.bottleneck.longestDwelling[0]?.id === issueStale.id);

    check(
      "[LEGACY-3] ViewModel 案件清單完全不含舊制案件（治理儀表板不顯示「舊制／歷史案件」區塊，也不在任何查詢結果中出現）",
      !viewModel.issueList.some((r) => r.id === legacyIssue1.id || r.id === legacyIssue2.id) &&
        viewModel.issueList.every((r) => r.lifecycleStatus !== "LEGACY"),
    );
    check(
      "[LEGACY-4] ViewModel 現在需要處理清單完全不含舊制案件",
      !viewModel.actionNeeded.some((r) => r.id === legacyIssue1.id || r.id === legacyIssue2.id),
    );
    check(
      "[LEGACY-5] ViewModel 篩選選項不含只有舊制案件才有的 issueType（Incident，僅 legacyIssue2 持有）",
      !viewModel.filterOptions.issueTypes.includes("Incident"),
    );

    check("[11-2] issueFresh.workflowStatus 為誤導文字「已完成」，但 lifecycleStatus 仍判定為 IN_PROGRESS（不採信 workflowStatus）", viewModel.issueList.find((r) => r.id === issueFresh.id)?.lifecycleStatus === "IN_PROGRESS");

    // ---- [8][9] 篩選＋下鑽一致性（對照實際 UI 下鑽連結會加上的篩選組合） ----
    await checkAsync("[8-4] workflowDefinitionId 篩選：在已排除舊制案件的 12 筆治理範圍內正確篩選（12 筆皆屬同一 WorkflowDefinition）", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { workflowDefinitionId: definition.id });
      return vm.issueList.length === 12;
    });
    await checkAsync(
      "[LEGACY-6] issueType 篩選：即使明確篩選「Incident」（僅舊制 legacyIssue2 持有此 issueType），也回傳 0 筆——舊制案件無法透過任何篩選條件被找出",
      async () => {
        const vm = await buildGovernanceDashboardViewModel(admin.id, { issueType: "Incident" });
        return vm.issueList.length === 0;
      },
    );
    // ---- [EMPTY-1] 0 筆資料時 ViewModel 仍是完整、格式正確的結構（不塌陷成
    //      null／undefined／缺欄位），對照 page.tsx 不得因此整頁 return 單一空白訊息
    //      ——這是本輪修正的核心 Bug（UI 收斂後曾經因為 governedRows.length===0 就把
    //      整個 /governance 換成一則「尚無資料」訊息，KPI／篩選器／所有區塊全部消失）。 ----
    await checkAsync(
      "[EMPTY-1] 篩選成 0 筆（governedRows 為空）時，ViewModel 每個統計欄位仍是完整、正確的 0 值／空陣列結構，不拋出例外、不缺欄位",
      async () => {
        const vm = await buildGovernanceDashboardViewModel(admin.id, { issueType: "Incident" });
        return (
          vm.issueList.length === 0 &&
          vm.kpi.totalVisible === 0 &&
          vm.kpi.inProgress === 0 &&
          vm.todayOverview.hotfixInProgress === 0 &&
          vm.todayOverview.rcaInProgress === 0 &&
          vm.todayOverview.incidentInProgress === 0 &&
          vm.todayOverview.riskExceptionOpen === 0 &&
          vm.hotfixBoard.every((b) => b.count === 0) &&
          vm.rcaEntries.length === 0 &&
          vm.incidentEntries.length === 0 &&
          vm.phaseDistribution.length === 0 &&
          vm.stageDistribution.length === 0 &&
          vm.riskOverview.yes === 0 &&
          vm.riskOverview.unknown === 0 &&
          vm.riskOverview.unanswered === 0 &&
          vm.riskOverview.noRecord === 0 &&
          vm.returnOverview.totalReturns === 0 &&
          vm.teamWorkload.length === 0 &&
          vm.actionNeeded.length === 0 &&
          Array.isArray(vm.filterOptions.issueTypes)
        );
      },
    );
    await checkAsync("[8-6] dateTo 篩選：只回傳 30 天前建立的 issueCompleted", async () => {
      const cutoff = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
      const vm = await buildGovernanceDashboardViewModel(admin.id, { dateTo: cutoff });
      return vm.issueList.length === 1 && vm.issueList[0].id === issueCompleted.id;
    });
    await checkAsync("[9-4] 下鑽 teamId+lifecycleStatus=IN_PROGRESS 筆數＝Team 負載卡片顯示的進行中數字", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { teamId: teamA.id, lifecycleStatus: "IN_PROGRESS" });
      const teamAEntry = viewModel.teamWorkload.find((t) => t.teamId === teamA.id);
      return vm.issueList.length === teamAEntry?.inProgress;
    });
    await checkAsync("[9-5] 下鑽 teamId+pendingApprovalOnly 筆數＝Team 負載卡片顯示的待核准數字", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { teamId: teamA.id, pendingApprovalOnly: "1" });
      const teamAEntry = viewModel.teamWorkload.find((t) => t.teamId === teamA.id);
      return vm.issueList.length === teamAEntry?.pendingApproval;
    });
    await checkAsync("[9-6] 下鑽 riskStatus=YES 筆數＝風險監控卡片顯示的高風險數字", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { riskStatus: "YES" });
      return vm.issueList.length === viewModel.riskOverview.yes;
    });
    await checkAsync("[9-7] 下鑽 repeatedReturnOnly 筆數＝RETURN 監控卡片顯示的重複 RETURN 數字", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { repeatedReturnOnly: "1" });
      return vm.issueList.length === viewModel.returnOverview.repeatedReturnIssues;
    });
    await checkAsync(
      "[LEGACY-7] getVisibleGovernanceIssueRows（存取層）仍完整回傳舊制案件（14 筆，含 legacyIssue1／legacyIssue2）——舊制案件只是治理儀表板選擇不顯示，不是資料被刪除或不可見；仍可在 /issues 一般工單清單查閱",
      async () => {
        const rows = await getVisibleGovernanceIssueRows(admin.id);
        return rows.length === 14 && rows.some((r) => r.id === legacyIssue1.id) && rows.some((r) => r.id === legacyIssue2.id);
      },
    );

    // ---- [16] 空資料畫面（DB 層級）：無 issue.view 的 actor 觸發存取拒絕；有 issue.view
    //      但篩選成 0 筆時仍正常回傳完整結構，不拋出例外（真正「完全無案件」情境已由
    //      A1 節純邏輯測試 computeXxx([]) 與上方 [EMPTY-1] 覆蓋）。 ----
    await checkAsync("[17-9] 篩選成 0 筆時，issueList 為空陣列且不拋出例外", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { issueType: "不存在的類型" });
      return vm.issueList.length === 0;
    });

    // =========================================================================
    // Hotfix 數量動態驗證（根因修正第四輪，第一節）：實際對資料庫寫入／更新資料，
    // 每一步都重新呼叫 buildGovernanceDashboardViewModel 取得最新 KPI，逐步比對
    // 「建立前 → 建立後」的差異，證明 KPI 與清單筆數即時同步、不是快取的舊數字。
    // =========================================================================
    console.log("\n=== D. Hotfix KPI 動態驗證（建立／完成／取消 Hotfix 後即時重新計算） ===");

    const baseline0 = await buildGovernanceDashboardViewModel(admin.id, {});
    const baselineHotfix = baseline0.todayOverview.hotfixInProgress;
    const baselineBoardTotal = baseline0.hotfixBoard.reduce((s, b) => s + b.count, 0);
    check("[DYN-0] 前置檢查：進行中 Hotfix KPI 與 Hotfix 管理看板各桶加總一致（下鑽一致性）", baselineHotfix === baselineBoardTotal, `KPI=${baselineHotfix} 看板加總=${baselineBoardTotal}`);

    // ---- 1. 建立一筆新版進行中 Hotfix：KPI +1，清單 +1 ----
    const newVersionedHotfix = await issue("DYN-NEWWF", { workflowVersionId: version.id, currentWorkflowStageId: stageTriage.id });
    const afterNewVersioned = await buildGovernanceDashboardViewModel(admin.id, {});
    check(
      "[DYN-1] 建立一筆新版進行中 Hotfix 後，KPI 立即 +1",
      afterNewVersioned.todayOverview.hotfixInProgress === baselineHotfix + 1,
      `建立前 ${baselineHotfix}，建立後 ${afterNewVersioned.todayOverview.hotfixInProgress}`,
    );
    check(
      "[DYN-1b] 建立一筆新版進行中 Hotfix 後，issueList 清單同步 +1 且含該筆",
      afterNewVersioned.issueList.length === baseline0.issueList.length + 1 && afterNewVersioned.issueList.some((r) => r.id === newVersionedHotfix.id),
    );

    // ---- 2. 建立一筆「尚未啟動新版 Workflow、但依 legacy 語意尚未結案」的 Hotfix
    //      （根因修正對應的真實案例：已建立 Hotfix 工單，但 KPI 曾經顯示 0）：
    //      KPI +1，且出現在 Hotfix 管理看板「開單／待處理」桶。 ----
    const newPreWorkflowHotfix = await prisma.issue.create({
      data: { issueKey: `${RUN_TAG}-DYN-PREWF`, issueType: "Hotfix", title: "動態驗證：尚未啟動新版 Workflow 的 Hotfix", workflowStatus: "opened" },
    });
    fx.issueIds.push(newPreWorkflowHotfix.id);
    const afterPreWorkflow = await buildGovernanceDashboardViewModel(admin.id, {});
    check(
      "[DYN-2] 建立一筆尚未啟動新版 Workflow、但尚未結案的 Hotfix 後，KPI 立即 +1（根因修正核心案例）",
      afterPreWorkflow.todayOverview.hotfixInProgress === baselineHotfix + 2,
      `實際 ${afterPreWorkflow.todayOverview.hotfixInProgress}`,
    );
    check(
      "[DYN-2b] 該筆出現在 Hotfix 管理看板「開單／待處理」桶",
      afterPreWorkflow.hotfixBoard.find((b) => b.bucket === "開單／待處理")?.preview.some((r) => r.id === newPreWorkflowHotfix.id) ||
        (afterPreWorkflow.hotfixBoard.find((b) => b.bucket === "開單／待處理")!.count > 4 &&
          afterPreWorkflow.issueList.find((r) => r.id === newPreWorkflowHotfix.id)?.currentStage === null),
    );

    // ---- 3. 建立一般（非 Hotfix）工單：Hotfix KPI 不得增加 ----
    const genericIssue = await issue("DYN-GENERIC", { issueType: "QaVerification", workflowVersionId: null, workflowStatus: "testing" });
    const afterGeneric = await buildGovernanceDashboardViewModel(admin.id, {});
    check(
      "[DYN-3] 建立一般（非 Hotfix）工單後，Hotfix KPI 不變",
      afterGeneric.todayOverview.hotfixInProgress === baselineHotfix + 2,
      `實際 ${afterGeneric.todayOverview.hotfixInProgress}`,
    );
    void genericIssue;

    // ---- 4. 完成 Hotfix（新版案件轉移到終態 COMPLETED 關卡）：KPI -1 ----
    await prisma.issue.update({ where: { id: newVersionedHotfix.id }, data: { currentWorkflowStageId: stageDone.id } });
    const afterCompleted = await buildGovernanceDashboardViewModel(admin.id, {});
    check(
      "[DYN-4] 完成 Hotfix（轉移到 isEnd=true／terminalOutcome=COMPLETED 的關卡）後，KPI -1",
      afterCompleted.todayOverview.hotfixInProgress === baselineHotfix + 1,
      `實際 ${afterCompleted.todayOverview.hotfixInProgress}`,
    );

    // ---- 5. 取消 Hotfix（Category B 案件依 legacy 語意結案）：KPI -1 ----
    await prisma.issue.update({ where: { id: newPreWorkflowHotfix.id }, data: { workflowStatus: "closed", closedAt: new Date() } });
    const afterCancelled = await buildGovernanceDashboardViewModel(admin.id, {});
    check(
      "[DYN-5] 取消／結案尚未啟動新版 Workflow 的 Hotfix（workflowStatus 改為 legacy 模型的 closed 值）後，KPI -1",
      afterCancelled.todayOverview.hotfixInProgress === baselineHotfix,
      `實際 ${afterCancelled.todayOverview.hotfixInProgress}`,
    );

    // ---- 6. 使用者不可見的 Hotfix：無 issue.view 能力的 actor 完全看不到（不出現在
    //      KPI 或清單），沿用既有唯一可見性規則（issue.view 全有全無，見 access.ts）。----
    await expectError(
      "[DYN-6] 無 issue.view 能力的 actor 呼叫 buildGovernanceDashboardViewModel 直接拒絕，任何 Hotfix（含剛建立的）皆不可見",
      () => buildGovernanceDashboardViewModel(noRoleActor.id, {}),
      (e) => e instanceof GovernanceDashboardAccessDeniedError,
    );

    // ---- 7. KPI 數字必須等於 Hotfix 管理看板各桶加總（下鑽一致性，用最終狀態再驗一次）----
    const finalBoardTotal = afterCancelled.hotfixBoard.reduce((s, b) => s + b.count, 0);
    check(
      "[DYN-7] 最終狀態：進行中 Hotfix KPI 與 Hotfix 管理看板各桶加總一致",
      afterCancelled.todayOverview.hotfixInProgress === finalBoardTotal,
      `KPI=${afterCancelled.todayOverview.hotfixInProgress} 看板加總=${finalBoardTotal}`,
    );
  } finally {
    console.log("\n=== 清理測試 Fixture ===");
    const steps: [string, () => Promise<unknown>][] = [
      ["StageRiskCheck", () => prisma.stageRiskCheck.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
      ["ApprovalRecord", () => prisma.approvalRecord.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
      ["IssueWorkflowStageHistory", () => prisma.issueWorkflowStageHistory.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
      ["Issue", () => prisma.issue.deleteMany({ where: { id: { in: fx.issueIds } } })],
      [
        "WorkflowStage",
        async () => {
          const versions = await prisma.workflowVersion.findMany({ where: { workflowDefinitionId: { in: fx.definitionIds } }, select: { id: true } });
          return prisma.workflowStage.deleteMany({ where: { workflowVersionId: { in: versions.map((v) => v.id) } } });
        },
      ],
      ["WorkflowVersion", () => prisma.workflowVersion.deleteMany({ where: { workflowDefinitionId: { in: fx.definitionIds } } })],
      ["WorkflowDefinition", () => prisma.workflowDefinition.deleteMany({ where: { id: { in: fx.definitionIds } } })],
      ["TeamMember", () => prisma.teamMember.deleteMany({ where: { teamId: { in: fx.teamIds } } })],
      ["Team", () => prisma.team.deleteMany({ where: { id: { in: fx.teamIds } } })],
      ["UserRole", () => prisma.userRole.deleteMany({ where: { userId: { in: fx.userIds } } })],
      ["User", () => prisma.user.deleteMany({ where: { id: { in: fx.userIds } } })],
    ];
    for (const [label, fn] of steps) {
      try {
        await fn();
      } catch (e) {
        console.warn(`cleanup ${label} 失敗：`, e);
      }
    }
  }

  runStaticSourceChecks();

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  await prisma.$disconnect();

  if (failCount > 0 || skipCount > 0) {
    process.exit(1);
  }
}

// ===========================================================================
// C. 原始碼層級靜態檢查
// ===========================================================================

function listFilesRecursive(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) results.push(full);
    }
  };
  walk(dir);
  return results;
}

// 移除註解後再比對，避免文件化「本模組刻意不讀取 workflowStatus」的說明文字本身
// 被誤判為違規（本檢查要的是程式碼層級不出現該欄位存取，不是禁止在註解中提及它）。
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function runStaticSourceChecks() {
  console.log("\n=== C. 原始碼層級靜態檢查（UI／Prisma 邊界、Client Component 邊界、workflowStatus） ===");

  const uiFiles = [
    ...listFilesRecursive(path.join(REPO_ROOT, "src/app/governance"), [".ts", ".tsx"]),
    ...listFilesRecursive(path.join(REPO_ROOT, "src/components/governance-dashboard"), [".ts", ".tsx"]),
  ];
  // 第四輪四區塊改版後精簡為 page.tsx + 5 個區塊元件（TopKpiRow／HotfixBoard／
  // RcaCapaTracker／IncidentStatusBoard／QuarterlyReleaseOverview），門檻相應下修。
  check("[18-0] 治理儀表板 UI 檔案確實存在（非空殼）", uiFiles.length >= 5);

  let prismaImportViolation: string | null = null;
  for (const file of uiFiles) {
    const src = fs.readFileSync(file, "utf8");
    if (/@prisma\/client/.test(src) || /from\s*["']@\/lib\/prisma["']/.test(src)) {
      prismaImportViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[18-1] UI／Page（src/app/governance、src/components/governance-dashboard）沒有任何檔案直接 import Prisma", prismaImportViolation === null, prismaImportViolation ?? undefined);

  const libDir = path.join(REPO_ROOT, "src/lib/governance-dashboard");
  const libFiles = listFilesRecursive(libDir, [".ts"]);

  // 唯一被授權讀取 workflowStatus 的地方：queries.ts 的 isPreWorkflowIssueClosed／
  // deriveLifecycleStatus，只用來判斷「尚未啟動新版 Workflow 的案件依既有 legacy
  // 語意是否已結案」（第三輪根因修正：workflowVersionId=null 不得一律視為舊制／隱藏），
  // 完全不涉及新版案件的權威狀態判斷。這裡只是把這個已知、有註解說明的例外從掃描來源
  // 中排除，其餘任何檔案／任何其他位置出現 workflowStatus 一律仍是違規。
  function stripSanctionedPreWorkflowClosedCheck(src: string): string {
    return src
      .replace(/function derivePreWorkflowFacts[\s\S]*?\n\}\n/, "")
      .replace(/\s*workflowStatus: string;/g, "")
      .replace(/derivePreWorkflowFacts\(issue\)/g, "({ closed: true, statusLabel: \"\" })");
  }

  let workflowStatusViolation: string | null = null;
  for (const file of libFiles) {
    let src = stripComments(fs.readFileSync(file, "utf8"));
    if (path.basename(file) === "queries.ts") src = stripSanctionedPreWorkflowClosedCheck(src);
    if (/workflowStatus/.test(src)) {
      workflowStatusViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check(
    "[11-3] src/lib/governance-dashboard/* 程式碼層級完全不出現 workflowStatus 欄位存取，唯一例外是 queries.ts 的 derivePreWorkflowFacts（判斷尚未版本化案件的 legacy 結案語意與顯示標籤，不涉及新版案件權威狀態；註解中的說明文字不算違規）",
    workflowStatusViolation === null,
    workflowStatusViolation ?? undefined,
  );

  let stageEnteredAtViolation: string | null = null;
  for (const file of libFiles) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    if (/stageEnteredAt/.test(src)) {
      stageEnteredAtViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[7-10] src/lib/governance-dashboard/* 程式碼層級不使用 Issue.stageEnteredAt（M1 相容欄位）推算停留天數（註解中的說明文字不算違規）", stageEnteredAtViolation === null, stageEnteredAtViolation ?? undefined);

  // ---- 治理儀表板整個模組必須是唯讀的：隱藏舊制案件是「查詢層不回傳」，絕不能是
  // 「順手把資料改掉」。任何 .create(/.update(/.upsert(/.delete(/.updateMany(/.deleteMany(
  // 呼叫都視為違規（stripComments 後比對，避免文件化的說明文字誤判）。 ----
  const mutatingCallPattern = /\.(create|update|upsert|delete|updateMany|deleteMany)\s*\(/;
  let mutationViolation: string | null = null;
  for (const file of libFiles) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    if (mutatingCallPattern.test(src)) {
      mutationViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check(
    "[LEGACY-8] src/lib/governance-dashboard/* 完全不呼叫任何 Prisma 寫入方法（create／update／upsert／delete 系列），治理儀表板對既有資料（含舊制案件）一律唯讀，隱藏舊制案件不得靠修改或補寫資料達成",
    mutationViolation === null,
    mutationViolation ?? undefined,
  );

  const serverOnlyImportPattern = /from\s*["']@\/lib\/(prisma|governanceDashboardService)["']|from\s*["']@\/lib\/governance-dashboard\/(queries|access|viewModel)["']/;
  let clientBoundaryViolation: string | null = null;
  const componentFiles = listFilesRecursive(path.join(REPO_ROOT, "src/components/governance-dashboard"), [".tsx"]);
  for (const file of componentFiles) {
    const src = fs.readFileSync(file, "utf8");
    const isClientComponent = /^\s*["']use client["']/.test(src);
    if (isClientComponent && serverOnlyImportPattern.test(src)) {
      clientBoundaryViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check(
    "[20-1] 沒有任何 \"use client\" 元件 import 伺服端專用模組（prisma／governanceDashboardService／queries／access／viewModel）",
    clientBoundaryViolation === null,
    clientBoundaryViolation ?? undefined,
  );

  // 第四輪四區塊改版移除了唯一的 Client Component（GovernanceFilters，篩選列 UI
  // 已隨版面改版移除），治理儀表板目前應全數為 Server Component。
  const clientComponentCount = componentFiles.filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8"))).length;
  check("[20-2] 治理儀表板元件全數為 Server Component（0 個 Client Component）", clientComponentCount === 0);

  const queriesSrc = fs.readFileSync(path.join(libDir, "queries.ts"), "utf8");
  check("[19-2] queries.ts 的可見性查詢函式呼叫 requireGovernanceDashboardAccess（服務層現場重新授權）", /requireGovernanceDashboardAccess/.test(queriesSrc));

  // ---- UI 收斂驗收：唯一正式入口／舊 route redirect／正式畫面不得出現 MVP／Mock 字樣 ----
  const navSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/Nav.tsx"), "utf8");
  check("[NAV-1] Nav 只有一個治理儀表板入口，指向 /governance", /href:\s*"\/governance",\s*label:\s*"治理儀表板"/.test(navSrc));
  check("[NAV-2] Nav 不再出現 /dashboard 入口", !/href:\s*"\/dashboard"/.test(navSrc));

  const dashboardPageSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/dashboard/page.tsx"), "utf8");
  check("[REDIRECT-1] 舊 /dashboard 路由改為 redirect 至 /governance", /redirect\(\s*"\/governance"\s*\)/.test(dashboardPageSrc));

  const noMvpMockScanFiles = [
    ...uiFiles,
    path.join(REPO_ROOT, "src/components/Nav.tsx"),
    path.join(REPO_ROOT, "src/app/dashboard/page.tsx"),
  ];
  let mvpTextViolation: string | null = null;
  let mockTextViolation: string | null = null;
  for (const file of noMvpMockScanFiles) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    if (mvpTextViolation === null && /MVP/.test(src)) mvpTextViolation = path.relative(REPO_ROOT, file);
    if (mockTextViolation === null && /Mock/.test(src)) mockTextViolation = path.relative(REPO_ROOT, file);
  }
  check("[UI-1] 治理儀表板 UI 程式碼（不含註解）不出現「MVP」字樣", mvpTextViolation === null, mvpTextViolation ?? undefined);
  check("[UI-2] 治理儀表板 UI 程式碼（不含註解）不出現「Mock」字樣（不得顯示 Mock AI 摘要）", mockTextViolation === null, mockTextViolation ?? undefined);

  // ---- 回歸鎖定：/governance 不得再出現「0 筆新版案件就整頁替換成單一空白訊息」
  // 這個 Bug。EmptyDashboardState 曾經是造成整頁塌陷的元件（page.tsx 對
  // hasAnyVisibleIssue===false 提早 return 一個只含 EmptyDashboardState 的畫面）；
  // 現在 hasAnyVisibleIssue 欄位已整個移除，page.tsx 也不該再 import
  // EmptyDashboardState 本身（各子元件各自處理自己的空狀態，不透過頁面層級的
  // 單一大区块取代）。 ----
  const pageSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/governance/page.tsx"), "utf8");
  check(
    "[EMPTY-2] /governance page.tsx 不再 import EmptyDashboardState（防止重新引入整頁空白 early return）",
    !/EmptyDashboardState/.test(pageSrc),
  );
  check(
    "[EMPTY-3] /governance page.tsx 不出現已移除的 hasAnyVisibleIssue 欄位（防止重新引入整頁 early return 的判斷依據）",
    !/hasAnyVisibleIssue/.test(stripComments(pageSrc)),
  );
  const viewModelSrc = fs.readFileSync(path.join(libDir, "viewModel.ts"), "utf8");
  check(
    "[EMPTY-4] viewModel.ts 不再輸出 hasAnyVisibleIssue 欄位",
    !/hasAnyVisibleIssue/.test(viewModelSrc),
  );

  // ---- 四區塊治理管理看板版型驗收：page.tsx 確實組出 A／B／C／D 四區塊＋頂部 5
  // KPI，不是又退回單一長列表版型。 ----
  check(
    "[BOARD-1] /governance page.tsx 匯入頂部 KPI 列與 A／B／C／D 四區塊元件",
    ["TopKpiRow", "HotfixBoard", "RcaCapaTracker", "IncidentStatusBoard", "QuarterlyReleaseOverview"].every((name) => pageSrc.includes(name)),
  );
  check(
    "[BOARD-2] 四區塊元件檔案確實存在",
    ["HotfixBoard.tsx", "RcaCapaTracker.tsx", "IncidentStatusBoard.tsx", "QuarterlyReleaseOverview.tsx", "TopKpiRow.tsx"].every((name) =>
      fs.existsSync(path.join(REPO_ROOT, "src/components/governance-dashboard", name)),
    ),
  );
}

main().catch(async (err) => {
  console.error("governance_dashboard-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
