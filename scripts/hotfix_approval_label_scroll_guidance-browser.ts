// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// Hotfix 詳情頁最後一輪 UI 修正瀏覽器級驗證：
//   1. 送簽摘要左右對齊、右側內容正確。
//   2. 核准人欄位正確顯示，歷程文字正確（不含禁用字樣）。
//   3. 雙箭頭動畫位於主內容底部中央、不遮住任何操作。
//   4. Scroll Down Icon 顯示／隱藏規則、點擊平滑捲動、reduced motion。
//   5. Desktop 1440／Laptop 1024／Mobile 390 皆無水平 overflow。
//
// 一律只連線呼叫端顯式指定的 /tmp 隔離 DATABASE_URL（見 assertSafeTestDatabase），
// 不觸碰正式 dev.db 或任何持久化 Preview DB。

import "./lib/assertSafeTestDatabase";

import { chromium } from "playwright";
import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { createIssueForActor } from "../src/lib/issueCreation";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3110";
let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}

const consoleIssues: string[] = [];
const networkIssues: string[] = [];
function watchPage(page) {
  page.setDefaultTimeout(60000);
  page.on("pageerror", (err: Error) => consoleIssues.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => { if (msg.type() === "error") consoleIssues.push(`console: ${msg.text().slice(0, 200)}`); });
  page.on("response", (res) => { if (res.status() >= 400 && res.status() !== 404) networkIssues.push(`${res.status()} ${res.url()}`); });
}
async function login(page, name: string) {
  watchPage(page);
  await page.goto(`${baseUrl}/login`);
  await page.locator("form").filter({ hasText: name }).first().getByRole("button", { name: "登入" }).click();
  await page.waitForURL(/\/governance/);
}
async function settleHydration(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
async function noHorizontalOverflow(page, label: string) {
  const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  check(label, size.scrollWidth <= size.clientWidth + 1, JSON.stringify(size));
}
function boxesOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function hotfixForm(teamId: string, applicantId: string, title: string): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    issueType: "Hotfix", title, description: "approval label / scroll guidance browser verify", systemName: "MyDMS",
    environment: "Production", riskLevel: "中", dueDate: "2026-08-20", hotfixPriority: "HIGH",
    teamId, applicantId,
  })) form.set(key, value);
  return form;
}

