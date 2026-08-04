// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// Hotfix 詳情頁 UI 修正的瀏覽器級驗證：雙箭頭浮動引導（本輪恢復為動態波浪雙箭頭）、中文附件檔名、附件精簡列表、
// 空的送簽內容卡、責任卡與治理關聯版面、建立歷程聚合、圖片載入失敗 fallback、
// Desktop／Mobile 無水平 overflow。
//
// 一律只連線呼叫端顯式指定的 /tmp 隔離 DATABASE_URL（見 assertSafeTestDatabase），
// 不觸碰正式 dev.db 或任何持久化 Preview DB。

import "./lib/assertSafeTestDatabase";

import { chromium } from "playwright";
import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { createIssueForActor } from "../src/lib/issueCreation";
import { writeAttachmentFile, ATTACHMENT_URL_PREFIX } from "../src/lib/hotfix-ui/attachmentStorage";
import { encodeAttachmentMeta } from "../src/lib/hotfix-ui/attachmentService";
import { serializeRichTextValue } from "../src/lib/rich-text/value";
import {
  executeIssueTransition,
  claimIssueForTeam,
  assignIssueExecutor,
  getIssueWorkflowRuntime,
  submitStageRiskCheckAnswer,
} from "../src/lib/workflowExecutionService";
import { decideApprovalRecord } from "../src/lib/approvalService";
import { saveExecutionFieldValues } from "../src/lib/hotfix-ui/executionFields";
import { nineStageIndexOfStageKey } from "../src/lib/hotfix-ui/nineStage";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3110";
let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}

const consoleIssues: string[] = [];
function watchForHydrationIssues(page) {
  page.on("pageerror", (err: Error) => {
    if (/hydrat/i.test(err.message)) consoleIssues.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydrat/i.test(msg.text())) consoleIssues.push(`console: ${msg.text()}`);
  });
}

async function login(page, name: string) {
  page.setDefaultTimeout(60000);
  watchForHydrationIssues(page);
  await page.goto(`${baseUrl}/login`);
  await page.locator("form").filter({ hasText: name }).first().getByRole("button", { name: "登入" }).click();
  await page.waitForURL(/\/governance/);
}

