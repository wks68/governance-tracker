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
  const navServer = source("src/components/Nav.tsx");
  const notificationBell = source("src/components/ActionableNotificationBell.tsx");
  const workCenter = source("src/app/work-management/page.tsx");
  const chooser = source("src/components/work-management/NewItemChooser.tsx");
  const newPage = source("src/app/issues/new/page.tsx");
  const issuePage = source("src/app/issues/page.tsx");
  const incidentPage = source("src/app/incidents/page.tsx");
  const rcaPage = source("src/app/rca/page.tsx");
  const responsibilityPage = source("src/app/settings/approval-governance/page.tsx");
  const tokens = source("src/app/globals.css");
  const schema = source("prisma/schema.prisma");

  check("[1] Sidebar 顯示工作管理而非工作管理中心", shell.includes('item={{ href: "/work-management", label: "工作管理"') && !shell.includes('item={{ href: "/work-management", label: "工作管理中心"'));
  check("[2] /work-management 頁面主標題維持 DMS 工作管理中心", workCenter.includes('title="DMS 工作管理中心"'));
  check("[3] 工作管理父連結與展開按鈕分離", shell.includes('href: "/work-management"') && shell.includes('aria-expanded={workOpen}') && shell.includes("onToggleWork"));
  check("[4] 顯示專案流程與緊急修正", shell.includes('label: "專案流程與緊急修正"'));
  check("[5] 顯示事件通報與改善", shell.includes('label: "事件通報與改善"'));
  check("[6] 顯示申請與紀錄及單一 OP 即將提供預留", shell.includes('label: "申請與紀錄"') && shell.includes("OP 帳號與權限申請") && shell.includes("即將提供") && !chooser.includes("申請表 1"));
  check("[7] 顯示工作列表", shell.includes('label: "工作列表"'));
  check("[8] 顯示我的待辦", shell.includes('label: "我的待辦"'));
  check("[9] Sidebar 不顯示全部事項", !shell.includes("全部事項"));
  check("[10] 工作列表包含四個清單入口", ["Hotfix 清單", "季度專案清單", "事件通報清單", "RCA 清單"].every((label) => shell.includes(label)));
  check("[11] 四個清單沿用既有 route", shell.includes('{ href: "/issues?view=hotfix", label: "Hotfix 清單"') && shell.includes('{ href: "/issues?view=quarterly", label: "季度專案清單"') && shell.includes('{ href: "/incidents", label: "事件通報清單"') && shell.includes('{ href: "/rca", label: "RCA 清單"'));
  check("[12] 我的待辦與通知鈴鐺共用同一 resolver 結果與 Badge 數量", navServer.includes("listActionableTasksForActor(user.id)") && navServer.includes("tasks={notificationTasks}") && shell.includes("<ActionableNotificationBell tasks={tasks}") && shell.includes("taskCount={tasks.length}") && shell.includes('/issues?view=hotfix&quick=mine') && notificationBell.includes("tasks.length"));
  check("[13] 工作管理與所有子項目受既有 issue.view capability 控制", navServer.includes('hasCapability(roles, "issue.view")') && shell.includes("{canUseWorkManagement && ("));
  check("[14] desktop、collapsed Sidebar、mobile Drawer 與巢狀群組互動完整", shell.includes('<aside') && shell.includes('title={collapsed ? item.label : undefined}') && shell.includes('role="dialog"') && shell.includes("<SidebarContent") && shell.includes("function WorkGroupSection") && shell.includes('aria-expanded={open}') && shell.includes('event.key === "Escape"') && shell.includes('document.addEventListener("mousedown"'));
  check("[15] 正式中英文產品名稱與 Design Tokens 維持完整", layout.includes('default: "DMS 工作管理平台"') && shell.includes("DMS WorkHub") && ["--primary:", "--primary-hover:", "--primary-foreground:", "--primary-muted:", "--background:", "--surface:", "--surface-muted:", "--border:", "--input:", "--text-primary:", "--text-secondary:", "--text-muted:", "--success:", "--success-muted:", "--warning:", "--warning-muted:", "--danger:", "--danger-muted:", "--info:", "--info-muted:", "--disabled:", "--focus-ring:"].every((token) => tokens.includes(token)) && schema.includes("model IssueRelation"));
  check("[16] 既有建立、清單與事件/RCA route 來源未分岔", newPage.includes("<NewIssueForm") && source("src/components/NewIssueForm.tsx").includes("createIssueAction") && issuePage.includes('type ListMode = "hotfix" | "quarterly"') && issuePage.includes("selectedIssues") && !fs.existsSync(path.join(ROOT, "src/app/hotfix-list")) && incidentPage.includes('createHref="/issues/new?type=incident"') && rcaPage.includes('createHref="/issues/new?type=rca"'));
  check("[17] 工作管理首頁沿用既有 visibility 與 actionability 服務", workCenter.includes("getVisibleGovernanceIssueRows(actor.id)") && workCenter.includes("listActionableTasksForActor(actor.id)") && responsibilityPage.includes("設定誰是直屬主管、團隊主管及核准代理人。"));

  const actor = await prisma.user.findFirst({
    where: { isActive: true, userRoles: { some: { isActive: true, role: "Admin" } } },
  });
  check("[18] 隔離 DB 有可用 actor 供動態 resolver 驗證", actor !== null);
  if (actor) {
    const [visible, actionable] = await Promise.all([
      getVisibleGovernanceIssueRows(actor.id),
      listActionableTasksForActor(actor.id),
    ]);
    check("[19] 工作首頁兩個正式 resolver 可在同一 actor 下讀取", Array.isArray(visible) && Array.isArray(actionable));
  }

  check("[20] 沒有建立 OP 假 route 或八張空模型", !fs.existsSync(path.join(ROOT, "src/app/op-applications")) && !/model\s+OpApplication(?:1|2|3|4|5|6|7|8)\b/.test(schema));
  console.log(`\n=== 結果：PASS ${passCount} / FAIL 0 ===`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
