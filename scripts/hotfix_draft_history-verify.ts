import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  issueCreateDraftStorageKey,
  parseClientIssueDraft,
  snapshotClientIssueDraft,
} from "../src/lib/hotfix-ui/createDraft";
import { getHistoryPlainText, serializeRichTextValue } from "../src/lib/rich-text/value";

let passed = 0;
function test(name: string, run: () => void) { run(); passed += 1; console.log(`PASS ${name}`); }
function source(path: string) { return readFileSync(path, "utf8"); }

test("draft key is scoped to actor and issue type", () => {
  assert.equal(issueCreateDraftStorageKey("user-a", "Hotfix"), "dms:issue-create-draft:user-a:Hotfix");
  assert.notEqual(issueCreateDraftStorageKey("user-a", "Hotfix"), issueCreateDraftStorageKey("user-b", "Hotfix"));
});

test("client draft snapshots string fields but never image Files", () => {
  const data = new FormData();
  data.set("issueType", "Hotfix");
  data.set("title", "保留內容");
  data.set("richTextImage:123", new File(["image"], "shot.png", { type: "image/png" }));
  const draft = snapshotClientIssueDraft(data);
  assert.deepEqual(draft.fields.title, ["保留內容"]);
  assert.equal("richTextImage:123" in draft.fields, false);
});

test("invalid local draft is ignored", () => assert.equal(parseClientIssueDraft('{"version":999}'), null));

const form = source("src/components/NewIssueForm.tsx");
test("Hotfix draft is a type=button client path", () => {
  assert.ok(form.includes('type="button"'));
  assert.ok(form.includes("snapshotClientIssueDraft(new FormData(formEl))"));
  assert.ok(form.includes("window.localStorage.setItem"));
});
test("formal create is the only submit path and always requests approval", () => {
  assert.ok(form.includes('type="submit"'));
  assert.ok(form.includes('formData.set("submitForApproval", "true")'));
});
test("draft and create share an immediate race guard", () => {
  assert.ok(form.includes("operationRef.current"));
  assert.ok(form.includes('operationRef.current = "draft"'));
  assert.ok(form.includes('operationRef.current = "create"'));
});
const action = source("src/lib/actions.ts");
test("forged Hotfix server draft fails before issue creation", () => {
  const guard = action.indexOf('issueType === "Hotfix" && !submitForApproval');
  const create = action.indexOf("createIssueForActor(currentUser");
  assert.ok(guard >= 0 && create > guard);
});

const imageUrl = "/api/hotfix-attachments/123e4567-e89b-12d3-a456-426614174000";
const rich = serializeRichTextValue({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "可讀文字" }] }, { type: "image", attrs: { src: imageUrl } }] });
test("history plain text never exposes rich JSON or attachment URL", () => {
  const text = getHistoryPlainText(rich);
  assert.match(text, /可讀文字/);
  assert.match(text, /\[圖片\]/);
  assert.doesNotMatch(text, /dms-rich-text|hotfix-attachments|\[object Object\]/);
});

const timeline = source("src/components/hotfix-nine-stage/WorkflowHistoryTimeline.tsx");
test("FieldChange renders separate Before and After blocks", () => assert.ok(timeline.includes("Before") && timeline.includes("After") && timeline.includes("fieldChanges")));
test("timeline long content wraps and cannot force horizontal overflow", () => assert.ok(timeline.includes("min-w-0") && timeline.includes("max-w-full") && timeline.includes("overflow-wrap:anywhere")));
test("technical code is secondary muted metadata", () => assert.ok(timeline.includes("事件代碼：") && timeline.includes("text-xs") && timeline.includes("text-text-muted")));
test("history rich text uses shared viewer", () => assert.ok(timeline.includes("<RichTextViewer")));

console.log(`\n${passed} passed / 0 failed`);
