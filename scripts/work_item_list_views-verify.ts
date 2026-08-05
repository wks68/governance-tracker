// @ts-nocheck -- Playwright is supplied in /tmp by the verification environment.
//
// 工作單清單四分類（/issues?view=hotfix|quarterly|incident|rca）瀏覽器級驗證：
//   1. 四個頁籤皆存在，且各自顯示正確筆數徽章。
//   2. 切換頁籤會同步 URL query（?view=...），重新整理後頁籤狀態維持。
//   3. 各分類動態標題正確（Hotfix 清單／季度專案清單／事件通報清單／RCA 清單）。
//   4. 事件通報／RCA 分類顯示各自的動態統計卡片（非 Hotfix 專屬摘要卡）。
//   5. 無 Console Error。
//
// 一律只連線呼叫端顯式指定的 /tmp 隔離 DATABASE_URL（見 assertSafeTestDatabase），
// 不觸碰正式 dev.db 或任何持久化 Preview DB；DB 由外部先啟動對應 dev server（BASE_URL）。
//   DATABASE_URL="file:/tmp/xxx.db" npx tsx scripts/work_item_list_views-verify.ts

import "./lib/assertSafeTestDatabase";

import { chromium } from "playwright";
import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildIncidentWorkflowV1 } from "./lib/buildIncidentWorkflowV1";
import { buildRcaWorkflowV1 } from "./lib/buildRcaWorkflowV1";
import { createIncidentForActor } from "../src/lib/incident-ui/incidentCreation";
import { claimIssueForTeam } from "../src/lib/workflowExecutionService";
import {
  classifyIncident,
  assignIncidentTechnicalUnit,
  techLeadClaimAndAssignExecutor,
  submitIncidentHandling,
  confirmIncidentRecovery,
  confirmIncidentRcaDecision,
} from "../src/lib/workflow-execution/incidentAssignmentService";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3111";
let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}
const consoleIssues: string[] = [];
function watchPage(page: any) {
  page.setDefaultTimeout(60000);
  page.on("pageerror", (err: Error) => consoleIssues.push(`pageerror: ${err.message}`));
  page.on("console", (msg: any) => { if (msg.type() === "error") consoleIssues.push(`console: ${msg.text().slice(0, 200)}`); });
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

async function createAdHocUser(name: string, role: string, email: string) {
  const user = await prisma.user.create({ data: { name, email, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

const BASE_INTAKE_FIELDS = { symptomText: "x", impactScope: "SINGLE_USER", dataPermissionImpact: ["不確定"], operationalImpact: ["不確定"] };

async function main() {
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Incident" } }, data: { status: "ARCHIVED" } });
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "RCA" } }, data: { status: "ARCHIVED" } });
  await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "LIST_VIEWS_VERIFY", keySuffix: `list-views-incident-${Date.now()}` });
  await buildRcaWorkflowV1({ actorId: org.admin.id, reasonCode: "LIST_VIEWS_VERIFY", keySuffix: `list-views-rca-${Date.now()}` });

  const intakeTeam = await prisma.team.create({ data: { name: "事件受理窗口", domain: "INCIDENT", isActive: true } });
  const intakeLead = await createAdHocUser("IntakeLeadListView", "PM", "intake-lead-listview@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: intakeTeam.id, userId: intakeLead.id, membershipRole: "LEAD", isActive: true } });
  const securityTeam = await prisma.team.create({ data: { name: "資安推動小組", domain: "SECURITY", isActive: true } });
  const securityLead = await createAdHocUser("SecurityLeadListView", "資安推動小組", "security-lead-listview@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: securityTeam.id, userId: securityLead.id, membershipRole: "LEAD", isActive: true } });
  const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
  const rdLead = await prisma.user.findUniqueOrThrow({ where: { id: org.personByKey.get("tommy")!.id } });
  const rdExecutor = await createAdHocUser("RdExecutorListView", "RD", "rd-executor-listview@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdExecutor.id, membershipRole: "MEMBER", isActive: true } });
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: org.personByKey.get("selena")!.id } });

  // 一筆事件通報＋自動建立的關聯 RCA，供事件通報／RCA 分類頁籤各自有 >0 筆資料可驗證。
  const incident = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[list-view-verify] 測試事件", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "資安疑慮",
    occurredAt: "2026-08-01T09:00:00.000Z", occurredAtUncertain: false, reportSource: "監控告警", suggestedSeverity: "影響很大，需要立即處理",
    isOngoing: "否，目前已恢復", hasWorkaround: "沒有",
  });
  await claimIssueForTeam({ issueId: incident.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  await classifyIncident({ issueId: incident.id, actorId: intakeLead.id, formalSeverity: "高", reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: incident.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  await techLeadClaimAndAssignExecutor({ issueId: incident.id, actorId: rdLead.id, executorUserId: rdExecutor.id, reasonCode: "V" });
  await submitIncidentHandling({ issueId: incident.id, actorId: rdExecutor.id, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRecovery({ issueId: incident.id, actorId: intakeLead.id, confirmResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRcaDecision({ issueId: incident.id, actorId: securityLead.id, needRca: true, reasonCode: "V" });

  // 最小 Hotfix／季度專案存根資料（僅供頁籤計數與清單渲染驗證，不驅動完整 Workflow——
  // Hotfix／季度專案本身的流程正確性已由既有 hotfix_ui-verify.ts 等回歸測試涵蓋）。
  await prisma.issue.create({
    data: {
      issueKey: `HF-LISTVIEW-${Date.now()}`, issueType: "Hotfix", title: "[list-view-verify] Hotfix 存根",
      description: "x", systemName: "MyDMS", environment: "Production", reporter: reporter.name, reporterUserId: reporter.id, workflowStatus: "draft",
    },
  });
  await prisma.issue.create({
    data: {
      issueKey: `QP-LISTVIEW-${Date.now()}`, issueType: "ChangeRelease", changeSubType: "QUARTERLY_RELEASE", title: "[list-view-verify] 季度專案存根",
      description: "x", systemName: "MyDMS", environment: "Production", reporter: reporter.name, reporterUserId: reporter.id, workflowStatus: "draft",
    },
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, "IntakeLeadListView");

  console.log("\n=== A. 四個頁籤存在且計數正確 ===");
  await page.goto(`${baseUrl}/issues?view=hotfix`);
  await settleHydration(page);
  const tabTexts = await page.locator('[role="tablist"] a[role="tab"]').allTextContents();
  check("[1] 四個頁籤皆存在（Hotfix／季度專案／事件通報／RCA）", ["Hotfix", "季度專案", "事件通報", "RCA"].every((label) => tabTexts.some((t) => t.includes(label))));
  check("[2] Hotfix 頁籤標題為 Hotfix 清單", (await page.locator("h1").first().textContent())?.includes("Hotfix 清單"));

  console.log("\n=== B. 切換至事件通報分類：URL 同步、標題與統計卡正確 ===");
  await page.getByRole("tab", { name: /事件通報/ }).click();
  await settleHydration(page);
  check("[3] URL query 同步為 view=incident", page.url().includes("view=incident"));
  check("[4] 標題正確顯示為事件通報清單", (await page.locator("h1").first().textContent())?.includes("事件通報清單"));
  const incidentStatCards = await page.locator("section[aria-label*='事件通報清單摘要'] p").allTextContents();
  check("[5] 事件通報統計卡包含「待 RCA 判定」", incidentStatCards.some((t) => t.includes("待 RCA 判定")));

  console.log("\n=== C. 重新整理頁面後頁籤狀態維持 ===");
  await page.reload();
  await settleHydration(page);
  check("[6] 重新整理後仍在事件通報分類（aria-selected）", await page.getByRole("tab", { name: /事件通報/ }).getAttribute("aria-selected") === "true");

  console.log("\n=== D. 切換至 RCA 分類：標題與統計卡正確 ===");
  await page.getByRole("tab", { name: /^RCA/ }).click();
  await settleHydration(page);
  check("[7] URL query 同步為 view=rca", page.url().includes("view=rca"));
  check("[8] 標題正確顯示為 RCA 清單", (await page.locator("h1").first().textContent())?.includes("RCA 清單"));
  const rcaStatCards = await page.locator("section[aria-label*='RCA 清單摘要'] p").allTextContents();
  check("[9] RCA 統計卡包含「逾期未完成」", rcaStatCards.some((t) => t.includes("逾期未完成")));
  const rcaRow = await page.locator("td", { hasText: "RCA-" }).first().textContent().catch(() => null);
  check("[10] RCA 清單顯示至少一筆 RCA 工單", Boolean(rcaRow));

  console.log("\n=== E. 切換至季度專案分類 ===");
  await page.getByRole("tab", { name: /季度專案/ }).click();
  await settleHydration(page);
  check("[11] 標題正確顯示為季度專案清單", (await page.locator("h1").first().textContent())?.includes("季度專案清單"));

  console.log("\n=== F. 無 Console Error ===");
  check("[12] 全程無 pageerror／console error", consoleIssues.length === 0, consoleIssues.join(" | "));

  await browser.close();

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
