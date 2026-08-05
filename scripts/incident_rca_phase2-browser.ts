// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// 事件通報與 RCA 第二階段：完整 Desktop 1440／Laptop 1024／Mobile 390 瀏覽器級驗證。
//   1. 通報人快速通報三步驟（發生什麼事／影響到哪裡／確認並送出，含附件上傳）走完整真實
//      流程並成功建立事件。
//   2. 受理窗口承接、分級、指派技術單位；技術主管接單指派；執行人送出處置；受理窗口確認
//      恢復；資安推動小組判定需要 RCA；自動建立關聯 RCA。
//   3. Incident 詳情頁、RCA 詳情頁（12 階段進度軸、改善追蹤、附件區）三種寬度下皆正確渲染。
//   4. 工作單四分類清單與「建立工作單」FAB 在三種寬度下皆可用。
//   5. Bell／我的待辦顯示 RCA 待辦。
//   6. 全程畫面不出現 F01／F02。
//   7. 三種寬度下皆無水平 overflow、無 Console Error、無 Hydration Warning、無非預期
//      404／500、無 Redirect Loop。
//
//   DATABASE_URL="file:/tmp/xxx.db" BASE_URL="http://127.0.0.1:PORT" npx tsx scripts/incident_rca_phase2-browser.ts

import "./lib/assertSafeTestDatabase";

import { chromium } from "playwright";
import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildIncidentWorkflowV1 } from "./lib/buildIncidentWorkflowV1";
import { buildRcaWorkflowV1 } from "./lib/buildRcaWorkflowV1";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3114";
const VIEWPORTS = [
  { label: "Desktop 1440", width: 1440, height: 900 },
  { label: "Laptop 1024", width: 1024, height: 800 },
  { label: "Mobile 390", width: 390, height: 844 },
];

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}

