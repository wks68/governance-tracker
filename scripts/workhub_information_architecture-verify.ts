import "./lib/assertSafeTestDatabase";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { getVisibleGovernanceIssueRows } from "../src/lib/governanceDashboardService";
import { listActionableTasksForActor } from "../src/lib/workflowExecutionService";

const ROOT = process.cwd();
let passCount = 0;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(name: string, condition: boolean) {
  assert.ok(condition, name);
  passCount += 1;
  console.log(`  PASS  ${name}`);
}

async function main() {
  console.log("=== DMS WorkHub 資訊架構 targeted verify ===");
  const layout = source("src/app/layout.tsx");
  const shell = source("src/components/app-shell/AppShell.tsx");
  const workCenter = source("src/app/work-management/page.tsx");
  const chooser = source("src/components/work-management/NewItemChooser.tsx");
  const newPage = source("src/app/issues/new/page.tsx");
  const issuePage = source("src/app/issues/page.tsx");
  const incidentPage = source("src/app/incidents/page.tsx");
  const rcaPage = source("src/app/rca/page.tsx");
  const responsibilityPage = source("src/app/settings/approval-governance/page.tsx");
  const tokens = source("src/app/globals.css");
  const schema = source("prisma/schema.prisma");

  check("[1] 正式中英文產品名稱進入 metadata 與品牌區", layout.includes('default: "DMS 工作管理平台"') && shell.includes("DMS WorkHub") && shell.includes("DMS 工作管理平台"));
  check("[2] Sidebar 第一層含治理儀表板、工作管理中心、新增事項、事件通報、RCA 根因分析與系統設定", ["治理儀表板", "工作管理中心", "新增事項", "事件通報", "RCA 根因分析", "系統設定"].every((label) => shell.includes(label)));
  check("[3] Sidebar 沒有待辦或個人檢視子項", !["我的待辦", "我建立的", "與我相關", "全部可見", ">待我處理<"].some((label) => shell.includes(label)));
  check("[4] 工作管理中心父連結與展開按鈕分離", shell.includes('href: "/work-management"') && shell.includes('aria-expanded={workOpen}') && shell.includes("onToggleWork"));
  check("[5] 工作管理中心包含四個正式群組", ["專案流程與緊急修正（Hotfix）", "事件通報與改善", "申請與紀錄", "工作列表"].every((label) => shell.includes(label)));
  check("[6] 四個工作清單沿用既有 route", shell.includes('/issues?view=hotfix') && shell.includes('/issues?view=quarterly') && shell.includes('href: "/incidents"') && shell.includes('href: "/rca"'));
  check("[7] OP 申請只顯示單一即將提供預留", shell.includes("OP 帳號與權限申請") && chooser.includes("OP 帳號與權限申請") && chooser.includes("即將提供") && !chooser.includes("申請表 1"));
  check("[8] 新增事項頁主標題與四張正式卡片正確", newPage.includes("你現在要辦理什麼？") && ["季度專案", "Hotfix 緊急修正", "事件通報", "RCA 根因分析"].every((label) => chooser.includes(label)));
  check("[9] 新增事項仍沿用 NewIssueForm 與 createIssueAction", newPage.includes("<NewIssueForm") && source("src/components/NewIssueForm.tsx").includes("createIssueAction"));
  check("[10] 季度專案使用既有 ChangeRelease 與正式 subtype", newPage.includes('issueType: "ChangeRelease"') && newPage.includes('changeSubType: "QUARTERLY_RELEASE"') && source("src/lib/issueCreation.ts").includes("changeSubType,"));
  check("[11] /issues 維持 Hotfix／季度專案同一清單來源", issuePage.includes('type ListMode = "hotfix" | "quarterly"') && issuePage.includes("selectedIssues") && !fs.existsSync(path.join(ROOT, "src/app/hotfix-list")));
  check("[12] 事件與 RCA 建立按鈕使用正式名稱及既有建立 route", incidentPage.includes('createLabel="建立事件通報"') && incidentPage.includes('createHref="/issues/new?type=incident"') && rcaPage.includes('createLabel="建立 RCA"') && rcaPage.includes('createHref="/issues/new?type=rca"'));
  check("[13] 系統設定正式顯示人員管理、團隊管理與權責設定", shell.includes("人員管理") && shell.includes("團隊管理") && shell.includes("權責設定") && responsibilityPage.includes("設定誰是直屬主管、團隊主管及核准代理人。"));
  check("[14] AppShell 有 Sidebar、Topbar、responsive dialog 與必要 aria", shell.includes('<aside') && shell.includes('<header') && shell.includes('role="dialog"') && shell.includes('aria-modal="true"') && shell.includes("aria-current") && shell.includes("aria-expanded"));
  check("[15] Design Tokens 完整且沒有改動 Prisma model", ["--primary:", "--primary-hover:", "--primary-foreground:", "--primary-muted:", "--background:", "--surface:", "--surface-muted:", "--border:", "--input:", "--text-primary:", "--text-secondary:", "--text-muted:", "--success:", "--success-muted:", "--warning:", "--warning-muted:", "--danger:", "--danger-muted:", "--info:", "--info-muted:", "--disabled:", "--focus-ring:"].every((token) => tokens.includes(token)) && schema.includes("model IssueRelation"));
  check("[16] 工作管理中心以既有 visibility 與 actionability 服務取數", workCenter.includes("getVisibleGovernanceIssueRows(actor.id)") && workCenter.includes("listActionableTasksForActor(actor.id)"));

  const actor = await prisma.user.findFirst({
    where: { isActive: true, userRoles: { some: { isActive: true, role: "Admin" } } },
  });
  check("[17] 隔離 DB 有可用 actor 供動態 resolver 驗證", actor !== null);
  if (actor) {
    const [visible, actionable] = await Promise.all([
      getVisibleGovernanceIssueRows(actor.id),
      listActionableTasksForActor(actor.id),
    ]);
    check("[18] 工作首頁兩個正式 resolver 可在同一 actor 下讀取", Array.isArray(visible) && Array.isArray(actionable));
  }

  check("[19] 沒有建立 OP 假 route 或八張空模型", !fs.existsSync(path.join(ROOT, "src/app/op-applications")) && !/model\s+OpApplication(?:1|2|3|4|5|6|7|8)\b/.test(schema));
  console.log(`\n=== 結果：PASS ${passCount} / FAIL 0 ===`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
