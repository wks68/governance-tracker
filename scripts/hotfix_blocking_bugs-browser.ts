// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
import { chromium } from "playwright";
import { prisma } from "../src/lib/prisma";
import { parseRichTextValue, serializeRichTextValue } from "../src/lib/rich-text/value";
import { deleteAttachmentFileIfExists } from "../src/lib/hotfix-ui/attachmentStorage";

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

async function fillHotfix(page, title: string) {
  await page.goto(`${baseUrl}/issues/new?type=hotfix`);
  await page.locator('input[name="title"]').fill(title);
  await page.locator('.ProseMirror[contenteditable="true"]').fill("影片阻擋 Bug 的安全隔離驗證內容");
  await page.locator('select[name="systemName"]').selectOption("MyDMS");
  await page.locator('select[name="environment"]').selectOption("Production");
  await page.locator('select[name="riskLevel"]').selectOption("中");
  await page.locator('select[name="hotfixPriority"]').selectOption("HIGH");
  await page.locator('input[name="dueDate"]').fill("2026-08-20");
}

async function noOverflow(page, label: string) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll("body *")).map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, className: String(element.className).slice(0, 120), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
    }).filter((rect) => rect.right > document.documentElement.clientWidth + 1 || rect.left < -1).slice(0, 8),
  }));
  check(label, size.scrollWidth <= size.clientWidth, JSON.stringify(size));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  let uploadedFileName: string | null = null;
  try {
    await login(page, "Selena");

    console.log("\n=== Scenario 1: conflict then client draft ===");
    const candidatesBefore = await prisma.workflowVersion.findMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Hotfix", isActive: true } }, select: { workflowDefinitionId: true } });
    check("workflow conflict fixture has multiple definitions", new Set(candidatesBefore.map((row) => row.workflowDefinitionId)).size >= 2);
    const issueCountBefore = await prisma.issue.count();
    await fillHotfix(page, `[browser-blocking] conflict ${Date.now()}`);
    await page.getByRole("button", { name: "建立工單" }).click();
    await page.getByText(/目前無法取得唯一可用的 Hotfix 正式流程/).waitFor();
    check("failed create remains on creation page", page.url().includes("/issues/new?type=hotfix"));
    check("failed create leaves Issue count unchanged", await prisma.issue.count() === issueCountBefore);
    await page.getByRole("button", { name: "暫存", exact: true }).click();
    await page.getByText(/草稿已暫存於此瀏覽器/).waitFor();
    check("client draft remains on creation page", page.url().includes("/issues/new?type=hotfix"));
    check("client draft creates no Issue or Hotfix number", await prisma.issue.count() === issueCountBefore && !/HOTFIX-\d{4}/.test(await page.locator("body").innerText()));
    check("client draft is stored in actor-scoped localStorage", await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("dms:issue-create-draft:") && localStorage.getItem(key)?.includes("browser-blocking"))));

    console.log("\n=== Scenario 2: unique workflow formal create ===");
    await prisma.workflowDefinition.updateMany({ where: { issueType: "Hotfix", key: { not: "hotfix-workflow-formal-org" } }, data: { isActive: false } });
    const uniqueCandidates = await prisma.workflowVersion.findMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Hotfix", isActive: true } }, select: { workflowDefinitionId: true } });
    check("safe DB now has one selectable workflow definition", new Set(uniqueCandidates.map((row) => row.workflowDefinitionId)).size === 1);
    await page.getByRole("button", { name: "建立工單" }).click();
    await page.waitForURL(/\/issues\/[^/]+\/hotfix\/approval\/requester/, { timeout: 15_000 });
    const formalIssue = await prisma.issue.findFirst({ where: { title: { contains: "[browser-blocking] conflict" } }, orderBy: { createdAt: "desc" } });
    check("formal create has workflow runtime and supervisor stage", !!formalIssue?.workflowVersionId && formalIssue.workflowStatus === "pendingBusinessApproval");
    check("formal create has one pending approval", !!formalIssue && await prisma.approvalRecord.count({ where: { issueId: formalIssue.id, decision: "PENDING", recordStatus: "ACTIVE" } }) === 1);

    console.log("\n=== Scenario 3: image resize and persistence ===");
    const imageTitle = `[browser-blocking] resize ${Date.now()}`;
    await fillHotfix(page, imageTitle);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: "resize.png", mimeType: "image/png", buffer: png });
    const editorImage = page.locator(".rich-text-image-node img").first();
    await editorImage.waitFor();
    await editorImage.click();
    for (const [label, width] of [["小 25%", "25"], ["中 50%", "50"], ["大 75%", "75"], ["滿版 100%", "100"]]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      check(`image switches to ${width}%`, await page.locator(".rich-text-image-node").first().getAttribute("data-width-percent") === width);
    }
    await page.getByRole("button", { name: "中 50%", exact: true }).click();
    await page.getByRole("button", { name: "建立工單" }).click();
    await page.waitForURL(/\/hotfix\/approval\/requester/, { timeout: 15_000 });
    const imageIssue = await prisma.issue.findFirstOrThrow({ where: { title: imageTitle }, orderBy: { createdAt: "desc" } });
    const imageNode = parseRichTextValue(imageIssue.description).doc.content?.find((node) => node.type === "image");
    uploadedFileName = typeof imageNode?.attrs?.src === "string" ? imageNode.attrs.src.split("/").at(-1) ?? null : null;
    check("persisted Rich Text JSON keeps 50%", imageNode?.attrs?.widthPercent === 50);
    await page.reload();
    await page.locator('.rich-text-viewer [data-width-percent="50"]').first().waitFor();
    check("reloaded viewer keeps 50%", await page.locator('.rich-text-viewer [data-width-percent="50"]').count() > 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "mobile resized image has no horizontal overflow");

    console.log("\n=== Scenario 4: readable rich history ===");
    const requester = await prisma.user.findUniqueOrThrow({ where: { id: imageIssue.reporterUserId! } });
    const missingImage = "/api/hotfix-attachments/00000000-0000-4000-8000-000000000000";
    const longText = "這是一段用來驗證歷程換行與可讀性的長內容。".repeat(40);
    const richHistory = serializeRichTextValue({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: longText }] },
      { type: "image", attrs: { src: imageNode!.attrs!.src, widthPercent: 50 } },
    ] });
    const missingHistory = serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: missingImage, widthPercent: 100 } }] });
    const record = await prisma.approvalRecord.create({ data: {
      issueId: imageIssue.id, approvalType: "RD_LEAD_APPROVAL", relatedStageKey: "pendingRdLeadApproval",
      requestedByUserId: requester.id, requestedAt: new Date(), approverUserId: requester.id,
      decision: "APPROVED", recordStatus: "ACTIVE", decidedAt: new Date(), revisionNo: 99,
    } });
    await prisma.issueFieldValue.create({ data: {
      issueId: imageIssue.id, fieldKey: `workflowSubmission:pendingRdLeadApproval:${record.id}`,
      fieldLabel: "Workflow submission snapshot",
      fieldValue: JSON.stringify({ values: { rdFixDescription: richHistory, rdSelfTestResult: missingHistory } }),
    } });
    await prisma.auditLog.create({ data: {
      entityType: "Issue", entityId: imageIssue.id, actionType: "FieldChange",
      summary: `更新欄位：問題描述：「${richHistory}」→「${missingHistory}」`,
      actorUserId: requester.id, reasonCode: "ASSIGN_EXECUTOR",
    } });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.reload();
    const timeline = page.getByRole("region", { name: "簽核紀錄歷程" });
    await timeline.waitFor();
    await timeline.getByText("圖片附件目前無法預覽").first().waitFor();
    const timelineText = await timeline.innerText();
    check("history does not expose Rich Text JSON or attachment URL", !timelineText.includes("dms-rich-text") && !timelineText.includes("/api/hotfix-attachments/") && !timelineText.includes("[object Object]"));
    check("FieldChange shows separate Before and After", timelineText.includes("Before") && timelineText.includes("After"));
    check("technical code is not the main heading", !(await timeline.getByRole("heading").allTextContents()).some((text) => text.includes("ASSIGN_EXECUTOR")));
    check("missing image uses fallback instead of broken icon", timelineText.includes("圖片附件目前無法預覽") && (await timeline.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))));
    await noOverflow(page, "desktop history has no horizontal overflow");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "mobile history has no horizontal overflow");
  } finally {
    if (uploadedFileName) await deleteAttachmentFileIfExists(uploadedFileName);
    await context.close();
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
