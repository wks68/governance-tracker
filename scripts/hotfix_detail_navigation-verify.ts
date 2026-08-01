import * as fs from "node:fs";
import * as path from "node:path";
import { genericIssueDetailHref, resolveIssueDetailHref } from "../src/lib/issue-detail-href";
import { legacyHotfixNineStageDisplay, routeForStageKey } from "../src/lib/hotfix-ui/nineStage";

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(label: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
  }
}

const stages = [
  "draft", "pendingBusinessApproval", "pendingRdTriage", "pendingRdClaim", "rdInProgress",
  "pendingRdLeadApproval", "pendingQaTriage", "pendingQaClaim", "qaInProgress", "pendingQaLeadApproval",
  "pendingOpTriage", "pendingOpClaim", "opPreparing", "pendingDeploymentApproval", "opDeploying",
  "opCompleted", "pendingReporterConfirmation", "reporterConfirming", "closed", "cancelled",
] as const;

console.log("\n=== Hotfix 詳情 canonical resolver ===");
for (const stageKey of stages) {
  check(
    `${stageKey} 使用 nineStage 正式 route`,
    resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", currentStageKey: stageKey }) === routeForStageKey("HF", stageKey),
  );
}
check("已結案 Hotfix 進 close Z 頁", resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", currentStageKey: "closed" }) === "/issues/HF/hotfix/close");
check("已取消 Hotfix 進 close 取消終態頁", resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", currentStageKey: "cancelled" }) === "/issues/HF/hotfix/close");
check("舊制 Hotfix 進唯讀 summary", resolveIssueDetailHref({ id: "HF", issueType: "Hotfix" }) === "/issues/HF/hotfix/summary");
check("舊制已結案 Hotfix 進 close Z 頁", resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", workflowStatus: "closed" }) === "/issues/HF/hotfix/close");
check("舊制已取消 Hotfix 進 close 取消終態頁", resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", workflowStatus: "cancelled" }) === "/issues/HF/hotfix/close");
check("非 Hotfix 維持通用詳情", resolveIssueDetailHref({ id: "INC", issueType: "Incident" }) === genericIssueDetailHref("INC"));
check("任何正式 Hotfix stage 都不回 generic route", stages.every((stageKey) => resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", currentStageKey: stageKey }) !== genericIssueDetailHref("HF")));
check("舊制 opened 轉為第 1 階段", legacyHotfixNineStageDisplay("opened").currentIndex === 1);
check("舊制 rdFix 轉為第 3 階段", legacyHotfixNineStageDisplay("rdFix").currentIndex === 3);
check("舊制 qaRelease 轉為第 6 階段", legacyHotfixNineStageDisplay("qaRelease").currentIndex === 6);
check("舊制 closed 為九階段全完成終態", legacyHotfixNineStageDisplay("closed").currentIndex === 9 && legacyHotfixNineStageDisplay("closed").terminalComplete);
check("未知舊制狀態不猜測 current 節點", legacyHotfixNineStageDisplay("unknownLegacyStatus").currentIndex === null && !legacyHotfixNineStageDisplay("unknownLegacyStatus").statusKnown);

console.log("\n=== 入口收斂 ===");
const issueList = source("src/app/issues/page.tsx");
const issueTable = source("src/components/IssueTable.tsx");
const relationService = source("src/lib/issue-relations/viewService.ts");
const relationCard = source("src/components/issue-relations/GovernanceRelationsCard.tsx");
const dashboard = source("src/components/governance-dashboard/HotfixBoard.tsx");
const workCenter = source("src/app/work-management/page.tsx");
const notificationResolver = source("src/lib/workflow-execution/actionabilityService.ts");
const genericPage = source("src/app/issues/[id]/page.tsx");
const closePage = source("src/app/issues/[id]/hotfix/close/page.tsx");
const summaryPage = source("src/app/issues/[id]/hotfix/summary/page.tsx");
const resolver = source("src/lib/issue-detail-href.ts");
const shell = source("src/components/hotfix-nine-stage/HotfixStageShell.tsx");
const cumulative = source("src/components/hotfix-nine-stage/CumulativeWorkflowContext.tsx");

check("Hotfix 清單在 Server ViewModel 解析 detailHref", issueList.includes("resolveIssueDetailHref") && issueList.includes("currentWorkflowStage: { select: { stageKey: true } }"));
check("Hotfix 清單編號、標題與查看共用 detailHref", (issueTable.match(/href=\{issue\.detailHref\}/g) ?? []).length >= 4 && !issueTable.includes("href={`/issues/${issue.id}`}"));
check("關聯治理卡由 Server ViewModel 提供 canonical detailHref", relationService.includes("detailHref: resolveIssueDetailHref") && (relationCard.match(/href=\{item\.detailHref\}/g) ?? []).length === 2);
check("Dashboard Hotfix 卡使用 resolver", dashboard.includes("resolveIssueDetailHref") && !dashboard.includes("href={`/issues/${issue.id}`}"));
check("工作管理最近更新使用 resolver", workCenter.includes("href={resolveIssueDetailHref") && !workCenter.includes("href={`/issues/${row.id}`}"));
check("通知／我的待辦 actionHref 使用同一 resolver", notificationResolver.includes("resolveIssueDetailHref") && !notificationResolver.includes("routeForStageKey"));

console.log("\n=== Server redirect、終態與權限邊界 ===");
check("/issues/[id] 以 Server redirect 進 canonical route", genericPage.includes("redirect(resolveIssueDetailHref({ id: issue.id, issueType: issue.issueType, currentStageKey, workflowStatus: issue.workflowStatus }))"));
check("Server redirect 發生在 audit／舊頁資料組裝之前", genericPage.indexOf("redirect(resolveIssueDetailHref") < genericPage.indexOf("const auditLogs"));
check("取消 route 由 close 頁接住且只顯示唯讀終態", closePage.includes('"closed", "cancelled"') && closePage.includes("取消終態") && closePage.includes("不提供任何流程操作"));
check("舊制 terminal 由 close route 復用同一個唯讀 Z 畫面", closePage.includes("LegacyHotfixSummaryPage") && closePage.includes("return LegacyHotfixSummaryPage({ params })"));
check("舊制 summary 使用完整九階段 Z shell", summaryPage.includes("<HotfixStageShell") && summaryPage.includes("legacyHotfixNineStageDisplay") && !summaryPage.includes("showProgress={false}"));
check("舊制 summary 共用責任、引導、附件、關聯與歷程元件", ["NineStageProgressBar", "WorkflowZLayout", "CurrentResponsibilityCard", "CurrentStageGuidanceCard", "TicketBasicInfo", "CumulativeWorkflowContext", "AttachmentSection", "GovernanceRelationsCard"].every((name) => shell.includes(name) || summaryPage.includes(name)));
check("舊制 summary 顯示 Audit Log", cumulative.includes("歷程與 Audit Log") && cumulative.includes("prisma.auditLog.findMany"));
check("summary 不引入 Workflow action 或 capability 判斷", !/from ["'][^"']*(?:actions|permissions)|<ApprovalReviewPanel|<ClaimTeamPanel|<ClosureConfirmPanel|canAct|isResponsible/.test(summaryPage));
check("resolver 沒有複製 stageKey mapping", stages.filter((stageKey) => stageKey !== "closed" && stageKey !== "cancelled").every((stageKey) => !resolver.includes(`\"${stageKey}\"`)) && !resolver.includes("switch (issue.currentStageKey)"));
check("正式 stage 進 summary 不會形成 redirect loop", stages.every((stageKey) => resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", currentStageKey: stageKey }) !== "/issues/HF/hotfix/summary"));
check("舊制非終態誤入 close 會回 canonical summary", resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", workflowStatus: "rdFix" }) === "/issues/HF/hotfix/summary");

console.log(`\n結果：${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