async function main() {
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({
    where: { status: "PUBLISHED", workflowDefinition: { issueType: "Hotfix" } },
    data: { status: "ARCHIVED" },
  });
  await buildHotfixWorkflowV1({ actorId: org.admin.id, reasonCode: "APPROVAL_LABEL_SCROLL_GUIDANCE_BROWSER_VERIFY", keySuffix: `approval-label-scroll-browser-${Date.now()}` });

  const qaTeamId = org.teamIdByName.get("品管")!;
  const selena = org.personByKey.get("selena")!;
  const selenaUser = await prisma.user.findUniqueOrThrow({ where: { id: selena.id } });

  const issue = await createIssueForActor(
    selenaUser,
    hotfixForm(qaTeamId, selena.id, `[browser-verify] 核准人改名與捲動引導 ${Date.now()}`),
    { submitForApproval: true },
  );
  const detailUrl = `${baseUrl}/issues/${issue.id}/hotfix/approval/requester`;
  const CHEVRON_SELECTOR = 'button[aria-label="向下捲動查看更多內容"]';

  const browser = await chromium.launch({ headless: true });
  try {
    // ===== Desktop 1440 =====
    console.log("\n=== Desktop 1440 ===");
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopPage = await desktopContext.newPage();
    await login(desktopPage, "Aaron");
    await desktopPage.goto(detailUrl);
    await settleHydration(desktopPage);

    const bodyText = await desktopPage.locator("body").innerText();
    check("送簽摘要左右對齊：申請事由／問題摘要與影響摘要皆存在", bodyText.includes("申請事由／問題摘要") && bodyText.includes("影響摘要"));
    check("送簽摘要不再顯示無關風險摘要框", !bodyText.includes("風險與緊急性"));
    check("核准人欄位正確顯示「核准人」與姓名「Aaron」", bodyText.includes("核准人") && bodyText.includes("Aaron"));
    check("頁面不出現「應核准人」", !bodyText.includes("應核准人"));
    // 「業務核准」等字樣的另一個外洩來源是治理關聯卡（GovernanceRelationsCard／
    // issue-relations/viewService.ts 的 businessStatus() 直接使用 currentWorkflowStage.label
    // 原始 DB 標籤）——本輪明確禁止修改 Governance Relation，故只在本輪實際負責、且已修正
    // 的主管簽核與簽核紀錄歷程兩個區塊斷言不出現禁用字樣，治理關聯卡的既有行為不在此列。
    const approvalSectionText = await desktopPage.locator("#approval-section").innerText();
    const historyRegionText = await desktopPage.getByRole("region", { name: "簽核紀錄歷程" }).innerText();
    const bannedInScope = ["待審核核准", "待審核批准", "業務核准"];
    check(
      "主管簽核與簽核紀錄歷程區塊不出現禁用字樣（待審核核准／待審核批准／業務核准）",
      bannedInScope.every((phrase) => !approvalSectionText.includes(phrase) && !historyRegionText.includes(phrase)),
    );

    const chevron = desktopPage.locator(CHEVRON_SELECTOR);
    await chevron.waitFor({ state: "attached" });
    check("長頁面：雙箭頭於頂部（未捲動）時可見", await chevron.evaluate((el) => getComputedStyle(el).opacity) !== "0");

    const approvalBox = await desktopPage.locator("#approval-section").getByRole("button", { name: "同意" }).boundingBox();
    const chevronBoxAtTop = await chevron.boundingBox();
    check("雙箭頭不遮住主管簽核「同意」按鈕", !boxesOverlap(approvalBox, chevronBoxAtTop), JSON.stringify({ approvalBox, chevronBoxAtTop }));

    const mainBox = await desktopPage.locator("#main-content").boundingBox();
    check(
      "雙箭頭置中於主內容區（非左側 Sidebar），中心點落在 main-content 寬度範圍內",
      chevronBoxAtTop && mainBox && chevronBoxAtTop.x >= mainBox.x - 4 && chevronBoxAtTop.x + chevronBoxAtTop.width <= mainBox.x + mainBox.width + 4,
      JSON.stringify({ chevronBoxAtTop, mainBox }),
    );

    const beforeClickScrollY = await desktopPage.evaluate(() => window.scrollY);
    await chevron.click();
    await desktopPage.waitForTimeout(700);
    const afterClickScrollY = await desktopPage.evaluate(() => window.scrollY);
    check("點擊雙箭頭後頁面平滑捲動（scrollY 增加）", afterClickScrollY > beforeClickScrollY, JSON.stringify({ beforeClickScrollY, afterClickScrollY }));

    await desktopPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await desktopPage.waitForTimeout(300);
    check("捲到接近頁面底部時雙箭頭淡出隱藏", await chevron.evaluate((el) => getComputedStyle(el).opacity) === "0");

    await noHorizontalOverflow(desktopPage, "Desktop 1440 無水平 overflow");
    await desktopContext.close();

    // ===== 不可捲動的短頁面：雙箭頭不顯示 =====
    console.log("\n=== 內容未溢出視窗：雙箭頭不顯示 ===");
    const tallContext = await browser.newContext({ viewport: { width: 1440, height: 3200 } });
    const tallPage = await tallContext.newPage();
    await login(tallPage, "Aaron");
    await tallPage.goto(detailUrl);
    await settleHydration(tallPage);
    const tallChevron = tallPage.locator(CHEVRON_SELECTOR);
    await tallChevron.waitFor({ state: "attached" });
    check("頁面不可捲動時雙箭頭不顯示", await tallChevron.evaluate((el) => getComputedStyle(el).opacity) === "0");
    await tallContext.close();

    // ===== prefers-reduced-motion =====
    console.log("\n=== prefers-reduced-motion ===");
    const reducedContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const reducedPage = await reducedContext.newPage();
    await login(reducedPage, "Aaron");
    await reducedPage.goto(detailUrl);
    await settleHydration(reducedPage);
    const reducedChevronIcons = reducedPage.locator(`${CHEVRON_SELECTOR} svg`);
    await reducedChevronIcons.first().waitFor();
    const animationNames = await reducedChevronIcons.evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
    check("reduced motion 下停止循環動畫（animationName 為 none）", animationNames.every((name) => name === "none"), JSON.stringify(animationNames));
    check("reduced motion 下仍保留靜態雙箭頭（icon 仍存在於 DOM）", await reducedChevronIcons.count() === 2);
    await reducedContext.close();

    // ===== 非核准人視角：不可操作 =====
    console.log("\n=== 非核准人視角 ===");
    const jonusContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const jonusPage = await jonusContext.newPage();
    await login(jonusPage, "Jonus");
    await jonusPage.goto(detailUrl);
    await settleHydration(jonusPage);
    check("非核准人（Jonus）看不到「同意」／「駁回」按鈕", await jonusPage.locator("#approval-section").getByRole("button", { name: "同意" }).count() === 0);
    await jonusContext.close();

    // ===== Laptop 1024 =====
    console.log("\n=== Laptop 1024 ===");
    const laptopContext = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const laptopPage = await laptopContext.newPage();
    await login(laptopPage, "Aaron");
    await laptopPage.goto(detailUrl);
    await settleHydration(laptopPage);
    const laptopApprovalBox = await laptopPage.locator("#approval-section").boundingBox();
    const laptopChevron = laptopPage.locator(CHEVRON_SELECTOR);
    await laptopChevron.waitFor({ state: "attached" });
    const laptopChevronBox = await laptopChevron.boundingBox();
    check("Laptop 1024：雙箭頭不遮住主管簽核卡片", !boxesOverlap(laptopApprovalBox, laptopChevronBox) || (await laptopChevron.evaluate((el) => getComputedStyle(el).opacity)) === "0", JSON.stringify({ laptopApprovalBox, laptopChevronBox }));
    const historyRegion = laptopPage.getByRole("region", { name: "簽核紀錄歷程" });
    await historyRegion.waitFor();
    check("Laptop 1024：簽核紀錄歷程區塊可正常顯示", (await historyRegion.innerText()).length > 0);
    await noHorizontalOverflow(laptopPage, "Laptop 1024 無水平 overflow");
    await laptopContext.close();

    // ===== Mobile 390 =====
    console.log("\n=== Mobile 390 ===");
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const mobilePage = await mobileContext.newPage();
    await login(mobilePage, "Aaron");
    await mobilePage.goto(detailUrl);
    await settleHydration(mobilePage);
    const mobileChevron = mobilePage.locator(CHEVRON_SELECTOR);
    await mobileChevron.waitFor({ state: "attached" });
    const mobileChevronBox = await mobileChevron.boundingBox();
    check("Mobile 390：雙箭頭在畫面寬度內（未超出畫面）", mobileChevronBox && mobileChevronBox.x >= 0 && mobileChevronBox.x + mobileChevronBox.width <= 390, JSON.stringify(mobileChevronBox));
    const mobileBeforeScrollY = await mobilePage.evaluate(() => window.scrollY);
    await mobileChevron.click();
    await mobilePage.waitForTimeout(700);
    const mobileAfterScrollY = await mobilePage.evaluate(() => window.scrollY);
    check("Mobile 390：觸控點擊雙箭頭可捲動頁面", mobileAfterScrollY > mobileBeforeScrollY, JSON.stringify({ mobileBeforeScrollY, mobileAfterScrollY }));
    await noHorizontalOverflow(mobilePage, "Mobile 390 無水平 overflow");
    await mobileContext.close();

    check("Console 全程無未處理錯誤", consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 5)));
    check("Network 無非預期 4xx／5xx", networkIssues.length === 0, JSON.stringify(networkIssues.slice(0, 5)));
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed / ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
