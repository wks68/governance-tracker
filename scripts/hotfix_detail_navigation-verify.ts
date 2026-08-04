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
const currentFlow = source("src/components/hotfix-nine-stage/CurrentHotfixFlowCard.tsx");
const basicInfo = source("src/components/hotfix-nine-stage/TicketBasicInfo.tsx");
const zLayout = source("src/components/workflow-execution/WorkflowZLayout.tsx");
const equalHeightRow = source("src/components/workflow-execution/EqualHeightContentRow.tsx");
const expandable = source("src/components/ui/ExpandableContentBlock.tsx");
const relationPresentation = source("src/components/issue-relations/GovernanceRelationsCard.tsx");
const historyTimeline = source("src/components/hotfix-nine-stage/WorkflowHistoryTimeline.tsx");

check("Hotfix 清單在 Server ViewModel 解析 detailHref", issueList.includes("resolveIssueDetailHref") && issueList.includes("currentWorkflowStage: { select: { stageKey: true, terminalOutcome: true } }"));
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
check("正式與舊制頁共用九階段、50/50 Z 型、三項目前流程、附件、關聯與歷程", ["NineStageProgressBar", "WorkflowZLayout", "CurrentHotfixFlowCard", "TicketBasicInfo", "CumulativeWorkflowContext", "AttachmentSection", "GovernanceRelationsCard"].every((name) => shell.includes(name) || summaryPage.includes(name)));
check("Hotfix 頁首使用新標題、麵包屑與工作管理返回連結", shell.includes("工作管理／Hotfix（${ticketBasicInfo.issueKey}）") && shell.includes("Hotfix（{ticketBasicInfo.issueKey}）簽核流程狀態") && shell.includes('href="/work-management"') && shell.includes("← 回工作管理"));
check("無處理權時顯示正式查閱提示", shell.includes("您不屬於本單流程處理團隊，本頁僅提供簽核進度及相關紀錄查閱。"));
check("基本資訊使用新欄位且移除實際建立者", ["Hotfix 單編號", "申請人", "團隊名稱", "環境", "系統名稱", "風險等級", "緊急程度", "預計完成日", "Hotfix 標題", "Hotfix 問題描述"].every((label) => basicInfo.includes(label)) && !basicInfo.includes("實際建立者"));
check("目前流程整合目前階段、目前處理部門、目前待辦、等待人員／執行人與下一關，並動態解析終態", ["目前階段", "目前處理部門", "目前待辦", "目前等待人員／執行人", "下一關"].every((label) => currentFlow.includes(label)) && currentFlow.includes("view.currentTodo") && currentFlow.includes("view.waitingOn") && currentFlow.includes("nineStageLabelOfIndex(view.currentIndex + 1)") && currentFlow.includes("流程已完成") && currentFlow.includes("流程已取消"));
check("目前流程的操作按鈕沿用既有 actionability resolver 與 hotfix-list 同一套 variant 判斷，不自行以角色名稱判斷", currentFlow.includes("resolveHotfixListAction") && currentFlow.includes("IssueActionKind") && !/role\s*===|roleLabel\s*===/.test(currentFlow));
check("本關卡引導與舊唯讀工作卡已移除", !fs.existsSync(path.join(ROOT, "src/components/hotfix-nine-stage/CurrentStageGuidanceCard.tsx")) && !fs.existsSync(path.join(ROOT, "src/components/hotfix-nine-stage/CurrentResponsibilityCard.tsx")) && !shell.includes("本關卡引導") && !shell.includes("唯讀工作內容"));
check(
  "Z 型列於平板以上採等寬雙欄；預設高度依內容自然決定，僅「Hotfix 基本資訊｜目前 Hotfix 流程」頂列明確 equalHeight 撐滿卡片高度，其餘雙欄列不受影響",
  zLayout.includes("EqualHeightContentRow") &&
    equalHeightRow.includes("md:grid-cols-2") &&
    equalHeightRow.includes("equalHeight = false") &&
    equalHeightRow.includes('equalHeight ? "items-stretch" : "items-start"') &&
    zLayout.includes("<EqualHeightContentRow left={topLeft} right={topRight} equalHeight />") &&
    zLayout.includes("<EqualHeightContentRow left={contentLeft} right={contentRight} />"),
);
check("長內容元件提供 ARIA、閱讀更多與顯示更少", expandable.includes("aria-expanded={expanded}") && expandable.includes("aria-controls={contentId}") && expandable.includes("閱讀更多") && expandable.includes("顯示更少") && expandable.includes("line-clamp-5"));
check("關聯區塊以 Hotfix 主體與三類正式治理關聯呈現且不使用線性 A/B/C", relationPresentation.includes("治理關聯與追蹤") && ["本次 Hotfix", "關聯事件通報", "關聯 RCA", "所屬季度專案", "尚未關聯"].every((label) => relationPresentation.includes(label)) && ["本單來源與後續處理", "A. 從哪裡來", "B. 目前處理", "C. 後續追蹤", "尚未安排"].every((label) => !relationPresentation.includes(label)) && relationPresentation.includes('presentation === "hotfix-flow"') && relationPresentation.includes('presentation !== "hotfix-flow"'));
check("簽核歷程使用可讀標題，UI 不顯示 Audit Log", historyTimeline.includes("簽核紀錄歷程") && !historyTimeline.includes("Audit Log") && cumulative.includes("prisma.auditLog.findMany"));
check("雙箭頭 Scroll Chevron 已恢復並掛載於 Hotfix 詳情頁 Shell", shell.includes("<ScrollDownChevron />") && fs.existsSync(path.join(ROOT, "src/components/ui/ScrollDownChevron.tsx")));
check("summary 不引入 Workflow action 或 capability 判斷", !/from ["'][^"']*(?:actions|permissions)|<ApprovalReviewPanel|<ClaimTeamPanel|<ClosureConfirmPanel|canAct|isResponsible/.test(summaryPage));
check("resolver 沒有複製 stageKey mapping", stages.filter((stageKey) => stageKey !== "closed" && stageKey !== "cancelled").every((stageKey) => !resolver.includes(`\"${stageKey}\"`)) && !resolver.includes("switch (issue.currentStageKey)"));
check("正式 stage 進 summary 不會形成 redirect loop", stages.every((stageKey) => resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", currentStageKey: stageKey }) !== "/issues/HF/hotfix/summary"));
check("舊制非終態誤入 close 會回 canonical summary", resolveIssueDetailHref({ id: "HF", issueType: "Hotfix", workflowStatus: "rdFix" }) === "/issues/HF/hotfix/summary");

console.log(`\n結果：${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
