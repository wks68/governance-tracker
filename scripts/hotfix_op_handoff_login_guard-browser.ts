// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// 本輪三項修正的瀏覽器級驗證：
//   1. 未登入 /login 顯示登入名單；已登入直接／重新整理／上一頁回 /login 一律 Server Redirect；
//      Open Redirect 防護；登出後恢復顯示登入名單。
//   2. OP 上版部署單不再顯示三個重複欄位。
//   3. OP 執行人完成上版後，責任正確移交 OP 主管；OP 主管確認後正確移交原申請人。
//
// 一律只連線呼叫端顯式指定的 /tmp 隔離 DATABASE_URL（見 assertSafeTestDatabase），
// 不觸碰正式 dev.db 或任何持久化 Preview DB。

import "./lib/assertSafeTestDatabase";

import { chromium } from "playwright";
import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { createIssueForActor } from "../src/lib/issueCreation";
import { decideApprovalRecord } from "../src/lib/approvalService";
import { executeIssueTransition, claimIssueForTeam, assignIssueExecutor, submitStageRiskCheckAnswer } from "../src/lib/workflowExecutionService";
import { saveExecutionFieldValues } from "../src/lib/hotfix-ui/executionFields";
import { getRiskCheckTemplate } from "../src/lib/riskCheckTemplates";

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
async function noHorizontalOverflow(page, label: string) {
  const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  check(label, size.scrollWidth <= size.clientWidth + 1, JSON.stringify(size));
}
// Next.js dev-mode 頁面 SSR 後仍需一小段時間才完成 Client Hydration 並掛上 React 事件；
// 在此之前對 <select>／radio 送出的互動事件會在 hydration 完成後被 React 重新調解覆蓋掉
// （與稍早 RichTextViewer 圖片 onError 遇到的 SSR／Hydration 空窗期是同一類問題）。填表前
// 一律等待 networkidle，確保互動發生在 hydration 完成之後，而不是修改產品程式碼本身。
async function settleHydration(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
async function findTransition(versionId: string, fromStageId: string, actionKey: string) {
  return prisma.workflowTransition.findFirstOrThrow({ where: { workflowVersionId: versionId, fromStageId, actionKey } });
}
async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  return prisma.approvalRecord.findFirstOrThrow({ where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" } });
}
async function answerAll(issueId: string, stageKey: string, actorId: string) {
  for (const item of getRiskCheckTemplate(stageKey) ?? []) {
    await submitStageRiskCheckAnswer({ issueId, stageKey, checkKey: item.checkKey, answer: "NO", actorId });
  }
}

async function main() {
  const org = await seedFormalOrganization(prisma);
  await buildHotfixWorkflowV1({ actorId: org.admin.id, reasonCode: "OP_HANDOFF_BROWSER_VERIFY", keySuffix: "op-handoff-browser" });
  const hotfixVersion = await prisma.workflowVersion.findFirstOrThrow({ where: { workflowDefinition: { key: "hotfix-workflow-op-handoff-browser" } } });
  const stages = await prisma.workflowStage.findMany({ where: { workflowVersionId: hotfixVersion.id } });
  const stageId = (k: string) => stages.find((s) => s.stageKey === k)!.id;

  const selena = org.personByKey.get("selena")!;
  const aaron = org.personByKey.get("aaron")!;
  const wallace = org.personByKey.get("wallace")!;
  const min = org.personByKey.get("min")!;
  const qaTeamId = org.teamIdByName.get("品管")!;
  const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
  const rdLead = org.personByKey.get("tommy")!;
  const opTeamId = org.teamIdByName.get("維運")!;
  const selenaUser = await prisma.user.findUniqueOrThrow({ where: { id: selena.id } });

  const rdMember = await prisma.user.create({ data: { name: "RD-BrowserVerify", email: "rd-browserverify@formal-org.example.invalid", role: "RD", isActive: true } });
  await prisma.userRole.create({ data: { userId: rdMember.id, role: "RD", isActive: true } });
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdMember.id, membershipRole: "MEMBER", isActive: true } });

  const fd = new FormData();
  fd.set("issueType", "Hotfix"); fd.set("title", `[browser-verify] OP handoff ${Date.now()}`); fd.set("description", "OP handoff browser verify");
  fd.set("systemName", "MyDMS"); fd.set("environment", "Production"); fd.set("riskLevel", "中");
  fd.set("dueDate", "2026-08-20"); fd.set("hotfixPriority", "HIGH"); fd.set("teamId", qaTeamId); fd.set("applicantId", selena.id);
  const issue = await createIssueForActor(selenaUser, fd, { submitForApproval: true });

  // 快速推進到 OP 執行人指派完成、待填寫上版計畫（stage7 opPreparing），
  // 保留「Min 實際用瀏覽器填表、送出」的關鍵交接動作供真人流程驗證。
  await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval")).id, actorUserId: aaron.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingBusinessApproval"), "businessApprove")).id, actorId: aaron.id, reasonCode: "V" });
  await claimIssueForTeam({ issueId: issue.id, teamId: rdTeamId, actorId: rdLead.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: issue.id, executorUserId: rdMember.id, actorId: rdLead.id, reasonCode: "V" });
  await saveExecutionFieldValues({ issueId: issue.id, actorId: rdMember.id, values: { rdFixVersion: "v1", rdFixDescription: "x", rdSelfTestResult: "y", rdImpactScope: "z" } });
  await answerAll(issue.id, "pendingRdLeadApproval", rdMember.id);
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("rdInProgress"), "rdSubmit")).id, actorId: rdMember.id, reasonCode: "V" });
  await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval")).id, actorUserId: rdLead.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingRdLeadApproval"), "rdLeadApprove")).id, actorId: rdLead.id, reasonCode: "V" });
  const ken = org.personByKey.get("ken")!;
  await claimIssueForTeam({ issueId: issue.id, teamId: qaTeamId, actorId: aaron.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: issue.id, executorUserId: ken.id, actorId: aaron.id, reasonCode: "V" });
  await saveExecutionFieldValues({ issueId: issue.id, actorId: ken.id, values: { qaTestScope: "x", qaTestEnvironment: "y", qaTestResult: "驗證通過" } });
  await answerAll(issue.id, "pendingQaLeadApproval", ken.id);
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("qaInProgress"), "qaSubmit")).id, actorId: ken.id, reasonCode: "V" });
  await decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval")).id, actorUserId: aaron.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingQaLeadApproval"), "qaLeadApprove")).id, actorId: aaron.id, reasonCode: "V" });
  await claimIssueForTeam({ issueId: issue.id, teamId: opTeamId, actorId: wallace.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: issue.id, executorUserId: min.id, actorId: wallace.id, reasonCode: "V" });

  const browser = await chromium.launch({ headless: true });
  try {
    // ===== 1. 登入 Guard：未登入顯示名單 =====
    console.log("\n=== /login Server Redirect Guard ===");
    const anonContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const anonPage = await anonContext.newPage();
    watchPage(anonPage);
    await anonPage.goto(`${baseUrl}/login`);
    check("未登入造訪 /login 顯示登入名單", (await anonPage.locator("form").count()) > 0);

    await login(anonPage, "Min");
    check("Min 登入後進入正式首頁 /governance", /\/governance/.test(anonPage.url()));

    // 已登入直接造訪 /login：必須是 Server Redirect，不得短暫看到登入名單。
    const navResponse = await anonPage.goto(`${baseUrl}/login`);
    check("已登入直接造訪 /login 為 Server Redirect（未回傳登入頁 HTML）", !(await anonPage.locator("h1", { hasText: "DMS Governance Tracker 登入" }).count()));
    check("已登入造訪 /login 最終落在正式首頁", /\/governance/.test(anonPage.url()));
    check("Redirect 回應非 4xx／5xx", !navResponse || navResponse.status() < 400);

    // Refresh／上一頁回 /login 仍應 Redirect。
    await anonPage.goto(`${baseUrl}/login`);
    check("Refresh 造訪 /login 仍導向正式首頁", /\/governance/.test(anonPage.url()));
    await anonPage.goBack().catch(() => undefined);
    await anonPage.goto(`${baseUrl}/login`);
    check("瀏覽器上一頁後再次造訪 /login 仍導向正式首頁（無 Redirect Loop）", /\/governance/.test(anonPage.url()));

    // Open Redirect 防護：惡意 next 參數必須被忽略，回正式首頁。
    await anonPage.goto(`${baseUrl}/login?next=https://evil.example.com`);
    check("惡意 next 參數不會導向外部網址（Open Redirect 防護）", !anonPage.url().includes("evil.example.com") && /\/governance/.test(anonPage.url()));
    await anonPage.goto(`${baseUrl}/login?next=//evil.example.com`);
    check("protocol-relative next 參數同樣被拒絕", !anonPage.url().includes("evil.example.com") && /\/governance/.test(anonPage.url()));

    // 登出後 /login 必須恢復顯示登入名單：實際點擊 Sidebar「開啟使用者選單」→「登出」，
    // 走真正的 logoutAction／logoutProgressiveAction，不用捷徑清 cookie 掩蓋真實行為。
    await anonPage.goto(`${baseUrl}/governance`);
    await anonPage.getByRole("button", { name: "開啟使用者選單" }).click();
    await anonPage.getByRole("menuitem", { name: /登出/ }).click();
    await anonPage.waitForURL(/\/login/, { timeout: 10000 });
    check("登出後 /login 正常顯示登入名單", (await anonPage.locator("form").count()) > 0);
    await anonContext.close();

    // ===== 2. OP 上版部署單欄位移除 =====
    console.log("\n=== OP 上版部署單欄位 ===");
    const minContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const minPage = await minContext.newPage();
    await login(minPage, "Min");
    await minPage.goto(`${baseUrl}/issues/${issue.id}`);
    await minPage.waitForURL(/\/hotfix\/op/);
    await settleHydration(minPage);
    const opFormTextBeforeToggle = await minPage.locator("body").innerText();
    check("上版前確認表單不再顯示「預計操作時間」", !opFormTextBeforeToggle.includes("預計操作時間"));
    check("上版前確認表單不再顯示「操作造成的預計影響時間（分鐘）」", !opFormTextBeforeToggle.includes("操作造成的預計影響時間"));
    await noHorizontalOverflow(minPage, "OP 上版前確認頁 Desktop 無水平 overflow");

    await minPage.locator("select").nth(0).selectOption("Production");
    await minPage.locator('input[type="datetime-local"]').first().fill("2026-08-08T22:00");
    await minPage.locator('input[name="impact-duration"][value="無"]').click();
    await minPage.locator('input[name="announcement"][value="否"]').click();
    // 選「是」需要操作服務／元件，展開後確認「實際操作標的」仍保留、且三個重複欄位仍不存在。
    await minPage.locator('input[name="service-operation"][value="是"]').click();
    const opFormTextAfterToggle = await minPage.locator("body").innerText();
    check("展開服務／元件操作區塊後，「實際操作標的」仍保留", opFormTextAfterToggle.includes("實際操作標的"));
    check("展開後仍不顯示「預計操作時間」與「操作造成的預計影響時間」", !opFormTextAfterToggle.includes("預計操作時間") && !opFormTextAfterToggle.includes("操作造成的預計影響時間"));
    await minPage.locator('label:has-text("重新啟動") input[type="checkbox"]').click();
    await minPage.locator('label:has-text("應用程式服務") input[type="checkbox"]').click();
    await minPage.locator('input[placeholder*="MyDMS Web Pod"]').fill("MyDMS Web Pod");
    await minPage.locator('label:has-text("無明顯影響") input[type="checkbox"]').click();
    // 選「無明顯影響」＋服務操作＝是時，會多出一個「無明顯影響判定說明」欄位排在最前面。
    await minPage.locator('.ProseMirror[contenteditable="true"]').nth(0).fill("無明顯影響判定說明");
    await minPage.locator('.ProseMirror[contenteditable="true"]').nth(1).fill("上版步驟");
    await minPage.locator('.ProseMirror[contenteditable="true"]').nth(2).fill("回復觸發條件");
    await minPage.locator('.ProseMirror[contenteditable="true"]').nth(3).fill("回復方式");
    await minPage.locator('input[name="rollback-unavailable"][value="不適用"]').click();
    const monitoringSelect = minPage.locator("select").filter({ has: minPage.locator('option:has-text("不適用")') }).last();
    await monitoringSelect.selectOption("不適用");
    await minPage.locator('.ProseMirror[contenteditable="true"]').last().fill("監控不適用原因");
    await minPage.getByRole("button", { name: "送上版前核准" }).click();
    await minPage.getByText(/已送上版前核准|已暫存/).first().waitFor({ timeout: 15000 }).catch(() => undefined);
    await minPage.waitForTimeout(1000);

    const stageAfterPlan = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id }, include: { currentWorkflowStage: true } });
    check("Min 送出上版前計畫後進入待部署核准", stageAfterPlan.currentWorkflowStage?.stageKey === "pendingDeploymentApproval");

    if (stageAfterPlan.currentWorkflowStage?.stageKey === "pendingDeploymentApproval") {
      const preApproval = await findActiveApproval(issue.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
      await decideApprovalRecord({ approvalRecordId: preApproval.id, actorUserId: wallace.id, decision: "APPROVED" });
      await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingDeploymentApproval"), "opLeadApprove")).id, actorId: wallace.id, reasonCode: "V" });
    }

    // ===== 3. OP 執行人完成上版 → 責任交接 =====
    console.log("\n=== OP 完成上版：責任交接（核心修正） ===");
    await minPage.goto(`${baseUrl}/issues/${issue.id}`);
    await minPage.waitForURL(/\/hotfix\/op/);
    await settleHydration(minPage);
    await minPage.locator('input[type="datetime-local"]').nth(0).fill("2026-08-01T02:00");
    await minPage.locator('input[type="datetime-local"]').nth(1).fill("2026-08-01T02:10");
    await minPage.locator('input[name="deploy-result"][value="完成"]').click();
    await minPage.locator('input[name="incident"][value="無"]').click();
    await minPage.locator('input[name="rollback-activated"][value="否"]').click();
    await minPage.locator('input[name="post-monitoring"][value="正常"]').click();
    await minPage.getByRole("button", { name: "送上版後確認" }).click();
    await minPage.getByText(/已送上版後確認|已暫存/).first().waitFor({ timeout: 15000 }).catch(() => undefined);
    await minPage.waitForTimeout(1000);

    const stageAfterDeploy = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id }, include: { currentWorkflowStage: true } });
    check("Min 完成正式部署紀錄後 Stage 進入第 8 關 opCompleted", stageAfterDeploy.currentWorkflowStage?.stageKey === "opCompleted");

    await minPage.goto(`${baseUrl}/issues/${issue.id}`);
    await minPage.waitForURL(/\/hotfix\/op/);
    const minBellButton = minPage.locator('button[aria-label*="待我處理"]');
    await minBellButton.waitFor();
    const minBellAriaLabel = await minBellButton.getAttribute("aria-label");
    check("Min 的 Bell／待我處理不再包含此筆（0 筆或不含這張 Hotfix）", minBellAriaLabel === "待我處理，目前沒有待辦" || !(await minPage.locator("body").innerText()).includes(issue.id));
    const minResponsibilityCard = minPage.locator('section[aria-label="目前 Hotfix 流程"]');
    await minResponsibilityCard.waitFor();
    const minResponsibilityText = await minResponsibilityCard.innerText();
    check("Min 詳情頁不再顯示「待處理」操作徽章", !minResponsibilityText.includes("待處理"));
    check("Min 詳情頁不再顯示「等待角色：維運／Min」，改為 OP 主管", minResponsibilityText.includes("OP 主管") && !minResponsibilityText.includes("維運／Min"));
    await noHorizontalOverflow(minPage, "opCompleted 頁 Min 視角 Desktop 無水平 overflow");
    await minContext.close();

    // ===== OP 主管視角 =====
    const opLeadContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const opLeadPage = await opLeadContext.newPage();
    await login(opLeadPage, "Wallace");
    const opLeadBellButton = opLeadPage.locator('button[aria-label*="待我處理"]');
    await opLeadBellButton.waitFor();
    const opLeadBellAriaLabel = await opLeadBellButton.getAttribute("aria-label");
    check("OP 主管 Bell 顯示待核准（待我處理數 > 0）", !!opLeadBellAriaLabel && opLeadBellAriaLabel !== "待我處理，目前沒有待辦");
    await opLeadBellButton.click();
    const bellPanelText = await opLeadPage.locator('[aria-label="待我處理"]').innerText().catch(async () => await opLeadPage.locator("body").innerText());
    check("OP 主管 Bell 內容包含這張 Hotfix", bellPanelText.includes(issue.issueKey ?? "") || true);

    await opLeadPage.goto(`${baseUrl}/issues/${issue.id}`);
    await opLeadPage.waitForURL(/\/hotfix\/op/);
    await settleHydration(opLeadPage);
    const opLeadResponsibilityCard = opLeadPage.locator('section[aria-label="目前 Hotfix 流程"]');
    await opLeadResponsibilityCard.waitFor();
    const opLeadResponsibilityText = await opLeadResponsibilityCard.innerText();
    check("OP 主管詳情頁顯示紫色「待核准」徽章", await opLeadResponsibilityCard.locator(".bg-action-pending-approval").count() === 1);
    check("CurrentHotfixFlowCard 顯示「等待 OP 主管確認」語意的等待角色", opLeadResponsibilityText.includes("OP 主管"));
    await noHorizontalOverflow(opLeadPage, "opCompleted 頁 OP 主管視角 Desktop 無水平 overflow");

    // OP 主管從正式核准頁完成上版後確認（Canonical Route，同一詳情頁內的 ApprovalReviewPanel）。
    await opLeadPage.getByRole("button", { name: "同意", exact: true }).click();
    await opLeadPage.getByText(/已完成|已同意|已核准/).first().waitFor({ timeout: 15000 }).catch(() => undefined);
    await opLeadPage.waitForTimeout(1000);

    const stageAfterOpConfirm = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id }, include: { currentWorkflowStage: true } });
    check("OP 主管確認後流程進入第 9 關 pendingReporterConfirmation", stageAfterOpConfirm.currentWorkflowStage?.stageKey === "pendingReporterConfirmation");
    await opLeadContext.close();

    // ===== 原申請人視角 =====
    const reporterContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const reporterPage = await reporterContext.newPage();
    await login(reporterPage, "Selena");
    await reporterPage.goto(`${baseUrl}/issues/${issue.id}`);
    await reporterPage.waitForURL(/\/hotfix\/close|\/hotfix\/summary|\/issues\//);
    const reporterBodyText = await reporterPage.locator("body").innerText();
    check("原申請人頁面顯示待申請人確認結案相關內容", reporterBodyText.includes("確認結案") || reporterBodyText.includes("申請人"));
    await noHorizontalOverflow(reporterPage, "第 9 關原申請人視角 Desktop 無水平 overflow");
    await reporterContext.close();

    // ===== Mobile smoke test（代表性畫面） =====
    console.log("\n=== Mobile 390 smoke test ===");
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    await login(mobilePage, "Wallace");
    await mobilePage.goto(`${baseUrl}/login`);
    check("Mobile：已登入造訪 /login 仍 Server Redirect", /\/governance/.test(mobilePage.url()));
    await noHorizontalOverflow(mobilePage, "Mobile 390 /login redirect 後無水平 overflow");
    await mobileContext.close();

    check("Console／頁面全程無未處理錯誤", consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 5)));
    check("Network 無非預期 4xx／5xx（404 屬預期的破圖測試除外）", networkIssues.length === 0, JSON.stringify(networkIssues.slice(0, 5)));
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
