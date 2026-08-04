// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// Incident 事件通報流程瀏覽器級驗證（本輪基礎切片，RCA 畫面尚未建立，不在此涵蓋）：
//   1. F01 建立表單可送出並自動進入待承接。
//   2. 九階段進度軸、事件基本資訊／目前事件流程、治理關聯、流程歷程皆正確顯示。
//   3. 非責任人唯讀，責任人可操作；受理窗口承接、分級、指派、技術主管接單指派、
//      送出處置、確認恢復、RCA 判定、確認結案，走完整條真實流程。
//   4. Desktop 1440／Laptop 1024／Mobile 390 無水平 overflow。
//   5. 無 Console Error。
//
// 一律只連線呼叫端顯式指定的 /tmp 隔離 DATABASE_URL（見 assertSafeTestDatabase），
// 不觸碰正式 dev.db 或任何持久化 Preview DB。

import "./lib/assertSafeTestDatabase";

import { chromium } from "playwright";
import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildIncidentWorkflowV1 } from "./lib/buildIncidentWorkflowV1";

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

async function main() {
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Incident" } }, data: { status: "ARCHIVED" } });
  await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "INCIDENT_RCA_BROWSER_VERIFY", keySuffix: `incident-browser-${Date.now()}` });

  const intakeTeam = await prisma.team.create({ data: { name: "事件受理窗口", domain: "INCIDENT", isActive: true } });
  const intakeLead = await prisma.user.create({ data: { name: "IntakeLeadBrowser", email: "intake-lead-browser@formal-org.example.invalid", role: "PM", isActive: true } });
  await prisma.userRole.create({ data: { userId: intakeLead.id, role: "PM", isActive: true } });
  await prisma.teamMember.create({ data: { teamId: intakeTeam.id, userId: intakeLead.id, membershipRole: "LEAD", isActive: true } });

  const securityTeam = await prisma.team.create({ data: { name: "資安推動小組", domain: "SECURITY", isActive: true } });
  const securityLead = await prisma.user.create({ data: { name: "SecurityLeadBrowser", email: "security-lead-browser@formal-org.example.invalid", role: "資安推動小組", isActive: true } });
  await prisma.userRole.create({ data: { userId: securityLead.id, role: "資安推動小組", isActive: true } });
  await prisma.teamMember.create({ data: { teamId: securityTeam.id, userId: securityLead.id, membershipRole: "LEAD", isActive: true } });

  const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
  const rdLead = org.personByKey.get("tommy")!;
  const rdExecutor = await prisma.user.create({ data: { name: "RdExecutorBrowser", email: "rd-executor-browser@formal-org.example.invalid", role: "RD", isActive: true } });
  await prisma.userRole.create({ data: { userId: rdExecutor.id, role: "RD", isActive: true } });
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdExecutor.id, membershipRole: "MEMBER", isActive: true } });

  const outsider = org.personByKey.get("jonus")!;

  const browser = await chromium.launch({ headless: true });
  try {
    // ===== F01 建立 =====
    console.log("\n=== F01 事件通報建立 ===");
    const reporterContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const reporterPage = await reporterContext.newPage();
    await login(reporterPage, "Selena");
    await reporterPage.goto(`${baseUrl}/issues/incident/new`);
    await settleHydration(reporterPage);
    await reporterPage.locator("#title").fill("[browser-verify] 事件通報");
    await reporterPage.locator("#description").fill("服務回應緩慢，使用者反映登入逾時");
    await reporterPage.locator("#systemName").selectOption("MyDMS");
    await reporterPage.locator("#environment").selectOption("Production");
    await reporterPage.locator("#incidentType").selectOption("服務中斷");
    await reporterPage.locator("#suggestedSeverity").selectOption("中");
    await reporterPage.locator("#occurredAt").fill("2026-08-01T09:00");
    await reporterPage.locator("#reportSource").fill("監控告警");
    await reporterPage.locator("#affectedScope").fill("MyDMS 全體使用者");
    await reporterPage.locator("#impactSummary").fill("登入延遲");
    await reporterPage.getByRole("button", { name: "建立並送出待承接" }).click();
    await reporterPage.waitForURL(/\/issues\/.+\/incident/, { timeout: 15000 });
    check("建立後自動導向事件詳情頁", /\/incident$/.test(new URL(reporterPage.url()).pathname));
    const issue = await prisma.issue.findFirstOrThrow({ where: { title: "[browser-verify] 事件通報" } });
    check("事件已自動送出至待承接關卡", issue.workflowStatus === "pendingIntake");
    await noHorizontalOverflow(reporterPage, "Desktop 1440 建立頁無水平 overflow");
    await reporterContext.close();

    // ===== 受理窗口：九階段進度軸／基本資訊／治理關聯／承接 =====
    console.log("\n=== 事件受理窗口視角：承接、分級、指派 ===");
    const intakeContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const intakePage = await intakeContext.newPage();
    await login(intakePage, "IntakeLeadBrowser");
    await intakePage.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(intakePage);
    check("九階段進度軸顯示", await intakePage.locator('[aria-label="事件通報九階段流程進度"]').count() === 1);
    check("事件基本資訊卡顯示", (await intakePage.locator("body").innerText()).includes("事件基本資訊"));
    check("目前事件流程卡顯示", await intakePage.locator('section[aria-label="目前事件流程"]').count() === 1);
    check("治理關聯區塊顯示", (await intakePage.locator("body").innerText()).includes("關聯治理紀錄"));
    await intakePage.getByRole("button", { name: "承接此事件" }).click();
    await intakePage.getByText(/已承接此事件/).first().waitFor({ timeout: 15000 }).catch(() => undefined);
    await intakePage.waitForTimeout(800);
    let afterClaim = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    check("承接後進入影響確認與分級", afterClaim.workflowStatus === "pendingClassification");

    await intakePage.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(intakePage);
    await intakePage.locator("#formalSeverity").selectOption("高");
    await intakePage.locator("#adjustReason").fill("監控顯示影響擴大");
    await intakePage.getByRole("button", { name: "完成分級" }).click();
    await intakePage.waitForTimeout(800);
    let afterClassify = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    check("分級後進入待指派處理單位", afterClassify.workflowStatus === "pendingUnitAssignment");

    await intakePage.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(intakePage);
    await intakePage.locator("#technicalTeamId").selectOption({ label: "語音與AI技術" });
    await intakePage.getByRole("button", { name: "指派處理單位" }).click();
    await intakePage.waitForTimeout(800);
    let afterUnit = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    check("指派處理單位後進入待技術主管接單與指派", afterUnit.workflowStatus === "pendingTechLeadClaim");
    await noHorizontalOverflow(intakePage, "Desktop 1440 受理窗口視角無水平 overflow");
    await intakeContext.close();

    // ===== 非責任人唯讀 =====
    console.log("\n=== 非責任人唯讀 ===");
    const outsiderContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const outsiderPage = await outsiderContext.newPage();
    await login(outsiderPage, "Jonus");
    await outsiderPage.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(outsiderPage);
    const outsiderPanelText = await outsiderPage.locator("#incident-action-section").innerText();
    check("非責任人看不到操作表單，只看到唯讀提示", outsiderPanelText.includes("可執行此關卡操作，其餘人員唯讀"));
    check("非責任人看不到任何送出按鈕", await outsiderPage.locator("#incident-action-section button[type=submit]").count() === 0);
    await outsiderContext.close();

    // ===== 技術主管：接單並指派 =====
    console.log("\n=== 技術主管接單與指派、初步處置、恢復結果確認 ===");
    const rdLeadUser = await prisma.user.findUniqueOrThrow({ where: { id: rdLead.id } });
    const rdContext = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const rdPage = await rdContext.newPage();
    await login(rdPage, "Tommy");
    await rdPage.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(rdPage);
    await rdPage.locator("#executorUserId").selectOption({ label: "RdExecutorBrowser" });
    await rdPage.getByRole("button", { name: "接單並指派" }).click();
    await rdPage.waitForTimeout(800);
    let afterTechClaim = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    check("技術主管接單指派後進入初步處置與服務恢復", afterTechClaim.workflowStatus === "inHandling");
    await noHorizontalOverflow(rdPage, "Laptop 1024 技術主管視角無水平 overflow");
    await rdContext.close();

    const executorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const executorPage = await executorContext.newPage();
    await login(executorPage, "RdExecutorBrowser");
    await executorPage.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(executorPage);
    await executorPage.locator("#initialHandling").fill("重啟服務");
    await executorPage.locator("#recoveryMeasures").fill("擴充資源");
    await executorPage.locator("#recoveryResult").selectOption("已恢復");
    await executorPage.getByRole("button", { name: "送出初步處置與服務恢復" }).click();
    await executorPage.waitForTimeout(800);
    let afterHandling = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    check("送出處置後進入待恢復結果確認", afterHandling.workflowStatus === "pendingRecoveryConfirmation");
    await noHorizontalOverflow(executorPage, "Mobile 390 執行人視角無水平 overflow");
    await executorContext.close();

    // ===== 受理窗口：恢復確認、RCA 判定、結案 =====
    const intakeContext2 = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const intakePage2 = await intakeContext2.newPage();
    await login(intakePage2, "IntakeLeadBrowser");
    await intakePage2.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(intakePage2);
    await intakePage2.locator("#confirmResult").selectOption("已恢復");
    await intakePage2.getByRole("button", { name: "送出確認" }).click();
    await intakePage2.waitForTimeout(800);
    let afterRecovery = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    check("恢復結果確認通過後進入 RCA 啟動判定", afterRecovery.workflowStatus === "pendingRcaDecision");
    check("服務恢復不等同事件結案", afterRecovery.workflowStatus !== "closed");
    await intakeContext2.close();

    const securityContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const securityPage = await securityContext.newPage();
    await login(securityPage, "SecurityLeadBrowser");
    await securityPage.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(securityPage);
    await securityPage.locator("#needRca").selectOption("否");
    await securityPage.locator("#rca-reason").fill("影響範圍有限，已於初步處置排除");
    await securityPage.getByRole("button", { name: "完成 RCA 啟動判定" }).click();
    await securityPage.waitForTimeout(800);
    let afterRca = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    check("RCA 啟動判定後進入待事件結案確認", afterRca.workflowStatus === "pendingClosureConfirmation");
    await securityContext.close();

    const intakeContext3 = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const intakePage3 = await intakeContext3.newPage();
    await login(intakePage3, "IntakeLeadBrowser");
    await intakePage3.goto(`${baseUrl}/issues/${issue.id}/incident`);
    await settleHydration(intakePage3);
    await intakePage3.getByRole("button", { name: "確認事件結案" }).click();
    await intakePage3.waitForTimeout(800);
    let afterClosure = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    check("不需 RCA 時事件正確結案", afterClosure.workflowStatus === "closed");
    const historyText = await intakePage3.locator("text=簽核紀錄歷程").first().locator("xpath=ancestor::section[1]").innerText();
    check("流程歷程顯示實際責任移交紀錄", historyText.length > 20);
    await noHorizontalOverflow(intakePage3, "Desktop 1440 結案後頁面無水平 overflow");
    await intakeContext3.close();

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
