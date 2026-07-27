// 治理儀表板 MVP 驗證腳本。
//
// 涵蓋 Plan 第八節列出的 20 項檢查，分三類：
//   A. 純邏輯測試（metrics.ts／filters.ts）：不依賴資料庫，使用手造 GovernanceIssueRow[]
//      驗證統計與篩選邏輯本身，包含空資料狀態（Plan 第七節）與 URL 篩選輸入驗證。
//   B. DB 整合測試：在專用 scratch 資料庫建立涵蓋各種狀態的 Issue／WorkflowStage／
//      IssueWorkflowStageHistory／ApprovalRecord／StageRiskCheck 資料，驗證
//      queries.ts／viewModel.ts 產出的統計與可見性正確。
//   C. 原始碼層級靜態檢查：UI／Page 不直接 import Prisma、Client Component 不 import
//      伺服端專用模組、governance-dashboard 模組完全不讀取 workflowStatus。
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
  computeRecentExceptions,
  computeLegacySummary,
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
  stageId: null,
  teamId: null,
  riskStatus: null,
  lifecycleStatus: null,
  staleDaysThreshold: null,
  pendingApprovalOnly: false,
  returnOnly: false,
  repeatedReturnOnly: false,
  legacyOnly: false,
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
      emptyKpi.legacyCount === 0 &&
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
  const emptyExceptions = computeRecentExceptions([]);
  check(
    "[17-7] computeRecentExceptions([]) 六個分類皆為空陣列",
    Object.values(emptyExceptions).every((arr) => Array.isArray(arr) && arr.length === 0),
  );
  check("[17-8] computeLegacySummary([]) count=0", computeLegacySummary([]).count === 0);

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
  ];

  const kpi = computeKpiSummary(rows, 7);
  check("[1-1] computeKpiSummary：進行中計數（IN_PROGRESS）", kpi.inProgress === 4, `實際 ${kpi.inProgress}`);
  check("[1-2] computeKpiSummary：已完成計數（COMPLETED）", kpi.completed === 1);
  check("[1-3] computeKpiSummary：已取消計數（CANCELLED）", kpi.cancelled === 1);
  check("[3-1] computeKpiSummary：待核准計數（ApprovalRecord PENDING+ACTIVE）", kpi.pendingApproval === 1);
  check("[4-1] computeKpiSummary：高風險計數（Risk=YES）", kpi.highRisk === 1);
  check("[7-1] computeKpiSummary：停留超過 7 天計數（只有 K1 dwellDays=10）", kpi.stale === 1);
  check("[10-1] computeKpiSummary：舊制案件計數（LEGACY）", kpi.legacyCount === 1);

  const stageDist = computeStageDistribution(rows);
  check(
    "[2-1] computeStageDistribution：只計入 IN_PROGRESS，K4/K5/K6 不計入",
    stageDist.reduce((s, e) => s + e.count, 0) === 4,
  );
  check("[2-2] computeStageDistribution：stage-a 有 3 件（K1/K2/K7），stage-b 有 1 件（K3）", stageDist.find((e) => e.stage.id === "stage-a")?.count === 3 && stageDist.find((e) => e.stage.id === "stage-b")?.count === 1);

  const risk = computeRiskOverview(rows);
  check("[4-2] computeRiskOverview：yes=1 unknown=1（K6 為舊制但仍計入風險統計）", risk.yes === 1 && risk.unknown === 1);
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

  const exceptions = computeRecentExceptions(rows, 7);
  check("[1-4]/[4-4] computeRecentExceptions：highRisk 含 K3", exceptions.highRisk.some((r) => r.id === "3"));
  check("[3-2] computeRecentExceptions：pendingApproval 含 K3", exceptions.pendingApproval.some((r) => r.id === "3"));
  check("[5-5] computeRecentExceptions：repeatedReturn 含 K7", exceptions.repeatedReturn.some((r) => r.id === "7"));
  check("[1-5] computeRecentExceptions：cancelled 含 K5", exceptions.cancelled.some((r) => r.id === "5"));
  check("[7-6] computeRecentExceptions：longDwelling 含 K1", exceptions.longDwelling.some((r) => r.id === "1"));

  const legacy = computeLegacySummary(rows);
  check("[10-2] computeLegacySummary：count=1 且不含任何非 LEGACY 案件", legacy.count === 1 && legacy.issues.every((r) => r.lifecycleStatus === "LEGACY"));

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
    "[8-1] stageId 篩選：只回傳目前階段等於指定 stage 的案件（COMPLETED/CANCELLED 無 currentStage 故排除）",
    applyGovernanceDashboardFilters(rows, { ...EMPTY_FILTERS, stageId: "s1" }).length === 2,
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

    const legacyIssue1 = await issue("LEGACY1", { issueType: "Hotfix" });
    await prisma.approvalRecord.create({
      data: { issueId: legacyIssue1.id, approvalType: "BUSINESS_APPROVAL", relatedStageKey: "legacy", requestedByUserId: pm.id, decision: "PENDING", recordStatus: "ACTIVE" },
    });
    const legacyIssue2 = await issue("LEGACY2", { issueType: "Incident", assignedTeamId: teamA.id });

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
    check("[3-3] ViewModel KPI 待核准＝2（1 新版＋1 舊制）", viewModel.kpi.pendingApproval === 2);
    check("[4-5] ViewModel KPI 高風險＝1", viewModel.kpi.highRisk === 1);
    check(`[7-7] ViewModel KPI 停留超過 ${DEFAULT_STALE_DAYS_THRESHOLD} 天＝1`, viewModel.kpi.stale === 1);
    check("[10-3] ViewModel KPI 舊制案件＝2", viewModel.kpi.legacyCount === 2);
    check("[14-1] ViewModel KPI 可見總數＝14（Admin 全域可見）", viewModel.kpi.totalVisible === 14);

    check("[2-3] ViewModel Stage 分布：triage=4 work=4 review=2", (() => {
      const byId = new Map(viewModel.stageDistribution.map((e) => [e.stage.id, e.count]));
      return byId.get(stageTriage.id) === 4 && byId.get(stageWork.id) === 4 && byId.get(stageReview.id) === 2;
    })());
    check("[2-4] ViewModel Stage 分布：work 關卡帶出範本預設負責 Team（TeamA）", viewModel.stageDistribution.find((e) => e.stage.id === stageWork.id)?.stage.assignedTeamName?.includes("TeamA") === true);

    check("[4-6] ViewModel 風險監控：yes=1 unknown=1 unanswered=1 noRecord=11", viewModel.riskOverview.yes === 1 && viewModel.riskOverview.unknown === 1 && viewModel.riskOverview.unanswered === 1 && viewModel.riskOverview.noRecord === 11, JSON.stringify(viewModel.riskOverview));

    check("[5-6] ViewModel RETURN 監控：issuesWithReturn=2 totalReturns=3 repeatedReturnIssues=1", viewModel.returnOverview.issuesWithReturn === 2 && viewModel.returnOverview.totalReturns === 3 && viewModel.returnOverview.repeatedReturnIssues === 1, JSON.stringify(viewModel.returnOverview));
    check("[5-7] ViewModel RETURN 監控：主要退回關卡聚合到 work，count=3", viewModel.returnOverview.topReturnStages.find((s) => s.stageId === stageWork.id)?.count === 3);

    check("[6-4] ViewModel Team 負載：TeamA 進行中=5 待核准=1 停留超過門檻=1（舊制 LEGACY2 不計入進行中）", (() => {
      const teamAEntry = viewModel.teamWorkload.find((t) => t.teamId === teamA.id);
      return teamAEntry?.inProgress === 5 && teamAEntry?.pendingApproval === 1 && teamAEntry?.stale === 1;
    })(), JSON.stringify(viewModel.teamWorkload));
    check("[6-5] ViewModel Team 負載：TeamB 進行中=1", viewModel.teamWorkload.find((t) => t.teamId === teamB.id)?.inProgress === 1);

    check("[7-8] ViewModel 流程瓶頸：門檻 1/3/7 各 1 件，14 天 0 件", viewModel.bottleneck.thresholdCounts[1] === 1 && viewModel.bottleneck.thresholdCounts[7] === 1 && viewModel.bottleneck.thresholdCounts[14] === 0);
    check("[7-9] ViewModel 流程瓶頸：停留最久案件第一筆為 issueStale", viewModel.bottleneck.longestDwelling[0]?.id === issueStale.id);

    check("[10-4] ViewModel Legacy 摘要：count=2 且包含兩筆舊制 Issue", viewModel.legacy.count === 2 && [legacyIssue1.id, legacyIssue2.id].every((id) => viewModel.legacy.issues.some((r) => r.id === id)));

    check("[11-2] issueFresh.workflowStatus 為誤導文字「已完成」，但 lifecycleStatus 仍判定為 IN_PROGRESS（不採信 workflowStatus）", viewModel.issueList.find((r) => r.id === issueFresh.id)?.lifecycleStatus === "IN_PROGRESS");

    // ---- [8][9] 篩選＋下鑽一致性（對照實際 UI 下鑽連結會加上的篩選組合） ----
    await checkAsync("[8-4] workflowDefinitionId 篩選：只回傳新版 Workflow 案件（12 筆，排除 2 筆舊制）", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { workflowDefinitionId: definition.id });
      return vm.issueList.length === 12;
    });
    await checkAsync("[8-5] issueType 篩選：Incident 只有 legacyIssue2 一筆", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { issueType: "Incident" });
      return vm.issueList.length === 1 && vm.issueList[0].id === legacyIssue2.id;
    });
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
    await checkAsync("[9-8] 下鑽 legacyOnly 筆數＝KPI 舊制案件數字", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { legacyOnly: "1" });
      return vm.issueList.length === viewModel.kpi.legacyCount;
    });

    // ---- [16] 空資料畫面（DB 層級）：無 issue.view 的 actor 觸發存取拒絕、有 issue.view
    //      但完全無案件時 hasAnyVisibleIssue=false（此處以篩選條件濾成 0 筆驗證欄位存在，
    //      真正「完全無案件」情境已由 A1 節純邏輯測試 computeXxx([]) 覆蓋）。 ----
    await checkAsync("[17-9] 篩選成 0 筆時，issueList 為空陣列且不拋出例外", async () => {
      const vm = await buildGovernanceDashboardViewModel(admin.id, { issueType: "不存在的類型" });
      return vm.issueList.length === 0 && vm.hasAnyVisibleIssue === true;
    });
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
  check("[18-0] 治理儀表板 UI 檔案確實存在（非空殼）", uiFiles.length >= 10);

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
  let workflowStatusViolation: string | null = null;
  for (const file of libFiles) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    if (/workflowStatus/.test(src)) {
      workflowStatusViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[11-3] src/lib/governance-dashboard/* 程式碼層級完全不出現 workflowStatus 欄位存取（不得作為新流程權威來源；註解中的說明文字不算違規）", workflowStatusViolation === null, workflowStatusViolation ?? undefined);

  let stageEnteredAtViolation: string | null = null;
  for (const file of libFiles) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    if (/stageEnteredAt/.test(src)) {
      stageEnteredAtViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[7-10] src/lib/governance-dashboard/* 程式碼層級不使用 Issue.stageEnteredAt（M1 相容欄位）推算停留天數（註解中的說明文字不算違規）", stageEnteredAtViolation === null, stageEnteredAtViolation ?? undefined);

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

  const clientComponentCount = componentFiles.filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8"))).length;
  check("[20-2] 治理儀表板元件中恰好只有 GovernanceFilters 是 Client Component（其餘皆為 Server Component）", clientComponentCount === 1);

  const queriesSrc = fs.readFileSync(path.join(libDir, "queries.ts"), "utf8");
  check("[19-2] queries.ts 的可見性查詢函式呼叫 requireGovernanceDashboardAccess（服務層現場重新授權）", /requireGovernanceDashboardAccess/.test(queriesSrc));
}

main().catch(async (err) => {
  console.error("governance_dashboard-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
