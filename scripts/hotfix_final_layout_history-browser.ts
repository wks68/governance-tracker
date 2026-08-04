// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// Hotfix 最終 UI 收尾瀏覽器級驗證：
//   1. Hotfix 基本資訊｜目前 Hotfix 流程頂列 Desktop 50/50 且等高。
//   2. 送簽摘要／治理關聯／主管簽核／附件依序全寬，簽核紀錄歷程置底。
//   3. 目前等待人員顯示實際核准人姓名（非硬編）＋角色。
//   4. 主管簽核只有目前責任人看得到可操作按鈕，其餘人唯讀。
//   5. 畫面不出現「待審核批准」等非正式字樣。
//   6. Desktop 1440／Laptop 1024／Mobile 390 皆無水平 overflow。
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
function watchPage(page) {
  page.setDefaultTimeout(60000);
  page.on("pageerror", (err: Error) => consoleIssues.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => { if (msg.type() === "error") consoleIssues.push(`console: ${msg.text().slice(0, 200)}`); });
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

function hotfixForm(teamId: string, applicantId: string, title: string): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    issueType: "Hotfix", title, description: "最終 UI 收尾 browser verify", systemName: "MyDMS",
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
  await buildHotfixWorkflowV1({ actorId: org.admin.id, reasonCode: "FINAL_LAYOUT_HISTORY_BROWSER_VERIFY", keySuffix: `final-layout-browser-${Date.now()}` });

  const qaTeamId = org.teamIdByName.get("品管")!;
  const selena = org.personByKey.get("selena")!;
  const jonus = org.personByKey.get("jonus")!;
  const selenaUser = await prisma.user.findUniqueOrThrow({ where: { id: selena.id } });

  const issue = await createIssueForActor(
    selenaUser,
    hotfixForm(qaTeamId, selena.id, `[browser-verify] 最終 UI 收尾 ${Date.now()}`),
    { submitForApproval: true },
  );
  const detailUrl = `${baseUrl}/issues/${issue.id}/hotfix/approval/requester`;

  const browser = await chromium.launch({ headless: true });
  try {
    // ===== Desktop 1440：Aaron（實際核准人）視角 =====
    console.log("\n=== Desktop 1440：Aaron（應核准人）視角 ===");
    const aaronContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const aaronPage = await aaronContext.newPage();
    await login(aaronPage, "Aaron");
    await aaronPage.goto(detailUrl);
    await settleHydration(aaronPage);

    const bodyText = await aaronPage.locator("body").innerText();
    check("頁面全文不出現「待審核批准」", !bodyText.includes("待審核批准"));
    check("頁面全文不出現硬編「送出待審核批准／草稿前往待審核批准」", !bodyText.includes("送出待審核批准") && !bodyText.includes("草稿前往待審核批准"));

    // 1) 頂列 50/50 且等高。
    const basicInfoBox = await aaronPage.locator("section", { hasText: "Hotfix 單基本資訊" }).first().boundingBox();
    const currentFlowBox = await aaronPage.locator('section[aria-label="目前 Hotfix 流程"]').boundingBox();
    check("Desktop 1440：Hotfix 基本資訊／目前 Hotfix 流程並排（同一列，左右相鄰）", Math.abs((basicInfoBox?.y ?? 0) - (currentFlowBox?.y ?? 1)) < 4, JSON.stringify({ basicInfoBox, currentFlowBox }));
    check("Desktop 1440：Hotfix 基本資訊寬度約為目前 Hotfix 流程寬度的一半版面（非全寬）", (basicInfoBox?.width ?? 0) < 900 && (currentFlowBox?.width ?? 0) < 900);
    check("Desktop 1440：頂列兩張卡片高度一致（equalHeight 撐滿）", Math.abs((basicInfoBox?.height ?? 0) - (currentFlowBox?.height ?? 0)) < 2, JSON.stringify({ h1: basicInfoBox?.height, h2: currentFlowBox?.height }));

    // 2) 送簽摘要／治理關聯／主管簽核／附件依序全寬，簽核紀錄歷程置底。
    const submissionSummaryBox = await aaronPage.locator("section", { hasText: "送簽摘要" }).first().boundingBox();
    const governanceBox = await aaronPage.locator("text=治理關聯與追蹤").first().boundingBox();
    const approvalSectionBox = await aaronPage.locator("#approval-section").boundingBox();
    const attachmentSectionBox = await aaronPage.locator("#attachment-section").boundingBox();
    const historyHeadingBox = await aaronPage.locator("text=簽核紀錄歷程").first().boundingBox();
    check("送簽摘要為全寬區塊", (submissionSummaryBox?.width ?? 0) > 1000, JSON.stringify(submissionSummaryBox));
    check("主管簽核為全寬區塊", (approvalSectionBox?.width ?? 0) > 1000, JSON.stringify(approvalSectionBox));
    check("附件為全寬區塊", (attachmentSectionBox?.width ?? 0) > 1000, JSON.stringify(attachmentSectionBox));
    check(
      "版面順序：送簽摘要 → 治理關聯 → 主管簽核 → 附件 → 簽核紀錄歷程",
      (submissionSummaryBox?.y ?? 0) < (governanceBox?.y ?? 0) &&
        (governanceBox?.y ?? 0) < (approvalSectionBox?.y ?? 0) &&
        (approvalSectionBox?.y ?? 0) < (attachmentSectionBox?.y ?? 0) &&
        (attachmentSectionBox?.y ?? 0) < (historyHeadingBox?.y ?? 0),
      JSON.stringify({ submissionSummaryBox, governanceBox, approvalSectionBox, attachmentSectionBox, historyHeadingBox }),
    );

    // 3) 目前等待人員顯示實際姓名＋角色。
    const currentFlowText = await aaronPage.locator('section[aria-label="目前 Hotfix 流程"]').innerText();
    check("CurrentHotfixFlowCard 顯示實際核准人姓名「Aaron」", currentFlowText.includes("Aaron"));
    check("CurrentHotfixFlowCard 同時顯示角色「申請人直屬主管」", currentFlowText.includes("申請人直屬主管"));

    // 4) 核准人（Aaron）可操作。
    const approvalText = await aaronPage.locator("#approval-section").innerText();
    check("主管簽核顯示簽核關卡「申請人直屬主管簽核」", approvalText.includes("申請人直屬主管簽核"));
    check("主管簽核顯示核准人「Aaron」", approvalText.includes("Aaron"));
    check("主管簽核顯示送簽人「Selena」", approvalText.includes("Selena"));
    check("Aaron（應核准人）看得到「同意」／「駁回」按鈕", await aaronPage.locator("#approval-section").getByRole("button", { name: "同意" }).count() === 1 && await aaronPage.locator("#approval-section").getByRole("button", { name: "駁回" }).count() === 1);

    await noHorizontalOverflow(aaronPage, "Desktop 1440 無水平 overflow");
    await aaronContext.close();

    // ===== Desktop 1440：非責任人（Jonus）視角，僅唯讀 =====
    console.log("\n=== Desktop 1440：非責任人（Jonus）視角 ===");
    const jonusContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const jonusPage = await jonusContext.newPage();
    await login(jonusPage, "Jonus");
    await jonusPage.goto(detailUrl);
    await settleHydration(jonusPage);
    const jonusApprovalText = await jonusPage.locator("#approval-section").innerText();
    check("非責任人（Jonus）看不到「同意」／「駁回」按鈕", await jonusPage.locator("#approval-section").getByRole("button", { name: "同意" }).count() === 0 && await jonusPage.locator("#approval-section").getByRole("button", { name: "駁回" }).count() === 0);
    check("非責任人（Jonus）看到唯讀提示「僅申請人直屬主管可執行簽核」", jonusApprovalText.includes("僅申請人直屬主管可執行簽核"));
    await noHorizontalOverflow(jonusPage, "Desktop 1440 非責任人視角無水平 overflow");
    await jonusContext.close();

    // ===== Laptop 1024 =====
    console.log("\n=== Laptop 1024 ===");
    const laptopContext = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const laptopPage = await laptopContext.newPage();
    await login(laptopPage, "Aaron");
    await laptopPage.goto(detailUrl);
    await settleHydration(laptopPage);
    const laptopBasicInfoBox = await laptopPage.locator("section", { hasText: "Hotfix 單基本資訊" }).first().boundingBox();
    const laptopCurrentFlowBox = await laptopPage.locator('section[aria-label="目前 Hotfix 流程"]').boundingBox();
    check("Laptop 1024：頂列仍維持雙欄（≥1024px 斷點）", Math.abs((laptopBasicInfoBox?.y ?? 0) - (laptopCurrentFlowBox?.y ?? 1)) < 4);
    check("Laptop 1024：主管簽核按鈕完整可見（未被擠壓裁切）", await laptopPage.locator("#approval-section").getByRole("button", { name: "同意" }).isVisible());
    await noHorizontalOverflow(laptopPage, "Laptop 1024 無水平 overflow");
    await laptopContext.close();

    // ===== Mobile 390 =====
    console.log("\n=== Mobile 390 ===");
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    await login(mobilePage, "Aaron");
    await mobilePage.goto(detailUrl);
    await settleHydration(mobilePage);
    const mobileBasicInfoBox = await mobilePage.locator("section", { hasText: "Hotfix 單基本資訊" }).first().boundingBox();
    const mobileCurrentFlowBox = await mobilePage.locator('section[aria-label="目前 Hotfix 流程"]').boundingBox();
    check("Mobile 390：頂列改為單欄（上下堆疊）", (mobileCurrentFlowBox?.y ?? 0) > (mobileBasicInfoBox?.y ?? 0) + (mobileBasicInfoBox?.height ?? 0) - 4);
    const approveButton = mobilePage.locator("#approval-section").getByRole("button", { name: "同意" });
    check("Mobile 390：「同意」按鈕可見且可操作", await approveButton.isVisible());
    await noHorizontalOverflow(mobilePage, "Mobile 390 無水平 overflow");
    await mobileContext.close();

    check("Console 全程無未處理錯誤", consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 5)));
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
