import * as fs from "node:fs";
import * as path from "node:path";
import {
  matchesHotfixSearch,
  matchesHotfixSummary,
  resolveHotfixDueTone,
  resolveHotfixListAction,
  resolveHotfixTerminal,
  resolveResponsibilityLine,
  summarizeHotfixList,
  taipeiWeekBounds,
  type HotfixListFilterSource,
} from "../src/lib/hotfix-list/viewModel";

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function row(input: Partial<HotfixListFilterSource> = {}): HotfixListFilterSource {
  return {
    issueKey: "HOTFIX-0001",
    title: "登入異常",
    systemName: "MyDMS",
    dueDate: null,
    terminal: false,
    hotfixAction: { variant: "view", label: "檢視", href: "/issues/HF/hotfix/summary" },
    ...input,
  };
}

function main() {
  console.log("=== Hotfix list UI targeted verify ===");
  const detailHref = "/issues/HF/hotfix/summary";
  const actionHref = "/issues/HF/hotfix/approval/rd";

  const approval = resolveHotfixListAction({ actionKind: "APPROVE", actionHref, detailHref });
  const work = resolveHotfixListAction({ actionKind: "ENTER_WORK", actionHref, detailHref });
  const view = resolveHotfixListAction({ actionKind: "VIEW_ONLY", detailHref });
  check("[1] 主管簽核 capability 只解析為待核准", approval.label === "待核准" && approval.variant === "pending-approval" && approval.href === actionHref);
  check("[2] 一般操作 capability 只解析為待處理", work.label === "待處理" && work.variant === "pending-work" && work.href === actionHref);
  check("[3] 無操作 capability 解析為 canonical 檢視", view.label === "檢視" && view.variant === "view" && view.href === detailHref);
  check("[4] 結案／取消即使收到 action 仍只能檢視", resolveHotfixListAction({ actionKind: "APPROVE", actionHref, detailHref, terminal: true }).variant === "view");
  check("[5] Admin 無正式 capability 不會被角色名稱提升權限", resolveHotfixListAction({ detailHref }).variant === "view");

  check("[6] responsibilityLine 優先等待角色", resolveResponsibilityLine({ terminal: false, waitingRole: "QA 團隊", executorName: "Ken", assignedTeamName: "RD" }) === "等待角色：QA 團隊");
  check("[7] 無等待角色時其次顯示執行人", resolveResponsibilityLine({ terminal: false, waitingRole: "—", executorName: "Ken", assignedTeamName: "RD" }) === "執行人：Ken");
  check("[8] 無等待角色與執行人時顯示承接團隊", resolveResponsibilityLine({ terminal: false, assignedTeamName: "RD" }) === "承接團隊：RD");
  check("[9] 終態不顯示過期責任資訊", resolveResponsibilityLine({ terminal: true, waitingRole: "QA 團隊" }) === null);

  check("[10] runtime 終態以 terminalOutcome 為權威來源", resolveHotfixTerminal({ hasRuntime: true, currentStageTerminalOutcome: "CANCELLED", workflowStatus: "rdInProgress" }));
  check("[11] runtime 不採信誤導 workflowStatus", !resolveHotfixTerminal({ hasRuntime: true, currentStageTerminalOutcome: null, workflowStatus: "closed" }));
  check("[12] 舊制 closed／cancelled 仍解析為終態", resolveHotfixTerminal({ hasRuntime: false, workflowStatus: "closed" }) && resolveHotfixTerminal({ hasRuntime: false, workflowStatus: "cancelled" }));

  const now = new Date("2026-08-05T04:00:00.000Z");
  const bounds = taipeiWeekBounds(now);
  check("[13] 無到期日為 unset", resolveHotfixDueTone(null, false, now.getTime(), bounds) === "unset");
  check("[14] 本週未逾期為 due-soon", resolveHotfixDueTone("2026-08-07T08:00:00.000Z", false, now.getTime(), bounds) === "due-soon");
  check("[15] 已逾期且非終態為 overdue", resolveHotfixDueTone("2026-08-04T08:00:00.000Z", false, now.getTime(), bounds) === "overdue");
  check("[16] 終態不保留 overdue 警示", resolveHotfixDueTone("2026-08-04T08:00:00.000Z", true, now.getTime(), bounds) === "normal");

  const rows = [
    row({ hotfixAction: approval, dueDate: "2026-08-07T08:00:00.000Z" }),
    row({ issueKey: "HOTFIX-0002", hotfixAction: work }),
    row({ issueKey: "HOTFIX-0003", terminal: true, dueDate: "2026-08-06T08:00:00.000Z" }),
    row({ issueKey: "HOTFIX-0004" }),
  ];
  const counts = summarizeHotfixList(rows, bounds);
  check("[17] 四張摘要卡統計排除只讀與終態誤計", counts.total === 4 && counts.work === 1 && counts.approval === 1 && counts.due === 1, JSON.stringify(counts));
  check("[18] 摘要 my-work 只命中一般處理 capability", matchesHotfixSummary(rows[1], "my-work", bounds) && !matchesHotfixSummary(rows[0], "my-work", bounds));
  check("[19] 摘要 pending-approval 只命中主管簽核 capability", matchesHotfixSummary(rows[0], "pending-approval", bounds) && !matchesHotfixSummary(rows[1], "pending-approval", bounds));
  check("[20] 摘要 due-this-week 排除終態", matchesHotfixSummary(rows[0], "due-this-week", bounds) && !matchesHotfixSummary(rows[2], "due-this-week", bounds));
  check("[21] 搜尋支援單號、標題與系統名稱", matchesHotfixSearch(rows[0], "HOTFIX-0001") && matchesHotfixSearch(rows[0], "登入") && matchesHotfixSearch(rows[0], "mydms"));

  const page = source("src/app/issues/page.tsx");
  const table = source("src/components/IssueTable.tsx");
  const filter = source("src/components/FilterBar.tsx");
  const summaryCards = source("src/components/issue-list/HotfixSummaryCards.tsx");
  const button = source("src/components/issue-list/IssueActionButton.tsx");
  const css = source("src/app/globals.css");
  const desktop = table.slice(table.indexOf("function HotfixDesktopTable"), table.indexOf("function HotfixCards"));
  const mobile = table.slice(table.indexOf("function HotfixCards"), table.indexOf("function QuarterlyRelations"));
  const headers = ["緊急程度", "Hotfix 單號", "事項", "申請人", "目前狀態", "到期日", "操作"];
  check("[22] issues/page.tsx 接上完整 Hotfix view model", ["hotfixAction:", "responsibilityLine:", "terminal,", "dueTone:"].every((text) => page.includes(text)));
  check("[23] runtime terminal 查詢包含 terminalOutcome", page.includes("terminalOutcome: true") && page.includes("resolveHotfixTerminal"));
  check("[24] Desktop 七欄順序正確", headers.every((header, index) => desktop.indexOf(header) >= 0 && (index === 0 || desktop.indexOf(header) > desktop.indexOf(headers[index - 1]))));
  check("[25] Desktop Hotfix 不含舊獨立欄位", !["工單類型", "系統名稱</th>", "標題</th>", "承接團隊</th>", "執行人</th>", "等待角色</th>"].some((header) => desktop.includes(header)));
  check("[26] Mobile 使用卡片、雙行標題與單一滿寬按鈕", mobile.includes("xl:hidden") && table.includes('compact ? "line-clamp-2') && mobile.includes("<HotfixTitle issue={issue} compact />") && (mobile.match(/<IssueActionButton/g) ?? []).length === 1 && mobile.includes("fullWidth"));
  check("[27] Desktop 1440 使用表格、1024 與 Mobile 使用卡片", desktop.includes("hidden xl:block") && mobile.includes("md:grid-cols-2 xl:hidden"));
  check("[28] 四張摘要卡為 Mobile 2x2、Desktop 四欄", summaryCards.includes("grid grid-cols-2") && summaryCards.includes("lg:grid-cols-4") && ["my-work", "pending-approval", "due-this-week"].every((key) => summaryCards.includes(key)));
  check("[29] 摘要篩選與 ActiveFilterChip 均為 URL 驅動且可移除", filter.includes('"summary", ...PANEL_FILTER_KEYS') && filter.includes("params.delete(key)") && filter.includes("aria-label={`移除篩選："));
  check("[30] 搜尋 placeholder 與 Server 搜尋涵蓋三欄", filter.includes("搜尋 Hotfix 單號、標題或系統名稱") && page.includes("matchesHotfixSearch"));
  check("[31] 單一按鈕保留固定尺寸、loading 文字與 reduced motion", css.includes(".issue-action-button") && button.includes("<span>{action.label}</span>") && button.includes("motion-reduce:animate-none"));
  check("[32] 三種操作語意色使用 token 而非 JSX hex", css.includes("--action-pending-approval: #6d28d9") && css.includes("--action-pending-work: #245cb8") && css.includes("--action-view: #f8fafc") && !/#[0-9a-f]{6}/i.test(button));
  check("[33] Desktop 七欄表頭水平垂直置中且單行", desktop.includes("h-14 text-xs") && desktop.includes("whitespace-nowrap px-3 py-4 text-center align-middle") && desktop.includes("whitespace-nowrap px-5 py-4 text-center align-middle"));
  check("[34] Desktop 操作欄 136px、按鈕固定 96x40 且置中", desktop.includes('w-[136px]') && desktop.includes("flex w-full items-center justify-center") && css.includes("h-10 w-24 min-w-24 max-w-24"));
  check("[35] Desktop 不使用滿寬按鈕，Mobile 維持滿寬 44px", !desktop.includes("fullWidth") && mobile.includes("fullWidth") && button.includes('h-11 w-full min-w-full max-w-full'));

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
