// @ts-nocheck -- Playwright 由驗證環境提供，不新增 production dependency。
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { prisma } from "../src/lib/prisma";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3100";
let passed = 0;
let failed = 0;
let createdIssueId: string | null = null;
let browserInstance: Browser | null = null;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `（${detail}）` : ""}`);
  }
}

async function login(context: BrowserContext, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  const form = page.locator("form").filter({ hasText: name }).first();
  await form.getByRole("button", { name: "登入" }).click();
  await page.waitForURL(/\/governance/);
  return page;
}

async function summaryCount(page: Page, label: string): Promise<number> {
  const text = await page
    .getByRole("region", { name: "Hotfix 摘要" })
    .getByRole("link")
    .filter({ hasText: label })
    .locator("strong")
    .innerText();
  return Number(text.trim());
}

async function waitUntil(label: string, run: () => Promise<boolean>, timeoutMs = 6_000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      if (await run()) {
        check(label, true);
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  check(label, false, lastError || `超過 ${timeoutMs}ms`);
}

async function main() {
  browserInstance = await chromium.launch({ headless: true });
  const browser = browserInstance;
  const selenaContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const aaronContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const selenaPage = await login(selenaContext, "Selena");
  const aaronPage = await login(aaronContext, "Aaron");

  console.log("\n=== A. 兩位在線使用者與建立前基準 ===");
  await aaronPage.goto(`${baseUrl}/issues?view=hotfix`);
  const initialApprovalCount = await summaryCount(aaronPage, "待主管核准");
  const initialBellLabel = await aaronPage.locator('button[aria-label^="待我處理"]').getAttribute("aria-label");
  check("[1] Aaron 保持在線並停留於 Hotfix 清單", aaronPage.url().includes("/issues?view=hotfix"));
  check("[2] 已取得建立前主管簽核與 Bell 基準", Number.isFinite(initialApprovalCount) && Boolean(initialBellLabel));

  console.log("\n=== B. 暫存僅寫入 localStorage ===");
  await selenaPage.goto(`${baseUrl}/issues/new?type=hotfix`);
  const uniqueTitle = `[browser] Selena 通知 ${Date.now()}`;
  const draftTitle = `[browser-draft] ${Date.now()}`;
  const issueCountBeforeDraft = await prisma.issue.count();
  const approvalCountBeforeDraft = await prisma.approvalRecord.count();
  await selenaPage.locator('input[name="title"]').fill(draftTitle);
  await selenaPage.locator('.ProseMirror[contenteditable="true"]').fill("Selena 建立後等待 Aaron 主管核准");
  await selenaPage.locator('select[name="systemName"]').selectOption("MyDMS");
  await selenaPage.locator('select[name="environment"]').selectOption("Production");
  await selenaPage.locator('select[name="riskLevel"]').selectOption("中");
  await selenaPage.locator('select[name="hotfixPriority"]').selectOption("HIGH");
  await selenaPage.locator('input[name="dueDate"]').fill("2026-08-20");
  await selenaPage.getByRole("button", { name: "暫存", exact: true }).click();
  await selenaPage.getByText("草稿已暫存於此瀏覽器", { exact: false }).waitFor();
  const [issueCountAfterDraft, approvalCountAfterDraft, draftPersisted] = await Promise.all([
    prisma.issue.count(),
    prisma.approvalRecord.count(),
    selenaPage.evaluate(() => Object.keys(window.localStorage).some((key) => key.startsWith("dms:issue-create-draft:") && window.localStorage.getItem(key)?.includes("browser-draft"))),
  ]);
  check("[3] 暫存不建立 Issue 或 Hotfix 單號", issueCountAfterDraft === issueCountBeforeDraft && !selenaPage.url().match(/\/issues\/[^/]+\/hotfix\//));
  check("[4] 暫存不建立 ApprovalRecord 或 Workflow runtime", approvalCountAfterDraft === approvalCountBeforeDraft);
  check("[5] 暫存只保存 localStorage 並顯示成功訊息", draftPersisted);

  console.log("\n=== C. Selena 正式建立 Hotfix ===");
  await selenaPage.locator('input[name="title"]').fill(uniqueTitle);
  await selenaPage.getByRole("button", { name: "建立工單" }).click();
  await selenaPage.waitForURL(/\/issues\/[^/]+\/hotfix\/approval\/requester/, { timeout: 15_000 });
  const issueKeyMatch = (await selenaPage.locator("body").innerText()).match(/HOTFIX-\d{4}/);
  const issueKey = issueKeyMatch?.[0] ?? "";
  const createdIssue = await prisma.issue.findFirst({
    where: { title: uniqueTitle },
    include: {
      currentWorkflowStage: { select: { stageKey: true, label: true } },
      approvalRecords: { where: { recordStatus: "ACTIVE", decision: "PENDING" }, select: { approverUserId: true, approvalType: true } },
    },
  });
  createdIssueId = createdIssue?.id ?? null;
  check("[6] 建立後直接進申請人主管簽核 canonical route", /\/hotfix\/approval\/requester/.test(selenaPage.url()));
  check("[7] 新 Hotfix 有正式單號", /^HOTFIX-\d{4}$/.test(issueKey), issueKey);
  check("[8] 正式建立綁定 Workflow Version 與目前 Stage", Boolean(createdIssue?.workflowVersionId && createdIssue?.currentWorkflowStageId));
  const showsSupervisorApprovalStage = (await selenaPage.getByText("申請人直屬主管簽核", { exact: true }).count()) > 0;
  check(
    "[9] 建立後立即進入申請人直屬主管簽核",
    createdIssue?.currentWorkflowStage?.stageKey === "pendingBusinessApproval" && showsSupervisorApprovalStage,
    `${createdIssue?.currentWorkflowStage?.stageKey ?? "missing"} / ${createdIssue?.currentWorkflowStage?.label ?? "missing"}`,
  );
  check("[10] 建立後產生唯一 ACTIVE/PENDING ApprovalRecord", createdIssue?.approvalRecords.length === 1 && createdIssue.approvalRecords[0]?.approvalType === "BUSINESS_APPROVAL");

  console.log("\n=== D. Aaron 無手動 refresh 的近即時更新 ===");
  await waitUntil("[11] 5 秒內 Bell 待辦數增加", async () => {
    const label = await aaronPage.locator('button[aria-label^="待我處理"]').getAttribute("aria-label");
    const count = Number(label?.match(/共 (\d+) 筆/)?.[1] ?? 0);
    const initial = Number(initialBellLabel?.match(/共 (\d+) 筆/)?.[1] ?? 0);
    return count === initial + 1;
  });
  await waitUntil("[12] 5 秒內主管簽核摘要 +1", async () => (await summaryCount(aaronPage, "待主管核准")) === initialApprovalCount + 1);
  await waitUntil("[13] 新 Hotfix 自動出現在 Aaron 清單", async () => (await aaronPage.getByText(issueKey, { exact: true }).count()) > 0);
  await waitUntil("[14] 清單操作自動更新為待核准", async () => (await aaronPage.getByRole("link", { name: "待核准", exact: true }).count()) > 0);
  const pendingButtonColor = await aaronPage.getByRole("link", { name: "待核准", exact: true }).first().evaluate((element) => getComputedStyle(element).backgroundColor);
  check("[15] 清單待核准使用深紫羅蘭 #6D28D9", pendingButtonColor === "rgb(109, 40, 217)", pendingButtonColor);
  await waitUntil("[16] 只出現一次可理解的核准 Toast", async () => (await aaronPage.getByRole("alert").filter({ hasText: "新的 Hotfix 核准事項" }).count()) === 1);
  await aaronPage.waitForTimeout(4_300);
  check("[17] 後續 polling 不重複建立同一 Toast", (await aaronPage.getByRole("alert").filter({ hasText: "新的 Hotfix 核准事項" }).count()) <= 1);

  console.log("\n=== E. Bell、我的待辦與核准頁 ===");
  await aaronPage.locator('button[aria-label^="待我處理"]').click();
  const bellDialog = aaronPage.getByRole("dialog", { name: "待我處理" });
  const notificationLink = bellDialog.getByRole("link").filter({ hasText: issueKey }).first();
  check("[18] Bell 顯示 Hotfix 待主管核准、Selena 與單號", (await notificationLink.getByText("Hotfix 待主管核准", { exact: true }).count()) === 1 && (await notificationLink.getByText(/Selena/).count()) > 0 && (await notificationLink.getByText(issueKey).count()) > 0);
  await notificationLink.click();
  await aaronPage.waitForURL(new RegExp(`/issues/[^/]+/hotfix/approval/requester`));
  check("[19] 點擊通知進正式主管簽核頁", aaronPage.url().includes("/hotfix/approval/requester"));
  check("[20] Aaron 看得到核准控制", (await aaronPage.getByRole("button", { name: /同意|核准/ }).count()) > 0);

  await aaronPage.goto(`${baseUrl}/issues?view=hotfix&quick=mine`);
  check("[21] 我的待辦包含新 Hotfix", (await aaronPage.getByText(issueKey, { exact: true }).count()) > 0);
  check("[22] 我的待辦仍顯示待核准，不退化為檢視", (await aaronPage.getByRole("link", { name: "待核准", exact: true }).count()) > 0);

  console.log("\n=== F. 非主管收件人與 Responsive ===");
  await selenaPage.goto(`${baseUrl}/issues?view=hotfix`);
  await selenaPage.locator('button[aria-label^="待我處理"]').click();
  check("[23] Selena 不會收到要求自己核准的通知", (await selenaPage.getByRole("dialog", { name: "待我處理" }).getByText(issueKey).count()) === 0);

  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const otherPage = await login(otherContext, "Jonus");
  await otherPage.goto(`${baseUrl}/issues?view=hotfix`);
  await otherPage.locator('button[aria-label^="待我處理"]').click();
  check("[24] 其他 QA 成員不會收到主管通知", (await otherPage.getByRole("dialog", { name: "待我處理" }).getByText(issueKey).count()) === 0);

  await aaronPage.setViewportSize({ width: 390, height: 844 });
  await aaronPage.goto(`${baseUrl}/issues?view=hotfix`);
  await aaronPage.locator('button[aria-label^="待我處理"]').click();
  const overflow = await aaronPage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  const dialogBox = await aaronPage.getByRole("dialog", { name: "待我處理" }).boundingBox();
  check("[25] Mobile 無水平 overflow", overflow.scrollWidth <= overflow.clientWidth, JSON.stringify(overflow));
  check("[26] Mobile Bell 不超出 viewport", Boolean(dialogBox && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 390), JSON.stringify(dialogBox));

  await otherContext.close();
  await selenaContext.close();
  await aaronContext.close();
  await browser.close();
  console.log(`\n=== 結果：${passed} passed / ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
}

async function cleanupCreatedIssue() {
  if (!createdIssueId) return;
  const issueId = createdIssueId;
  await prisma.$transaction(async (tx) => {
    await tx.stageRiskCheck.deleteMany({ where: { issueId } });
    await tx.approvalRecord.deleteMany({ where: { issueId } });
    await tx.issueWorkflowStageHistory.deleteMany({ where: { issueId } });
    await tx.$executeRawUnsafe('DELETE FROM "IssueRelation" WHERE "sourceIssueId" = ? OR "targetIssueId" = ?', issueId, issueId);
    await tx.auditLog.deleteMany({ where: { entityType: "Issue", entityId: issueId } });
    await tx.issue.delete({ where: { id: issueId } });
  });
  console.log(`\n已依 fixture 清理順序移除瀏覽器測試 Issue：${issueId}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await browserInstance?.close();
      await cleanupCreatedIssue();
    } catch (error) {
      console.error("瀏覽器測試資料清理失敗：", error);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  });