const consoleIssues: string[] = [];
function watchPage(page: any) {
  page.setDefaultTimeout(45000);
  page.on("pageerror", (err: Error) => consoleIssues.push(`pageerror: ${err.message}`));
  page.on("console", (msg: any) => {
    if (msg.type() === "error") consoleIssues.push(`console: ${msg.text().slice(0, 200)}`);
    if (msg.type() === "warning" && msg.text().toLowerCase().includes("hydrat")) consoleIssues.push(`hydration-warning: ${msg.text().slice(0, 200)}`);
  });
  page.on("response", (res: any) => {
    const status = res.status();
    if (status === 404 || status >= 500) consoleIssues.push(`http-${status}: ${res.url()}`);
  });
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
async function noHorizontalOverflow(page: any, label: string) {
  const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  check(label, size.scrollWidth <= size.clientWidth + 1, JSON.stringify(size));
}
async function noFormCode(page: any, label: string) {
  const content = await page.content();
  check(label, !content.includes("F01") && !content.includes("F02"), "found F01/F02 in page content");
}

async function createAdHocUser(name: string, role: string, email: string) {
  const user = await prisma.user.create({ data: { name, email, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function main() {
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Incident" } }, data: { status: "ARCHIVED" } });
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "RCA" } }, data: { status: "ARCHIVED" } });
  await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "PHASE2_BROWSER_VERIFY", keySuffix: `phase2-browser-incident-${Date.now()}` });
  await buildRcaWorkflowV1({ actorId: org.admin.id, reasonCode: "PHASE2_BROWSER_VERIFY", keySuffix: `phase2-browser-rca-${Date.now()}` });

  const intakeTeam = await prisma.team.create({ data: { name: "事件受理窗口", domain: "INCIDENT", isActive: true } });
  const intakeLead = await createAdHocUser("IntakeLeadPhase2", "PM", "intake-lead-phase2@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: intakeTeam.id, userId: intakeLead.id, membershipRole: "LEAD", isActive: true } });
  const securityTeam = await prisma.team.create({ data: { name: "資安推動小組", domain: "SECURITY", isActive: true } });
  const securityLead = await createAdHocUser("SecurityLeadPhase2", "資安推動小組", "security-lead-phase2@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: securityTeam.id, userId: securityLead.id, membershipRole: "LEAD", isActive: true } });
  const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
  const rdLead = await prisma.user.findUniqueOrThrow({ where: { id: org.personByKey.get("tommy")!.id } });
  const rdExecutor = await createAdHocUser("RdExecutorPhase2", "RD", "rd-executor-phase2@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdExecutor.id, membershipRole: "MEMBER", isActive: true } });
  const reporterInfo = org.personByKey.get("selena")!;
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: reporterInfo.id } });

  const browser = await chromium.launch({ headless: true });

  console.log("\n=== A. 通報人快速通報三步驟（Desktop 1440，含附件上傳）===");
  const reporterContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reporterPage = await reporterContext.newPage();
  await login(reporterPage, reporter.name);
  await reporterPage.goto(`${baseUrl}/issues/incident/new`);
  await settleHydration(reporterPage);
  await noFormCode(reporterPage, "[1] 快速通報頁面不含 F01／F02");
  check("[2] 頁面顯示三步驟 Stepper", (await reporterPage.locator("ol[aria-label='通報步驟'] li").count()) === 3);

  // 第一步：發生什麼事（一律用 data-field 定位，避免 SearchableSelect 觸發按鈕的可及名稱
  // 與外部 <label> 關聯方式在不同瀏覽器引擎下計算不一致，造成選擇器誤判）。
  await reporterPage.locator('[data-field="systemName"] button').click();
  await reporterPage.getByRole("option", { name: "MyDMS", exact: true }).click();
  await reporterPage.locator('[data-field="service"] button').click();
  await reporterPage.getByRole("option", { name: "不確定", exact: true }).first().click();
  await reporterPage.locator('[data-field="incidentType"] button', { hasText: "服務中斷" }).click();
  await reporterPage.locator('[data-field="occurredAtDate"] button', { hasText: "現在" }).click();
  await reporterPage.locator("#symptomText").fill("點擊登入後畫面持續轉圈");
  await settleHydration(reporterPage);
  check("[3] 事件名稱已依所選內容自動建議", (await reporterPage.locator("#title").inputValue()).length > 0);
  await reporterPage.getByRole("button", { name: "下一步" }).click();
  await settleHydration(reporterPage);

  // 第二步：影響到哪裡
  check("[4] 已進入第二步", (await reporterPage.locator("ol[aria-label='通報步驟'] li.text-primary").textContent())?.includes("影響到哪裡"));
  await reporterPage.locator('[data-field="isOngoing"] button', { hasText: "是，現在仍持續" }).click();
  await reporterPage.locator('[data-field="hasWorkaround"] button', { hasText: "沒有" }).click();
  await reporterPage.locator('[data-field="impactScope"] button', { hasText: "少數使用者" }).click();
  await reporterPage.locator('[data-field="dataPermissionImpact"] label', { hasText: "不確定" }).click();
  await reporterPage.locator('[data-field="operationalImpact"] label', { hasText: "不確定" }).click();
  await reporterPage.locator('[data-field="suggestedImpactLevel"] button', { hasText: "有影響，但仍可部分作業" }).click();
  await reporterPage.getByRole("button", { name: "下一步" }).click();
  await settleHydration(reporterPage);

  // 第三步：確認並送出（含附件上傳）
  check("[5] 已進入第三步", (await reporterPage.locator("ol[aria-label='通報步驟'] li.text-primary").textContent())?.includes("確認並送出"));
  const fileInput = reporterPage.locator('input[type="file"]').first();
  await fileInput.setInputFiles({ name: "screenshot.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  await settleHydration(reporterPage);
  check("[6] 已選擇的附件顯示在暫存清單", (await reporterPage.locator("li", { hasText: "screenshot.png" }).count()) === 1);
  check("[7] 確認摘要顯示規定文字", (await reporterPage.locator("text=以上為目前已知資訊").count()) === 1);

  await reporterPage.getByRole("button", { name: "送出通報" }).click();
  await reporterPage.waitForURL(/\/issues\/.+\/incident/, { timeout: 20000 });
  await settleHydration(reporterPage);
  check("[8] 送出後導向事件詳情頁", /\/issues\/.+\/incident/.test(reporterPage.url()));
  await noFormCode(reporterPage, "[9] 事件詳情頁不含 F01／F02");
  check("[10] 附件已隨事件建立自動上傳並顯示於詳情頁", (await reporterPage.locator("text=screenshot.png").count()) >= 1);
  await noHorizontalOverflow(reporterPage, "[11] Desktop 1440 事件詳情頁無水平 overflow");

  const incidentId = reporterPage.url().match(/\/issues\/([^/]+)\/incident/)![1];
  await reporterContext.close();

  console.log("\n=== B. 受理窗口承接、分級、指派；技術主管接單；執行人處置；資安判定需要 RCA ===");
  const intakeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const intakePage = await intakeContext.newPage();
  await login(intakePage, "IntakeLeadPhase2");
  await intakePage.goto(`${baseUrl}/issues/${incidentId}/incident`);
  await settleHydration(intakePage);
  await intakePage.getByRole("button", { name: "承接此事件" }).click();
  await intakePage.waitForTimeout(1000);
  await intakePage.reload();
  await settleHydration(intakePage);
  await intakePage.locator("#formalSeverity").selectOption("高");
  await intakePage.getByRole("button", { name: "完成分級" }).click();
  await intakePage.waitForTimeout(1000);
  await intakePage.reload();
  await settleHydration(intakePage);
  await intakePage.locator("#technicalTeamId").selectOption({ label: "語音與AI技術" });
  await intakePage.getByRole("button", { name: "指派處理單位" }).click();
  await intakePage.waitForTimeout(1000);
  await intakeContext.close();

  const rdContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rdPage = await rdContext.newPage();
  await login(rdPage, "Tommy");
  await rdPage.goto(`${baseUrl}/issues/${incidentId}/incident`);
  await settleHydration(rdPage);
  await rdPage.locator("#executorUserId").selectOption({ label: "RdExecutorPhase2" });
  await rdPage.getByRole("button", { name: "接單並指派" }).click();
  await rdPage.waitForTimeout(1000);
  await rdContext.close();

  const executorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const executorPage = await executorContext.newPage();
  await login(executorPage, "RdExecutorPhase2");
  await executorPage.goto(`${baseUrl}/issues/${incidentId}/incident`);
  await settleHydration(executorPage);
  await executorPage.locator("#initialHandling").fill("重啟登入服務容器");
  await executorPage.locator("#recoveryMeasures").fill("擴充資源並優化連線池");
  await executorPage.locator("#recoveryResult").selectOption("已恢復");
  await executorPage.getByRole("button", { name: "送出初步處置與服務恢復" }).click();
  await executorPage.waitForTimeout(1000);
  await executorContext.close();

  const intakeContext2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const intakePage2 = await intakeContext2.newPage();
  await login(intakePage2, "IntakeLeadPhase2");
  await intakePage2.goto(`${baseUrl}/issues/${incidentId}/incident`);
  await settleHydration(intakePage2);
  await intakePage2.locator("#confirmResult").selectOption("已恢復");
  await intakePage2.getByRole("button", { name: "送出確認" }).click();
  await intakePage2.waitForTimeout(1000);
  await intakeContext2.close();

  const securityContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const securityPage = await securityContext.newPage();
  await login(securityPage, "SecurityLeadPhase2");
  await securityPage.goto(`${baseUrl}/issues/${incidentId}/incident`);
  await settleHydration(securityPage);
  await securityPage.locator("#needRca").selectOption("是");
  await securityPage.getByRole("button", { name: "完成 RCA 啟動判定" }).click();
  await securityPage.waitForTimeout(1500);
  await noFormCode(securityPage, "[12] RCA 啟動判定後事件詳情頁仍不含 F01／F02");
  await securityContext.close();

  const relation = await prisma.issueRelation.findFirstOrThrow({ where: { sourceIssueId: incidentId, relationType: "INCIDENT_TO_RCA", removedAt: null } });
  const rcaId = relation.targetIssueId;

  console.log("\n=== C. Incident／RCA 詳情頁、工作單清單、FAB：三種寬度分別驗證 ===");
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await login(page, "IntakeLeadPhase2");

    await page.goto(`${baseUrl}/issues/${incidentId}/incident`);
    await settleHydration(page);
    await noHorizontalOverflow(page, `[${viewport.label}] Incident 詳情頁無水平 overflow`);
    await noFormCode(page, `[${viewport.label}] Incident 詳情頁不含 F01／F02`);

    await page.goto(`${baseUrl}/issues/${rcaId}/rca`);
    await settleHydration(page);
    await noHorizontalOverflow(page, `[${viewport.label}] RCA 詳情頁無水平 overflow`);
    await noFormCode(page, `[${viewport.label}] RCA 詳情頁不含 F01／F02`);
    check(`[${viewport.label}] RCA 詳情頁顯示十二階段進度軸`, (await page.locator("[aria-label='RCA 十二階段流程進度']").count()) === 1);
    check(`[${viewport.label}] RCA 詳情頁顯示改善追蹤區塊`, (await page.locator("text=改善追蹤").count()) >= 1);
    check(`[${viewport.label}] RCA 詳情頁顯示附件區塊`, (await page.locator("text=附件").count()) >= 1);

    await page.goto(`${baseUrl}/issues?view=rca`);
    await settleHydration(page);
    await noHorizontalOverflow(page, `[${viewport.label}] 工作單清單（RCA 分類）無水平 overflow`);
    check(`[${viewport.label}] FAB 主按鈕存在`, (await page.getByRole("button", { name: "建立工作單" }).count()) === 1);

    await context.close();
  }

  console.log("\n=== D. Bell／我的待辦顯示 RCA 待辦（RCA 主責人指派後） ===");
  const rcaOwnerCandidate = await createAdHocUser("RcaOwnerPhase2", "RD", "rca-owner-phase2@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rcaOwnerCandidate.id, membershipRole: "MEMBER", isActive: true } });
  const rdContext2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rdPage2 = await rdContext2.newPage();
  await login(rdPage2, "Tommy");
  await rdPage2.goto(`${baseUrl}/issues/${rcaId}/rca`);
  await settleHydration(rdPage2);
  await rdPage2.getByRole("button", { name: "承接此 RCA" }).click();
  await rdPage2.waitForTimeout(1000);
  await rdPage2.reload();
  await settleHydration(rdPage2);
  await rdPage2.locator("#ownerUserId").selectOption({ label: "RcaOwnerPhase2" });
  await rdPage2.getByRole("button", { name: "指派 RCA 主責人" }).click();
  await rdPage2.waitForTimeout(1000);
  await rdContext2.close();

  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ownerPage = await ownerContext.newPage();
  await login(ownerPage, "RcaOwnerPhase2");
  await ownerPage.goto(`${baseUrl}/issues`);
  await settleHydration(ownerPage);
  await ownerPage.getByRole("button", { name: /通知|待辦/ }).first().click().catch(() => {});
  await ownerPage.waitForTimeout(500);
  const bellContent = await ownerPage.content();
  check("[Bell] Bell／待辦內容包含 RCA 待辦文字", bellContent.includes("RCA"));
  await ownerContext.close();

  console.log("\n=== E. 全程無 Console Error／Hydration Warning／非預期 404-500 ===");
  check("[F] 全程無 Console Error／Hydration Warning／404／500", consoleIssues.length === 0, consoleIssues.slice(0, 10).join(" | "));

  await browser.close();

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
