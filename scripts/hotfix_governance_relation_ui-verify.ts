import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed += 1; console.log(`PASS ${name}`); }
function source(path: string) { return readFileSync(path, "utf8"); }
const createFields = source("src/components/issue-relations/HotfixGovernanceRelationFields.tsx");
const selector = source("src/components/issue-relations/GovernanceRelationSelector.tsx");
const card = source("src/components/issue-relations/GovernanceRelationsCard.tsx");
const creation = source("src/lib/issueCreation.ts");
const service = source("src/lib/issue-relations/service.ts");

test("old yes/no relation radios removed", () => assert.ok(!createFields.includes("YesNoChoice") && !createFields.includes("relateIncidents") && !createFields.includes("relateRcas") && !createFields.includes("relateProject")));
for (const label of ["事件通報", "RCA", "季度專案", "尚未關聯"]) test(`selector contains ${label}`, () => assert.ok(selector.includes(label)));
test("all relations optional", () => assert.ok(createFields.includes("關聯治理紀錄（選填）") && !selector.includes("required")));
test("creation and management share selector", () => assert.ok(createFields.includes("GovernanceRelationSelector") && card.includes("GovernanceRelationSelector")));
test("selector has accessible combobox", () => assert.ok(selector.includes('role="combobox"') && selector.includes('role="listbox"') && selector.includes('role="option"')));
test("selected records show canonical route", () => assert.ok(selector.includes("item.detailHref")));
test("incident and RCA are multi-select, project is single", () => assert.ok(selector.includes('incident: {') && selector.includes('multiple: true') && selector.includes('project: {') && selector.includes('multiple: false')));
test("server reads submitted ids without boolean gates", () => assert.ok(!creation.includes('formData.get("relateIncidents")') && creation.includes('uniqueFormIds(formData, "incidentRelationIds")')));
for (const relationType of ["INCIDENT_TO_HOTFIX", "RCA_TO_HOTFIX", "HOTFIX_TO_PROJECT"]) test(`uses formal ${relationType}`, () => assert.ok(creation.includes(relationType)));
test("Issue and relations share transaction", () => assert.ok(creation.includes("runCreateIssueTransaction") && creation.includes("createIssueRelationInTx") && creation.includes("tx.issue.create")));
test("relation service rejects duplicate and self relation", () => assert.ok(/自己|自身/.test(service) && /重複|已存在/.test(service)));
test("relation service checks capability", () => assert.ok(service.includes("requireCapability")));
test("new detail title and description", () => assert.ok(card.includes("治理關聯與追蹤") && card.includes("顯示與本次 Hotfix 相關的事件通報、RCA 及季度專案。")));
test("hotfix principal card exists", () => assert.ok(card.includes("本次 Hotfix") && card.includes("目前流程階段")));
for (const label of ["關聯事件通報", "關聯 RCA", "所屬季度專案"]) test(`detail card ${label}`, () => assert.ok(card.includes(label)));
test("linear A/B/C vocabulary removed", () => assert.ok(!card.includes("A. 從哪裡來") && !card.includes("B. 目前處理") && !card.includes("C. 後續追蹤") && !card.includes("尚未安排")));
test("management remains permission guarded", () => assert.ok(card.includes("view.canManage")));
test("mobile selector is width-safe", () => assert.ok(selector.includes("min-w-0") && card.includes("w-full")));

console.log(`\n${passed} passed / 0 failed`);
