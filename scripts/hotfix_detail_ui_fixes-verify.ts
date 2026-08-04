// Hotfix 詳情頁 UI 修正驗證（雙箭頭、附件檔名亂碼、附件重複大圖、空的送簽內容卡、
// 責任卡與治理關聯版面、建立歷程聚合、技術明細收合）。純原始碼靜態檢查與純函式單元測試，
// 不連線任何資料庫，可直接執行：
//   npx tsx scripts/hotfix_detail_ui_fixes-verify.ts

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { repairDisplayFileName, asciiFallbackFileName } from "../src/lib/hotfix-ui/fileNameDisplay";
import { getHistoryPlainText } from "../src/lib/rich-text/value";
import { formatDateTime, formatDate } from "../src/lib/datetime";

const ROOT = process.cwd();
let passed = 0;
function test(name: string, run: () => void) { run(); passed += 1; console.log(`PASS ${name}`); }
function source(relativePath: string): string { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }

function mojibakeOf(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
}

console.log("\n=== 雙箭頭 ScrollDownChevron 移除 ===");
const shell = source("src/components/hotfix-nine-stage/HotfixStageShell.tsx");
const selector = source("src/components/issue-relations/GovernanceRelationSelector.tsx");
const appShell = source("src/components/app-shell/AppShell.tsx");
test("Hotfix 詳情頁不再 import 或 render ScrollDownChevron", () => {
  assert.ok(!shell.includes("ScrollDownChevron"));
});
test("ScrollDownChevron 元件檔案已刪除，不以其他浮動箭頭替代", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "src/components/ui/ScrollDownChevron.tsx")));
});
test("合法的 Select／Accordion Chevron 未被誤刪", () => {
  assert.ok(selector.includes("ChevronDown"));
  assert.ok(appShell.includes("ChevronDown") && appShell.includes("ChevronRight"));
});

console.log("\n=== 附件中文檔名亂碼修復（顯示層，僅可逆時修復） ===");
test("典型 UTF-8-as-Latin1 mojibake 可安全還原", () => {
  const original = "測試截圖.png";
  const corrupted = mojibakeOf(original);
  assert.notEqual(corrupted, original);
  assert.equal(repairDisplayFileName(corrupted), original);
});
test("原本就正確的中文檔名不被誤改", () => {
  const original = "已修正的正確檔名.docx";
  assert.equal(repairDisplayFileName(original), original);
});
test("一般英數檔名不受影響", () => {
  assert.equal(repairDisplayFileName("note.txt"), "note.txt");
});
test("ASCII fallback 檔名保留副檔名並移除非 ASCII 字元", () => {
  const fallback = asciiFallbackFileName("測試截圖.png");
  assert.ok(/^[\x20-\x7e]+$/.test(fallback));
  assert.ok(fallback.endsWith(".png"));
});

console.log("\n=== Content-Disposition UTF-8／ASCII fallback ===");
const downloadRoute = source("src/app/api/hotfix-attachments/[storedFileName]/route.ts");
test("下載／預覽同時提供 ASCII fallback 與 UTF-8 filename*", () => {
  assert.ok(downloadRoute.includes('filename="'));
  assert.ok(downloadRoute.includes("filename*=UTF-8''"));
  assert.ok(downloadRoute.includes("repairDisplayFileName"));
});
test("不把使用者檔名當實體路徑：仍以 storedFileName 讀取磁碟檔案", () => {
  assert.ok(downloadRoute.includes("readAttachmentFile(params.storedFileName)"));
});