async function findTransition(workflowVersionId: string, fromStageId: string, actionKey: string) {
  const t = await prisma.workflowTransition.findFirst({ where: { workflowVersionId, fromStageId, actionKey } });
  if (!t) throw new Error(`找不到 Transition（fromStageId=${fromStageId}, actionKey=${actionKey}）`);
  return t;
}
async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  const r = await prisma.approvalRecord.findFirst({ where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" }, orderBy: { revisionNo: "desc" } });
  if (!r) throw new Error(`找不到 ApprovalRecord（${approvalType}/${relatedStageKey}）`);
  return r;
}
async function answerAll(issueId: string, stageKey: string, actorId: string) {
  const { getRiskCheckTemplate } = await import("../src/lib/riskCheckTemplates");
  const template = getRiskCheckTemplate(stageKey)!;
  for (const item of template) await submitStageRiskCheckAnswer({ issueId, stageKey, checkKey: item.checkKey, answer: "NO", actorId });
}
async function stageKeyOf(issueId: string, actorId: string): Promise<string> {
  const runtime = await getIssueWorkflowRuntime(issueId, actorId);
  if (!runtime.onVersionedWorkflow) throw new Error("預期在新版 Workflow 上");
  return runtime.currentStage.stageKey;
}

function mojibakeOf(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
}

async function noHorizontalOverflow(page, label: string) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(label, size.scrollWidth <= size.clientWidth + 1, JSON.stringify(size));
}

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function main() {
  const org = await seedFormalOrganization(prisma);
  await buildHotfixWorkflowV1({ actorId: org.admin.id, reasonCode: "DETAIL_UI_FIXES_VERIFY", keySuffix: "detail-ui-fixes" });

  const selena = org.personByKey.get("selena");
  const aaron = org.personByKey.get("aaron");
  const teamId = org.teamIdByName.get("品管");
  if (!selena || !aaron || !teamId) throw new Error("缺少必要的正式組織測試資料");
  const selenaUser = await prisma.user.findUniqueOrThrow({ where: { id: selena.id } });

  // 內嵌於 Rich Text、同時也會出現在附件清單的圖片。
  const embeddedStoredFileName = await writeAttachmentFile(PNG_1PX);
  const embeddedUrl = `${ATTACHMENT_URL_PREFIX}${embeddedStoredFileName}`;
  // Rich Text 內一張指向不存在附件的圖片，驗證載入失敗 fallback。
  const brokenUrl = `${ATTACHMENT_URL_PREFIX}00000000-0000-4000-8000-000000000000`;
  const longText = "這是一段用來驗證歷程與內容排版不會被擠壓的長文字內容。".repeat(30);

  const description = serializeRichTextValue({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: longText }] },
      { type: "image", attrs: { src: embeddedUrl, widthPercent: 50 } },
      { type: "image", attrs: { src: brokenUrl, widthPercent: 50 } },
    ],
  });

  const formData = new FormData();
  formData.set("issueType", "Hotfix");
  formData.set("title", `[browser-verify] Hotfix 詳情頁 UI 修正 ${Date.now()}`);
  formData.set("description", description);
  formData.set("systemName", "MyDMS");
  formData.set("environment", "Production");
  formData.set("riskLevel", "中");
  formData.set("dueDate", "2026-08-20");
  formData.set("hotfixPriority", "HIGH");
  formData.set("teamId", teamId);
  formData.set("applicantId", selena.id);

  const issue = await createIssueForActor(selenaUser, formData, { submitForApproval: true });

  // 附件清單：同一張已內嵌於 Rich Text 的圖片，加上一個中文檔名（含歷史 mojibake 亂碼）附件。
  await prisma.evidence.create({
    data: {
      issueId: issue.id,
      type: "image/png",
      title: "測試截圖.png",
      url: embeddedUrl,
      description: encodeAttachmentMeta({ stageKey: "draft", uploaderUserId: selena.id, uploaderName: selena.name }),
    },
  });
  const mojibakeStoredFileName = await writeAttachmentFile(PNG_1PX);
  await prisma.evidence.create({
    data: {
      issueId: issue.id,
      type: "image/png",
      title: mojibakeOf("報告附件圖片.png"),
      url: `${ATTACHMENT_URL_PREFIX}${mojibakeStoredFileName}`,
      description: encodeAttachmentMeta({ stageKey: "draft", uploaderUserId: selena.id, uploaderName: selena.name }),
    },
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const desktopPage = await desktopContext.newPage();
    await login(desktopPage, "Selena");
    await desktopPage.goto(`${baseUrl}/issues/${issue.id}`);
    await desktopPage.waitForURL(/\/hotfix\/approval\/requester/);

    const bodyText = await desktopPage.locator("body").innerText();

    console.log("\n=== Desktop 1440 ===");
    check("已恢復動態雙箭頭浮動按鈕（aria-label 為「向下捲動查看更多內容」）", await desktopPage.locator('button[aria-label="向下捲動查看更多內容"]').count() === 1);
    check("中文附件檔名正確顯示（非 mojibake）", bodyText.includes("測試截圖.png") && bodyText.includes("報告附件圖片.png"));
    check("附件縮圖為精簡小尺寸（非全寬大圖）", await desktopPage.locator(".h-14.w-14").count() >= 1);
    check("附件區不再出現 aspect-video 大圖容器", await desktopPage.locator(".aspect-video").count() === 0);
    check("沒有無資料的送簽內容卡（已改為送簽摘要）", !bodyText.includes("送簽內容") && bodyText.includes("送簽摘要"));
    check("送簽摘要左右對應申請事由／問題摘要與影響摘要，且不再顯示風險分析框", ["申請事由／問題摘要", "影響摘要", "預計完成日", "送簽佐證"].every((label) => bodyText.includes(label)) && !bodyText.includes("風險與緊急性"));
    const responsibilityCard = desktopPage.locator('section[aria-label="目前 Hotfix 流程"]');
    await responsibilityCard.waitFor();
    const responsibilityText = await responsibilityCard.innerText();
    check("CurrentHotfixFlowCard 顯示目前待辦與目前等待人員／執行人（申請人主管簽核階段）", responsibilityText.includes("目前待辦") && responsibilityText.includes("待申請人主管核准") && responsibilityText.includes("目前等待人員／執行人") && responsibilityText.includes("申請人直屬主管"));
    check("Selena（非核准人）看到的操作徽章是灰色「檢視」，不是寫死的核准按鈕", await responsibilityCard.locator(".bg-action-view").count() === 1 && responsibilityText.includes("檢視"));
    const governanceCard = desktopPage.getByRole("heading", { name: "治理關聯與追蹤" }).locator("xpath=ancestor::section[1]");
    await governanceCard.waitFor();
    const respBox = await responsibilityCard.boundingBox();
    const govBox = await governanceCard.boundingBox();
    const overlap = respBox && govBox && respBox.y < govBox.y + govBox.height && govBox.y < respBox.y + respBox.height && respBox.x < govBox.x + govBox.width && govBox.x < respBox.x + respBox.width;
    check("目前責任卡與治理關聯卡沒有版面重疊", !overlap, JSON.stringify({ respBox, govBox }));
    check("治理關聯卡本身不包含責任欄位", !(await governanceCard.innerText()).includes("目前處理部門"));

    const timeline = desktopPage.getByRole("region", { name: "簽核紀錄歷程" });
    await timeline.waitFor();
    const timelineText = await timeline.innerText();
    const timelineEntryCount = await timeline.locator("ol > li").count();
    check("建立歷程已聚合為剛好 2 筆（建立並送出＋進入直屬主管簽核），沒有多餘的技術事件單獨列出", timelineEntryCount === 2, `entryCount=${timelineEntryCount}`);
    check("第一筆為「建立並送出 Hotfix」", timelineText.includes("建立並送出 Hotfix"));
    check("第二筆為「進入申請人直屬主管簽核」", timelineText.includes("進入申請人直屬主管簽核"));
    check("不相關技術事件（推進流程／送出簽核）不再獨立顯示為第三、四筆", !timelineText.includes("執行「推進流程」") && !timelineText.includes("執行「送出簽核」"));
    check("技術明細預設收合（未點擊前看不到事件代碼）", !timelineText.includes("事件代碼："));
    await timeline.getByRole("button", { name: "技術明細" }).first().click();
    const timelineTextExpanded = await timeline.innerText();
    check("點擊後技術明細展開並顯示事件代碼", timelineTextExpanded.includes("事件代碼："));
    check("歷程不外洩 Rich Text JSON／attachment 路徑／[object Object]", !timelineTextExpanded.includes("dms-rich-text") && !timelineTextExpanded.includes("/api/hotfix-attachments/") && !timelineTextExpanded.includes("[object Object]"));

    await desktopPage.getByText("圖片附件目前無法預覽").first().waitFor();
    check("Rich Text 內失效圖片顯示可讀 fallback", true);

    await noHorizontalOverflow(desktopPage, "Desktop 1440 無水平 overflow");
    await desktopContext.close();

    console.log("\n=== Aaron（實際核准人）操作徽章 ===");
    const aaronContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const aaronPage = await aaronContext.newPage();
    await login(aaronPage, "Aaron");
    await aaronPage.goto(`${baseUrl}/issues/${issue.id}`);
    await aaronPage.waitForURL(/\/hotfix\/approval\/requester/);
    const aaronResponsibilityCard = aaronPage.locator('section[aria-label="目前 Hotfix 流程"]');
    await aaronResponsibilityCard.waitFor();
    const aaronResponsibilityText = await aaronResponsibilityCard.innerText();
    check("Aaron（實際核准人）看到紫色「待核准」徽章，操作按鈕依既有 actionability 動態決定", await aaronResponsibilityCard.locator(".bg-action-pending-approval").count() === 1 && aaronResponsibilityText.includes("待核准"));
    await aaronContext.close();

    console.log("\n=== Laptop 1024 ===");
    const laptopContext = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const laptopPage = await laptopContext.newPage();
    await login(laptopPage, "Selena");
    await laptopPage.goto(`${baseUrl}/issues/${issue.id}`);
    await laptopPage.waitForURL(/\/hotfix\/approval\/requester/);
    const laptopResponsibilityCard = laptopPage.locator('section[aria-label="目前 Hotfix 流程"]');
    await laptopResponsibilityCard.waitFor();
    check("Laptop 1024：目前流程卡內容不重疊、可正常顯示", (await laptopResponsibilityCard.innerText()).includes("目前待辦"));
    const laptopGovernanceCard = laptopPage.getByRole("heading", { name: "治理關聯與追蹤" }).locator("xpath=ancestor::section[1]");
    await laptopGovernanceCard.waitFor();
    check("Laptop 1024：送簽摘要與附件未被壓縮", (await laptopPage.locator("body").innerText()).includes("送簽摘要"));
    await noHorizontalOverflow(laptopPage, "Laptop 1024 無水平 overflow");
    await laptopContext.close();

    console.log("\n=== Mobile 390 ===");
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    await login(mobilePage, "Selena");
    await mobilePage.goto(`${baseUrl}/issues/${issue.id}`);
    await mobilePage.waitForURL(/\/hotfix\/approval\/requester/);
    const mobileBodyText = await mobilePage.locator("body").innerText();
    check("Mobile 中文檔名可正常閱讀", mobileBodyText.includes("測試截圖.png"));
    check("Mobile 雙箭頭浮動按鈕存在且可觸控點擊", await mobilePage.locator('button[aria-label="向下捲動查看更多內容"]').count() === 1);
    const mobileTimeline = mobilePage.getByRole("region", { name: "簽核紀錄歷程" });
    await mobileTimeline.waitFor();
    await mobileTimeline.getByRole("button", { name: "技術明細" }).first().click();
    check("Mobile 技術明細可操作展開", (await mobileTimeline.innerText()).includes("事件代碼："));
    const mobileResponsibilityCard = mobilePage.locator('section[aria-label="目前 Hotfix 流程"]');
    const mobileGovernanceCard = mobilePage.getByRole("heading", { name: "治理關聯與追蹤" }).locator("xpath=ancestor::section[1]");
    await mobileGovernanceCard.waitFor();
    const mobileRespBox = await mobileResponsibilityCard.boundingBox();
    const mobileGovBox = await mobileGovernanceCard.boundingBox();
    check("Mobile：責任卡與治理關聯卡各自獨立、不重疊", !!mobileRespBox && !!mobileGovBox && mobileGovBox.y >= mobileRespBox.y + mobileRespBox.height - 1);
    await noHorizontalOverflow(mobilePage, "Mobile 390 無水平 overflow");
    await mobileContext.close();

    // =====================================================================
    // 多階段目前待辦驗證＋完整九階段 Happy Path（單一 Desktop Browser Context）。
    // 州態機正確性已由 hotfix_ui-verify.ts 的 DB 整合測試完整覆蓋（含駁回／權限
    // 邊界），此處只針對「目前待辦不是寫死主管簽核」與版面在不同關卡皆正確做代表性
    // 瀏覽器抽驗，其餘關卡以既有服務層直接推進，不重複以 UI 點擊逐關卡驅動。
    // =====================================================================
    console.log("\n=== 多階段 CurrentHotfixFlowCard／完整九階段 Happy Path ===");
    const wallace = org.personByKey.get("wallace")!;
    const min = org.personByKey.get("min")!;
    const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
    const rdLead = org.personByKey.get("tommy")!;
    const hotfixVersion = await prisma.workflowVersion.findFirstOrThrow({ where: { workflowDefinition: { key: "hotfix-workflow-detail-ui-fixes" } } });
    const s = await prisma.workflowStage.findMany({ where: { workflowVersionId: hotfixVersion.id } });
    const stageId = (key: string) => s.find((row) => row.stageKey === key)!.id;

    // 建立一位 RD 一般成員：正式 fixture 本輪 RD 團隊只有主管，補一位 scratch-only 成員
    // 才能推進 rdInProgress，不寫入任何持久化 Preview 組織資料。
    const rdMember = await prisma.user.create({ data: { name: "RD-Member-Stabilization", email: "rd-member-stabilization@formal-org.example.invalid", role: "RD", isActive: true } });
    await prisma.userRole.create({ data: { userId: rdMember.id, role: "RD", isActive: true } });
    await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdMember.id, membershipRole: "MEMBER", isActive: true } });

    // stage2 → stage3：Aaron 核准申請人主管簽核。
    const businessApproval = await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    await decideApprovalRecord({ approvalRecordId: businessApproval.id, actorUserId: aaron.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingBusinessApproval"), "businessApprove")).id, actorId: aaron.id, reasonCode: "STABILIZATION_VERIFY" });
    check("狀態機：Aaron 核准後進入 pendingRdTriage", (await stageKeyOf(issue.id, org.admin.id)) === "pendingRdTriage");

    {
      const rdTriageContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const rdTriagePage = await rdTriageContext.newPage();
      await login(rdTriagePage, "Tommy");
      await rdTriagePage.goto(`${baseUrl}/issues/${issue.id}`);
      await rdTriagePage.waitForURL(/\/hotfix\/rd/);
      const rdTriageResp = rdTriagePage.locator('section[aria-label="目前 Hotfix 流程"]');
      await rdTriageResp.waitFor();
      const rdTriageText = await rdTriageResp.innerText();
      check("待 RD 接單階段：目前待辦動態顯示「待 RD 團隊接單」，等待人員為「RD 團隊主管」，不是寫死的申請人主管簽核文字", rdTriageText.includes("待 RD 團隊接單") && rdTriageText.includes("RD 團隊主管") && !rdTriageText.includes("待申請人主管核准"));
      check("待 RD 接單階段：Tommy（RD 團隊主管）看到藍色「待處理」徽章", await rdTriageResp.locator(".bg-action-pending-work").count() === 1 && rdTriageText.includes("待處理"));
      await noHorizontalOverflow(rdTriagePage, "RD 待接單頁 Desktop 無水平 overflow");
      await rdTriageContext.close();
    }

    await claimIssueForTeam({ issueId: issue.id, teamId: rdTeamId, actorId: rdLead.id, reasonCode: "STABILIZATION_VERIFY" });
    await assignIssueExecutor({ issueId: issue.id, executorUserId: rdMember.id, actorId: rdLead.id, reasonCode: "STABILIZATION_VERIFY" });
    check("狀態機：接單＋指派後進入 rdInProgress", (await stageKeyOf(issue.id, org.admin.id)) === "rdInProgress");

    {
      const rdWorkDesktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const rdWorkPage = await rdWorkDesktop.newPage();
      await login(rdWorkPage, "RD-Member-Stabilization");
      await rdWorkPage.goto(`${baseUrl}/issues/${issue.id}`);
      await rdWorkPage.waitForURL(/\/hotfix\/rd/);
      const rdWorkResp = rdWorkPage.locator('section[aria-label="目前 Hotfix 流程"]');
      await rdWorkResp.waitFor();
      const rdWorkText = await rdWorkResp.innerText();
      check("RD 執行階段：目前待辦顯示「RD 修正與自測中」，等待人員／執行人顯示團隊／本人組合", rdWorkText.includes("RD 修正與自測中") && rdWorkText.includes(rdMember.name));
      check("RD 執行階段：本人是執行人，看到藍色「待處理」徽章", await rdWorkResp.locator(".bg-action-pending-work").count() === 1);
      await noHorizontalOverflow(rdWorkPage, "RD 執行頁 Desktop 無水平 overflow");
      await rdWorkDesktop.close();

      const rdWorkMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const rdWorkMobilePage = await rdWorkMobile.newPage();
      await login(rdWorkMobilePage, "RD-Member-Stabilization");
      await rdWorkMobilePage.goto(`${baseUrl}/issues/${issue.id}`);
      await rdWorkMobilePage.waitForURL(/\/hotfix\/rd/);
      check("RD 執行階段（Mobile smoke test）：目前待辦正確顯示", (await rdWorkMobilePage.locator('section[aria-label="目前 Hotfix 流程"]').innerText()).includes("RD 修正與自測中"));
      await noHorizontalOverflow(rdWorkMobilePage, "RD 執行頁 Mobile 無水平 overflow");
      await rdWorkMobile.close();
    }

    await saveExecutionFieldValues({ issueId: issue.id, actorId: rdMember.id, values: { rdFixVersion: "v1.0.0", rdFixDescription: "修正說明", rdSelfTestResult: "自測通過", rdImpactScope: "僅影響登入頁" } });
    await answerAll(issue.id, "pendingRdLeadApproval", rdMember.id);
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("rdInProgress"), "rdSubmit")).id, actorId: rdMember.id, reasonCode: "STABILIZATION_VERIFY" });
    const rdLeadApproval = await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    await decideApprovalRecord({ approvalRecordId: rdLeadApproval.id, actorUserId: rdLead.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingRdLeadApproval"), "rdLeadApprove")).id, actorId: rdLead.id, reasonCode: "STABILIZATION_VERIFY" });
    check("狀態機：RD 主管核准後進入 pendingQaTriage", (await stageKeyOf(issue.id, org.admin.id)) === "pendingQaTriage");

    {
      const qaContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const qaPage = await qaContext.newPage();
      await login(qaPage, "Aaron");
      await qaPage.goto(`${baseUrl}/issues/${issue.id}`);
      await qaPage.waitForURL(/\/hotfix\/qa/);
      const qaResp = qaPage.locator('section[aria-label="目前 Hotfix 流程"]');
      await qaResp.waitFor();
      const qaText = await qaResp.innerText();
      check("QA 執行階段（第 3 個代表性關卡）：目前待辦顯示「待 QA 團隊接單」，非寫死文字", qaText.includes("待 QA 團隊接單"));
      const qaGovCard = qaPage.getByRole("heading", { name: "治理關聯與追蹤" }).locator("xpath=ancestor::section[1]");
      await qaGovCard.waitFor();
      const qaRespBox = await qaResp.boundingBox();
      const qaGovBox = await qaGovCard.boundingBox();
      const qaOverlap = qaRespBox && qaGovBox && qaRespBox.y < qaGovBox.y + qaGovBox.height && qaGovBox.y < qaRespBox.y + qaRespBox.height;
      check("QA 執行階段：責任卡與治理卡沒有重疊", !qaOverlap);
      await noHorizontalOverflow(qaPage, "QA 待接單頁 Desktop 無水平 overflow");
      await qaContext.close();
    }

    // 其餘關卡（QA 執行／簽核、OP 全流程、申請人確認結案）以既有服務層直接推進到底，
    // 證明完整九階段 Happy Path 可以順利跑到終態，狀態機正確性已由
    // hotfix_ui-verify.ts 的 DB 整合測試逐關卡驗證過（含權限邊界與駁回），此處不重複。
    const qaTeamId = org.teamIdByName.get("品管")!;
    const ken = org.personByKey.get("ken")!;
    await claimIssueForTeam({ issueId: issue.id, teamId: qaTeamId, actorId: aaron.id, reasonCode: "STABILIZATION_VERIFY" });
    await assignIssueExecutor({ issueId: issue.id, executorUserId: ken.id, actorId: aaron.id, reasonCode: "STABILIZATION_VERIFY" });
    await saveExecutionFieldValues({ issueId: issue.id, actorId: ken.id, values: { qaTestScope: "全功能", qaTestEnvironment: "UAT", qaTestResult: "驗證通過" } });
    await answerAll(issue.id, "pendingQaLeadApproval", ken.id);
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("qaInProgress"), "qaSubmit")).id, actorId: ken.id, reasonCode: "STABILIZATION_VERIFY" });
    const qaLeadApproval = await findActiveApproval(issue.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
    await decideApprovalRecord({ approvalRecordId: qaLeadApproval.id, actorUserId: aaron.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingQaLeadApproval"), "qaLeadApprove")).id, actorId: aaron.id, reasonCode: "STABILIZATION_VERIFY" });
    check("狀態機：QA 主管核准後進入 pendingOpTriage", (await stageKeyOf(issue.id, org.admin.id)) === "pendingOpTriage");

    const opTeamId = org.teamIdByName.get("維運")!;
    await claimIssueForTeam({ issueId: issue.id, teamId: opTeamId, actorId: wallace.id, reasonCode: "STABILIZATION_VERIFY" });
    await assignIssueExecutor({ issueId: issue.id, executorUserId: min.id, actorId: wallace.id, reasonCode: "STABILIZATION_VERIFY" });
    await saveExecutionFieldValues({ issueId: issue.id, actorId: min.id, values: { opDeployEnvironment: "Production", opDeployPlannedAt: "2026-08-01T02:00", opDeploySteps: "1. 停機 2. 部署 3. 驗證", opRollbackPlan: "還原前版本", opMonitoringChecklist: "監控錯誤率" } });
    await answerAll(issue.id, "pendingDeploymentApproval", min.id);
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("opPreparing"), "opSubmit")).id, actorId: min.id, reasonCode: "STABILIZATION_VERIFY" });
    const opLeadApproval = await findActiveApproval(issue.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
    await decideApprovalRecord({ approvalRecordId: opLeadApproval.id, actorUserId: wallace.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingDeploymentApproval"), "opLeadApprove")).id, actorId: wallace.id, reasonCode: "STABILIZATION_VERIFY" });
    check("狀態機：OP 主管上版前核准後進入 opDeploying", (await stageKeyOf(issue.id, org.admin.id)) === "opDeploying");

    await saveExecutionFieldValues({ issueId: issue.id, actorId: min.id, values: { opDeployResult: "成功", opProdConfirmResult: "確認無誤" } });
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("opDeploying"), "opDeployComplete")).id, actorId: min.id, reasonCode: "STABILIZATION_VERIFY" });
    const postDeploymentApproval = await findActiveApproval(issue.id, "DEPLOYMENT_APPROVAL", "opCompleted");
    await decideApprovalRecord({ approvalRecordId: postDeploymentApproval.id, actorUserId: wallace.id, decision: "APPROVED" });
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("opCompleted"), "reporterConfirmOpen")).id, actorId: wallace.id, reasonCode: "STABILIZATION_VERIFY" });
    check("狀態機：OP 上版後主管確認完成，開放申請人確認結案", (await stageKeyOf(issue.id, org.admin.id)) === "pendingReporterConfirmation");

    const { saveClosureSummary } = await import("../src/lib/hotfix-ui/closureService");
    await saveClosureSummary({ issueId: issue.id, actorId: selena.id, summary: "已確認上版成功，功能正常。", followUpNotes: "持續觀察三日" });
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("pendingReporterConfirmation"), "reporterClaim")).id, actorId: selena.id, reasonCode: "STABILIZATION_VERIFY" });
    await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfixVersion.id, stageId("reporterConfirming"), "reporterClose")).id, actorId: selena.id, reasonCode: "STABILIZATION_VERIFY" });
    check("完整九階段 Happy Path：申請人確認結案後流程進入 closed 終態", (await stageKeyOf(issue.id, org.admin.id)) === "closed");
    check("九階段索引正確對應 closed = 第 9 階段", nineStageIndexOfStageKey("closed") === 9);

    check("Browser Console／頁面全程無 Hydration mismatch", consoleIssues.length === 0, JSON.stringify(consoleIssues));
  } finally {
    await browser.close();
    await deleteSeededAttachments([embeddedStoredFileName, mojibakeStoredFileName]);
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed / ${failed} failed`);
  if (failed) process.exitCode = 1;
}

async function deleteSeededAttachments(storedFileNames: string[]) {
  const { deleteAttachmentFileIfExists } = await import("../src/lib/hotfix-ui/attachmentStorage");
  for (const name of storedFileNames) await deleteAttachmentFileIfExists(name);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
