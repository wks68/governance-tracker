import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getRichTextPlainText,
  getHistoryPlainText,
  hasMeaningfulRichTextContent,
  parseRichTextValue,
  pendingRichTextImageIds,
  replacePendingRichTextImages,
  sanitizeRichTextValue,
  serializeRichTextValue,
} from "../src/lib/rich-text/value";
import { validateRichTextImage, AttachmentValidationError } from "../src/lib/hotfix-ui/attachmentService";
import { OP_DEPLOY_FIELDS, OP_RESULT_FIELDS, QA_VERIFY_FIELDS, RD_FIX_FIELDS } from "../src/lib/hotfix-ui/executionFields";

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed += 1; console.log(`PASS ${name}`); }
function source(path: string) { return readFileSync(path, "utf8"); }
const imageUrl = "/api/hotfix-attachments/123e4567-e89b-12d3-a456-426614174000";

test("legacy plain text remains text", () => assert.equal(getRichTextPlainText("第一行\n第二行"), "第一行\n第二行"));
test("plain HTML is never interpreted", () => assert.match(getRichTextPlainText('<img src=x onerror="alert(1)">'), /onerror/));
test("basic marks serialize", () => assert.match(serializeRichTextValue({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "內容", marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }] }] }] }), /underline/));
test("lists serialize", () => assert.match(serializeRichTextValue({ type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "項目" }] }] }] }] }), /bulletList/));
test("approved style survives", () => assert.match(serializeRichTextValue({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "格式", marks: [{ type: "textStyle", attrs: { color: "#1D4ED8", fontSize: "18px", fontFamily: "Arial, sans-serif" } }] }] }] }), /#1D4ED8/));
test("unapproved styles are removed", () => assert.doesNotMatch(serializeRichTextValue({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "格式", marks: [{ type: "textStyle", attrs: { color: "transparent", fontSize: "99px", fontFamily: "evil" } }] }] }] }), /transparent|99px|evil/));
test("unknown nodes are removed", () => assert.doesNotMatch(serializeRichTextValue({ type: "doc", content: [{ type: "script", content: [{ type: "text", text: "alert" }] }, { type: "paragraph" }] }), /script|alert/));
test("unknown marks are removed", () => assert.doesNotMatch(serializeRichTextValue({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "onclick" }] }] }] }), /onclick/));
test("internal attachment image is valid content", () => { const value = serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: imageUrl } }] }); assert.equal(hasMeaningfulRichTextContent(value), true); });
for (const bad of ["https://example.com/a.png", "data:image/png;base64,AAAA", "blob:https://example.com/id", "javascript:alert(1)"]) {
  test(`reject image src ${bad.split(":")[0]}`, () => assert.doesNotMatch(serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: bad } }] }), /image/));
}
test("empty formatted document is not meaningful", () => {
  const empty = JSON.stringify({ format: "dms-rich-text", version: 1, doc: { type: "doc", content: [{ type: "paragraph" }] } });
  assert.equal(hasMeaningfulRichTextContent(sanitizeRichTextValue(empty)), false);
});
test("plain non-whitespace is meaningful", () => assert.equal(hasMeaningfulRichTextContent("問題"), true));
test("plain extractor omits URLs", () => assert.equal(getRichTextPlainText(serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: imageUrl } }] })), "[圖片]"));
test("pending image id is discoverable", () => { const value = serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: "", pendingId: "123e4567-e89b-12d3-a456-426614174000" } }] }, { allowPending: true }); assert.deepEqual(pendingRichTextImageIds(value), ["123e4567-e89b-12d3-a456-426614174000"]); });
test("pending image is replaced with stable URL", () => { const id = "123e4567-e89b-12d3-a456-426614174000"; const pending = serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: "", pendingId: id } }] }, { allowPending: true }); assert.ok(replacePendingRichTextImages(pending, new Map([[id, imageUrl]])).includes("/api/hotfix-attachments/")); });
for (const widthPercent of [25, 50, 75, 100]) {
  test(`image width ${widthPercent}% survives serialization`, () => {
    const value = serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: imageUrl, widthPercent } }] });
    assert.equal(parseRichTextValue(value).doc.content?.[0]?.attrs?.widthPercent, widthPercent);
  });
}
test("legacy image without width defaults to 100%", () => {
  const value = serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: imageUrl } }] });
  assert.equal(parseRichTextValue(value).doc.content?.[0]?.attrs?.widthPercent, 100);
});
test("server serializer rejects illegal image width", () => assert.throws(
  () => serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: imageUrl, widthPercent: 33 } }] }),
  /圖片顯示尺寸無效/,
));
test("pending image replacement preserves controlled width", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const pending = serializeRichTextValue({ type: "doc", content: [{ type: "image", attrs: { src: "", pendingId: id, widthPercent: 50 } }] }, { allowPending: true });
  const replaced = replacePendingRichTextImages(pending, new Map([[id, imageUrl]]));
  assert.equal(parseRichTextValue(replaced).doc.content?.[0]?.attrs?.widthPercent, 50);
});
test("history extractor hides rich text JSON and attachment URL", () => {
  const value = serializeRichTextValue({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "歷程內容" }] }, { type: "image", attrs: { src: imageUrl, widthPercent: 25 } }] });
  assert.equal(getHistoryPlainText(value), "歷程內容\n[圖片]");
  assert.doesNotMatch(getHistoryPlainText(value), /dms-rich-text|hotfix-attachments/);
});
test("parser is versioned", () => { const parsed = parseRichTextValue("文字"); assert.equal(parsed.format, "dms-rich-text"); assert.equal(parsed.version, 1); });

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
test("PNG magic bytes accepted", () => validateRichTextImage({ fileName: "shot.png", mimeType: "image/png", bytes: png }));
test("forged PNG rejected", () => assert.throws(() => validateRichTextImage({ fileName: "shot.png", mimeType: "image/png", bytes: Buffer.from("not png") }), AttachmentValidationError));
test("SVG rejected", () => assert.throws(() => validateRichTextImage({ fileName: "x.svg", mimeType: "image/svg+xml", bytes: Buffer.from("<svg/>") }), AttachmentValidationError));
test("extension mismatch rejected", () => assert.throws(() => validateRichTextImage({ fileName: "x.jpg", mimeType: "image/png", bytes: png }), AttachmentValidationError));