console.log("\n=== 附件區精簡列表（不重複顯示大圖、無固定巨大高度） ===");
const attachmentSection = source("src/components/hotfix-nine-stage/AttachmentSection.tsx");
test("附件卡不再使用固定 aspect-video 大圖或 h-full 撐滿高度", () => {
  assert.ok(!attachmentSection.includes("aspect-video"));
  assert.ok(!attachmentSection.includes("ui-card h-full"));
});
test("圖片附件改用小縮圖並以 Lightbox 預覽", () => {
  assert.ok(attachmentSection.includes("AttachmentThumbnail") && attachmentSection.includes("ImageLightbox"));
  assert.ok(attachmentSection.includes("h-14 w-14"));
});
test("縮圖載入失敗有 fallback，不顯示破圖", () => {
  assert.ok(attachmentSection.includes("onError={() => setFailed(true)}"));
});
test("Lightbox 圖片失敗顯示可讀取的中文提示與重新載入／開啟附件", () => {
  assert.ok(attachmentSection.includes("圖片附件目前無法預覽") && attachmentSection.includes("重新載入") && attachmentSection.includes("開啟附件"));
});
test("檔名過長可截斷並提供 Tooltip（title 屬性）", () => {
  assert.ok(/truncate[^"]*"\s+title=\{item\.fileName\}/.test(attachmentSection));
});

console.log("\n=== 空的送簽內容不再顯示巨大空卡 ===");
const requesterPage = source("src/app/issues/[id]/hotfix/approval/requester/page.tsx");
test("申請人直屬主管簽核頁移除無資料的送簽內容靜態卡", () => {
  assert.ok(!requesterPage.includes("送簽內容"));
});
test("main／side 雙欄預設仍為自然高度（不強制 stretch）；僅 Hotfix 基本資訊｜目前 Hotfix 流程頂列明確選用 equalHeight 撐滿卡片高度", () => {
  const equalHeightRow = source("src/components/workflow-execution/EqualHeightContentRow.tsx");
  const zLayout = source("src/components/workflow-execution/WorkflowZLayout.tsx");
  assert.ok(equalHeightRow.includes("equalHeight = false"));
  assert.ok(equalHeightRow.includes('equalHeight ? "items-stretch" : "items-start"'));
  assert.ok(zLayout.includes("<EqualHeightContentRow left={contentLeft} right={contentRight} />"));
});

console.log("\n=== 目前責任卡與治理關聯版面 ===");
const governanceCard = source("src/components/issue-relations/GovernanceRelationsCard.tsx");
const currentFlow = source("src/components/hotfix-nine-stage/CurrentHotfixFlowCard.tsx");
test("目前 Hotfix 流程／責任卡不是治理關聯卡的一部分", () => {
  assert.ok(!governanceCard.includes("CurrentHotfixFlowCard"));
  assert.ok(!governanceCard.includes("目前處理部門") && !governanceCard.includes("下一關"));
});
test("責任卡與治理卡各自獨立、未使用 absolute/transform/負 margin 互相疊放", () => {
  for (const src of [governanceCard, currentFlow]) {
    assert.ok(!/absolute|translate-|-mt-\d|-ml-\d|-mr-\d|-mb-\d/.test(src));
  }
});
test("治理關聯標題與管理關聯按鈕使用 flex justify-between，不重疊", () => {
  assert.ok(governanceCard.includes("justify-between") && governanceCard.includes("管理關聯"));
});

console.log("\n=== 建立歷程聚合為業務事件＋技術明細收合 ===");
const cumulative = source("src/components/hotfix-nine-stage/CumulativeWorkflowContext.tsx");
const timeline = source("src/components/hotfix-nine-stage/WorkflowHistoryTimeline.tsx");
test("建立聚合只依明確技術代碼集合＋同一 actor＋時間相近，不做同秒粗暴合併", () => {
  assert.ok(cumulative.includes('new Set(["IssueCreated", "ISSUE_CREATED_AUTO_START", "HOTFIX_TICKET_SUBMITTED"])'));
  assert.ok(cumulative.includes("collapseCreationCluster"));
  assert.ok(cumulative.includes("actorId === first.actorId"));
});
test("聚合不包含日後其他關卡也會出現的 WORKFLOW_STAGE_ENTRY 代碼，避免誤併不相關事件", () => {
  const setLiteral = cumulative.slice(cumulative.indexOf("CREATION_CHAIN_CODES ="), cumulative.indexOf("CREATION_CHAIN_CODES =") + 160);
  assert.ok(!setLiteral.includes("WORKFLOW_STAGE_ENTRY"));
});
test("原始 records／history／auditLog 查詢未被刪減或改為過濾", () => {
  assert.ok(cumulative.includes("prisma.approvalRecord.findMany") && cumulative.includes("prisma.issueWorkflowStageHistory.findMany") && cumulative.includes("prisma.auditLog.findMany"));
});
test("技術明細預設收合，需點擊才展開", () => {
  assert.ok(timeline.includes("useState(false)") && timeline.includes('"收合技術明細" : "技術明細"'));
});
test("技術明細不顯示 DB id，只顯示事件代碼／時間／執行人／階段", () => {
  assert.ok(timeline.includes("事件代碼：") && timeline.includes("執行人：") && timeline.includes("階段："));
  assert.ok(!/entry\.id/.test(timeline.replace(/key=\{entry\.id\}/, "")));
});

console.log("\n=== 共用日期 formatter：Server／Client Unicode 空白正規化（Hydration 根因） ===");
test("formatDateTime／formatDate 輸出不含任何非一般空格的 Unicode 空白字元", () => {
  const dt = formatDateTime(new Date("2026-08-03T12:52:30.000Z"));
  const d = formatDate(new Date("2026-08-03T12:52:30.000Z"));
  assert.ok(!/[^\S ]/u.test(dt.replace(/ /g, "")) && !/\p{Zs}/u.test(dt.replace(/ /g, "")));
  assert.doesNotMatch(dt, /[    　]/);
  assert.doesNotMatch(d, /[    　]/);
});
test("附件不再有第二套日期正規化邏輯，統一呼叫共用 formatDateTime", () => {
  assert.ok(!attachmentSection.includes("formatAttachmentTime"));
  assert.ok(attachmentSection.includes("formatDateTime(item.uploadedAt)"));
});
test("ApprovalReviewPanel 未使用 suppressHydrationWarning 或延後渲染掩蓋問題", () => {
  const approvalReviewPanel = source("src/components/hotfix-nine-stage/ApprovalReviewPanel.tsx");
  assert.ok(!approvalReviewPanel.includes("suppressHydrationWarning"));
  assert.ok(approvalReviewPanel.includes("formatDateTime"));
});

console.log("\n=== 目前責任整合進 CurrentHotfixFlowCard ===");
test("CurrentHotfixFlowCard 呈現目前待辦與目前等待人員／執行人，依既有 responsibility resolver 動態決定", () => {
  assert.ok(currentFlow.includes("目前待辦") && currentFlow.includes("目前等待人員／執行人"));
  assert.ok(currentFlow.includes("view.currentTodo") && currentFlow.includes("view.waitingOn"));
  assert.ok(!/["'`](申請人直屬主管|RD 主管|QA 主管|OP 主管)["'`]/.test(currentFlow));
});
test("HotfixStageShell 把既有 evaluateCurrentActorTask 結果餵給 CurrentHotfixFlowCard，沒有另建第二套責任判斷", () => {
  assert.ok(shell.includes("task?.businessStatusLabel") && shell.includes("task?.waitingRoleLabel") && shell.includes("task?.action"));
  assert.ok(shell.includes("evaluateCurrentActorTask"));
});
test("送出時間沿用既有 ApprovalRecord／Workflow Runtime 資料，不另建查詢", () => {
  assert.ok(shell.includes("ctx?.runtime.pendingApproval?.requestedAt"));
});

console.log("\n=== 送簽摘要（data-driven，取代舊「送簽內容」靜態卡） ===");
test("標題為「送簽摘要」，使用既有資料且不重複顯示大型內嵌圖片", () => {
  assert.ok(requesterPage.includes("送簽摘要"));
  assert.ok(requesterPage.includes("getRichTextPlainText") && requesterPage.includes("hasMeaningfulRichTextContent"));
  assert.ok(!requesterPage.includes("<RichTextViewer"));
});
test("送簽摘要不重複顯示申請人／團隊名稱／Hotfix 單號等既有基本資訊欄位", () => {
  assert.ok(!requesterPage.includes("info.reporterName") && !requesterPage.includes("info.teamName") && !requesterPage.includes("info.issueKey"));
});
test("空資料時顯示小型空狀態文字，而非大型空卡", () => {
  assert.ok(requesterPage.includes("目前沒有額外送簽說明，請依工單基本資訊進行確認"));
});

console.log("\n=== 歷程內容不外洩 Rich Text JSON／[object Object]／圖片 URL ===");
test("getHistoryPlainText 對巢狀 JSON 不輸出 [object Object]", () => {
  const text = getHistoryPlainText(JSON.stringify({ a: { b: "可讀內容", c: ["also readable"] } }));
  assert.ok(!text.includes("[object Object]"));
  assert.match(text, /可讀內容/);
});
test("getHistoryPlainText 不輸出附件路徑本身", () => {
  const text = getHistoryPlainText("/api/hotfix-attachments/123e4567-e89b-12d3-a456-426614174000");
  assert.doesNotMatch(text, /hotfix-attachments/);
});

console.log(`\n${passed} passed / 0 failed`);
