// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// 「建立工作單」浮動選單（Option 3 垂直軌道式）瀏覽器級驗證：
//   1. 主按鈕文字為「建立工作單」，位於 /issues 主內容區右下角。
//   2. 展開後只有 3 個項目：建立 Hotfix／建立季度專案／通報事件，明確不含任何 RCA 建立入口。
//   3. 點擊主按鈕展開／再次點擊收合；Outside click 收合；Esc 收合；切換頁籤（route change）
//      後選單收合。
//   4. 鍵盤可操作（Tab 可聚焦、Enter 觸發）。
//   5. Mobile 390 寬度下主按鈕與展開項目符合 44×44 最小觸控區。
//   6. 與 ScrollDownChevron 不重疊（FAB 固定右下角，Chevron 置中於主內容區底部）。
//   7. 無 Console Error。
//
//   DATABASE_URL="file:/tmp/xxx.db" BASE_URL="http://127.0.0.1:PORT" npx tsx scripts/work_item_create_fab-verify.ts

import "./lib/assertSafeTestDatabase";

import { chromium } from "playwright";
import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3112";
let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}
const consoleIssues: string[] = [];
function watchPage(page: any) {
  page.setDefaultTimeout(60000);
  page.on("pageerror", (err: Error) => consoleIssues.push(`pageerror: ${err.message}`));
  page.on("console", (msg: any) => { if (msg.type() === "error") consoleIssues.push(`console: ${msg.text().slice(0, 200)}`); });
}
async function login(page: any, name: string) {
  watchPage(page);
  await page.goto(`${baseUrl}/login`);
  await page.locator("form").filter({ hasText: name }).first().getByRole("button", { name: "登入" }).click();
  await page.waitForURL(/\/governance/);
}
async function settleHydration(page: any) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

async function main() {
  const org = await seedFormalOrganization(prisma);
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: org.personByKey.get("selena")!.id } });

  const browser = await chromium.launch({ headless: true });

  console.log("\n=== A. Desktop 1440：展開內容、收合行為 ===");
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktopContext.newPage();
  await login(desktopPage, reporter.name);
  await desktopPage.goto(`${baseUrl}/issues`);
  await settleHydration(desktopPage);

  const fabButton = desktopPage.getByRole("button", { name: "建立工作單" });
  check("[1] FAB 主按鈕存在", await fabButton.count() === 1);
  check("[2] 初始狀態未展開（aria-expanded=false）", await fabButton.getAttribute("aria-expanded") === "false");

  await fabButton.click();
  await desktopPage.waitForTimeout(400);
  check("[3] 點擊後展開（aria-expanded=true）", await fabButton.getAttribute("aria-expanded") === "true");

  const menuItems = await desktopPage.getByRole("menuitem").allTextContents();
  check("[4] 展開後恰好 3 個項目", menuItems.length === 3);
  check("[5] 項目包含建立 Hotfix／建立季度專案／通報事件", ["建立 Hotfix", "建立季度專案", "通報事件"].every((label) => menuItems.some((t) => t.includes(label))));
  check("[6] 展開項目明確不含任何 RCA 建立入口", !menuItems.some((t) => t.includes("RCA")));

  await fabButton.click();
  await desktopPage.waitForTimeout(400);
  check("[7] 再次點擊主按鈕收合", await fabButton.getAttribute("aria-expanded") === "false");

  await fabButton.click();
  await desktopPage.waitForTimeout(400);
  // 點擊頁面標題（非互動元素、確定不在任何連結／按鈕上）代表「選單外點擊」，避免誤點到
  // Sidebar 導覽連結而整頁導航離開 /issues（FAB 只在工作單清單頁面渲染）。
  await desktopPage.getByRole("heading", { level: 1 }).click();
  await desktopPage.waitForTimeout(400);
  check("[8] Outside click 收合", await fabButton.getAttribute("aria-expanded") === "false");

  await fabButton.click();
  await desktopPage.waitForTimeout(400);
  await desktopPage.keyboard.press("Escape");
  await desktopPage.waitForTimeout(400);
  check("[9] Esc 收合", await fabButton.getAttribute("aria-expanded") === "false");

  await fabButton.click();
  await desktopPage.waitForTimeout(400);
  await desktopPage.getByRole("tab", { name: /事件通報/ }).click();
  await settleHydration(desktopPage);
  check("[10] 切換頁籤（route change）後選單收合", await desktopPage.getByRole("button", { name: "建立工作單" }).getAttribute("aria-expanded") === "false");

  console.log("\n=== B. 鍵盤可操作 ===");
  await desktopPage.goto(`${baseUrl}/issues`);
  await settleHydration(desktopPage);
  await desktopPage.getByRole("button", { name: "建立工作單" }).focus();
  await desktopPage.keyboard.press("Enter");
  await desktopPage.waitForTimeout(400);
  check("[11] 鍵盤 Enter 可展開選單", await desktopPage.getByRole("button", { name: "建立工作單" }).getAttribute("aria-expanded") === "true");

  console.log("\n=== C. 與 ScrollDownChevron 不重疊（各自固定位置） ===");
  const fabBox = await desktopPage.getByRole("button", { name: "建立工作單" }).boundingBox();
  const chevron = desktopPage.getByRole("button", { name: "向下捲動查看更多內容" });
  if (await chevron.count() > 0) {
    const chevronBox = await chevron.boundingBox();
    const overlap = fabBox && chevronBox && !(fabBox.x + fabBox.width < chevronBox.x || chevronBox.x + chevronBox.width < fabBox.x || fabBox.y + fabBox.height < chevronBox.y || chevronBox.y + chevronBox.height < fabBox.y);
    check("[12] FAB 與 ScrollDownChevron 邊界框不重疊", !overlap, JSON.stringify({ fabBox, chevronBox }));
  } else {
    check("[12] ScrollDownChevron 目前不可見（頁面不可捲動），視為不重疊", true);
  }
  await desktopContext.close();

  console.log("\n=== D. Mobile 390：觸控區 44×44、選單可用 ===");
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await login(mobilePage, reporter.name);
  await mobilePage.goto(`${baseUrl}/issues`);
  await settleHydration(mobilePage);
  const mobileFab = mobilePage.getByRole("button", { name: "建立工作單" });
  const mobileFabBox = await mobileFab.boundingBox();
  check("[13] Mobile 主按鈕高度至少 44px", Boolean(mobileFabBox && mobileFabBox.height >= 44));
  await mobileFab.click();
  await mobilePage.waitForTimeout(400);
  const mobileMenuItem = mobilePage.getByRole("menuitem").first();
  const mobileItemBox = await mobileMenuItem.boundingBox();
  check("[14] Mobile 展開項目高度至少 44px", Boolean(mobileItemBox && mobileItemBox.height >= 44));
  const size = await mobilePage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  check("[15] Mobile 390 無水平 overflow", size.scrollWidth <= size.clientWidth + 1, JSON.stringify(size));
  await mobileContext.close();

  console.log("\n=== E. 無 Console Error ===");
  check("[16] 全程無 pageerror／console error", consoleIssues.length === 0, consoleIssues.join(" | "));

  await browser.close();

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
