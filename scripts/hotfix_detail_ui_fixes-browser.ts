// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// Hotfix 詳情頁 UI 修正的瀏覽器級驗證：雙箭頭移除、中文附件檔名、附件精簡列表、
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

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3110";
let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}

async function login(page, name: string) {
  await page.goto(`${baseUrl}/login`);
  await page.locator("form").filter({ hasText: name }).first().getByRole("button", { name: "登入" }).click();
  await page.waitForURL(/\/governance/);
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
    check("無錯誤的雙箭頭浮動按鈕", await desktopPage.locator('button[aria-label="向下查看更多內容"]').count() === 0);
    check("中文附件檔名正確顯示（非 mojibake）", bodyText.includes("測試截圖.png") && bodyText.includes("報告附件圖片.png"));
    check("附件縮圖為精簡小尺寸（非全寬大圖）", await desktopPage.locator(".h-14.w-14").count() >= 1);
    check("附件區不再出現 aspect-video 大圖容器", await desktopPage.locator(".aspect-video").count() === 0);
    check("沒有無資料的送簽內容卡", !bodyText.includes("送簽內容"));
    const responsibilityCard = desktopPage.locator('section[aria-label="目前 Hotfix 流程"]');
    await responsibilityCard.waitFor();
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

    console.log("\n=== Mobile 390 ===");
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    await login(mobilePage, "Selena");
    await mobilePage.goto(`${baseUrl}/issues/${issue.id}`);
    await mobilePage.waitForURL(/\/hotfix\/approval\/requester/);
    const mobileBodyText = await mobilePage.locator("body").innerText();
    check("Mobile 中文檔名可正常閱讀", mobileBodyText.includes("測試截圖.png"));
    check("Mobile 無錯誤雙箭頭浮動按鈕", await mobilePage.locator('button[aria-label="向下查看更多內容"]').count() === 0);
    const mobileTimeline = mobilePage.getByRole("region", { name: "簽核紀錄歷程" });
    await mobileTimeline.waitFor();
    await mobileTimeline.getByRole("button", { name: "技術明細" }).first().click();
    check("Mobile 技術明細可操作展開", (await mobileTimeline.innerText()).includes("事件代碼："));
    await noHorizontalOverflow(mobilePage, "Mobile 390 無水平 overflow");
    await mobileContext.close();
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