const allLongFields = [...RD_FIX_FIELDS, ...QA_VERIFY_FIELDS, ...OP_DEPLOY_FIELDS, ...OP_RESULT_FIELDS].filter((field) => field.type === "textarea");
test("all execution long fields use rich text", () => assert.ok(allLongFields.length >= 15 && allLongFields.every((field) => field.richText)));
const editor = source("src/components/rich-text/RichTextEditor.tsx");
for (const feature of ["toggleBold", "toggleItalic", "toggleUnderline", "toggleStrike", "toggleBulletList", "toggleOrderedList", "setColor", "setFontSize", "setFontFamily", "undo()", "redo()", "handlePaste", "image/png,image/jpeg,image/webp"]) test(`editor supports ${feature}`, () => assert.ok(editor.includes(feature)));
test("viewer never uses dangerouslySetInnerHTML", () => assert.ok(!source("src/components/rich-text/RichTextViewer.tsx").includes("dangerouslySetInnerHTML")));
const resizeNode = source("src/components/rich-text/ResizableImageNodeView.tsx");
test("editor image NodeView offers controlled presets and drag handle", () => {
  for (const marker of ["25", "50", "75", "100", "onPointerMove", "MoveHorizontal"]) assert.ok(resizeNode.includes(marker));
});
test("editor image resize keeps aspect ratio and mobile containment", () => assert.ok(resizeNode.includes("h-auto w-full max-w-full") && resizeNode.includes('maxWidth: "100%"')));
const viewer = source("src/components/rich-text/RichTextViewer.tsx");
test("viewer applies persisted width and mobile containment", () => assert.ok(viewer.includes("normalizeRichTextImageWidth") && viewer.includes('maxWidth: "100%"')));
test("viewer replaces broken image with readable fallback and retry", () => assert.ok(viewer.includes("圖片附件目前無法預覽") && viewer.includes("重新載入") && viewer.includes("onError")));
test("risk help uses shared Tooltip", () => assert.ok(source("src/components/hotfix-nine-stage/RiskLevelHelp.tsx").includes('Tooltip label="查看風險等級說明"')));
test("fixed risk paragraph removed", () => assert.ok(!source("src/components/NewIssueForm.tsx").includes("高：影響主要服務、營運流程")));
test("creation and stage forms share editor", () => { assert.ok(source("src/components/NewIssueForm.tsx").includes("RichTextEditor")); assert.ok(source("src/components/hotfix-nine-stage/ExecutionFieldsForm.tsx").includes("RichTextEditor")); });
test("read-only screens share viewer", () => { assert.ok(source("src/components/hotfix-nine-stage/TicketBasicInfo.tsx").includes("RichTextViewer")); assert.ok(source("src/components/hotfix-nine-stage/ExecutionFieldsForm.tsx").includes("RichTextViewer")); });

console.log(`\n${passed} passed / 0 failed`);
