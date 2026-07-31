import "./lib/assertSafeTestDatabase";

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  completeIssueWorkflow,
  evaluateWorkflowStageRequirements,
  executeIssueTransition,
  listActionableTasksForActor,
  resolveIssueTasksForActor,
} from "../src/lib/workflowExecutionService";

const ROOT = process.cwd();
const FORMAL_DB = "/workspaces/governance-tracker/prisma/dev.db";
const ORIGINAL_PREVIEW_DB = path.join(ROOT, "prisma/hotfix-ui-preview.db");
const FORMAL_HASH = "3d66755322dc8b67d95edf64a92b134e37282f3521e050430ccb03d84204a181";
const PREVIEW_HASH = "489ade0c49619e86ac6b1f231a0632512c0adbfda679270e2aab52eb15bcdf9b";

let passed = 0;
let failed = 0;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function ordered(text: string, values: readonly string[]): boolean {
  let cursor = -1;
  for (const value of values) {
    const next = text.indexOf(value, cursor + 1);
    if (next < 0) return false;
    cursor = next;
  }
  return true;
}

async function main() {
  console.log("\n=== 導覽與通知 ===");
  const nav = source("src/components/Nav.tsx");
  const bell = source("src/components/ActionableNotificationBell.tsx");
  const css = source("src/app/globals.css");
  check(
    "[1] 導覽順序含事件通報、RCA 與通知鈴鐺",
    ordered(nav, [
      'label: "治理儀表板"',
      'label: "工單清單"',
      'label: "建立工單"',
      'label: "事件通報"',
      'label: "RCA"',
      'label: "核准治理設定"',
      'label: "人員"',
      'label: "團隊"',
      "<ActionableNotificationBell",
    ]),
  );
  check("[2] 通知 Badge 只在待辦數大於零時顯示且支援 99+", bell.includes("tasks.length > 0 &&") && bell.includes('"99+"'));
  check("[3] 通知直接使用 actionHref 進操作頁且查看不會清除", bell.includes("href={task.actionHref}") && !/mark.*read|clearNotification/i.test(bell));
  check("[4] 通知只晃動一次並尊重 reduced motion", bell.includes("setTimeout") && css.includes("prefers-reduced-motion") && css.includes(".animate-notification-bell"));

  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  const issues = await prisma.issue.findMany({
    where: { issueType: "Hotfix", workflowVersionId: { not: null }, currentWorkflowStageId: { not: null } },
    select: {
      id: true,
      issueKey: true,
      title: true,
      issueType: true,
      workflowVersionId: true,
      currentWorkflowStageId: true,
      stageEnteredAt: true,
    },
  });
  let resolverMatches = true;
  let directRoutes = true;
  for (const user of users) {
    const [states, tasks] = await Promise.all([
      resolveIssueTasksForActor(user.id, issues),
      listActionableTasksForActor(user.id),
    ]);
    const expected = Array.from(states.values()).filter((state) => state.actionable).length;
    resolverMatches &&= expected === tasks.length;
    directRoutes &&= tasks.every((task) => task.actionHref !== `/issues/${task.issueId}` && task.actionHref.includes("/hotfix/"));
  }
  check("[5] Badge 數量與共用 actionability resolver 一致", resolverMatches);
  check("[6] 每筆待辦都導向 Hotfix 正確操作頁", directRoutes);

  console.log("\n=== 返回、清單與篩選 ===");
  const shell = source("src/components/hotfix-nine-stage/HotfixStageShell.tsx");
  const issuePage = source("src/app/issues/page.tsx");
  const issueTable = source("src/components/IssueTable.tsx");
  const filters = source("src/components/FilterBar.tsx");
  const hotfixStart = issueTable.indexOf('mode === "hotfix"');
  const hotfixReturn = issueTable.indexOf("\n    return (", hotfixStart);
  const quarterlyReturn = issueTable.indexOf("\n  return (", hotfixReturn + 1);
  const hotfixTableSection = issueTable.slice(hotfixStart, quarterlyReturn);
  const expectedHeaders = [
    "緊急程度", "工單編號", "工單類型", "系統名稱", "標題", "申請人",
    "到期日", "目前階段", "承接團隊", "執行人", "等待角色", "操作",
  ];
  check("[7] 所有 Hotfix 關卡共用返回新版 /issues", shell.includes('const listHref = backHref.startsWith("/issues?") ? backHref : "/issues"') && shell.includes("← 工單清單"));
  check("[8] 篩選預設不 render panel，點擊才展開", filters.includes("{open && (") && filters.includes('aria-label="進階篩選"'));
  check("[9] 篩選有清除、取消、套用且保存在 URL", ordered(filters, ["清除全部", "取消", "套用篩選"]) && filters.includes("URLSearchParams") && filters.includes("router.push"));
  check("[10] 篩選支援外部點擊與 Esc 關閉", filters.includes("closeOnOutsideClick") && filters.includes('event.key === "Escape"'));
  check("[11] /issues 只查詢 Hotfix 與季度專案", issuePage.includes('{ issueType: "Hotfix" }') && issuePage.includes('changeSubType: "QUARTERLY_RELEASE"') && !issuePage.includes('label: "事件通報"') && !issuePage.includes('label: "RCA"'));
  check("[12] /issues 不再 render 舊通用清單", !issueTable.includes('mode = "all"') && !issueTable.includes("狀態燈號</th>") && !issueTable.includes("逾期天數"));
  check("[13] Hotfix 表頭完全符合指定 12 欄", ordered(hotfixTableSection, expectedHeaders) && (hotfixTableSection.match(/<th /g) ?? []).length === 12);
  check("[14] 操作欄固定有查看，確有待辦才顯示前往處理", issueTable.includes("查看") && issueTable.includes("{issue.actionHref && issue.actionKind && (") && issueTable.includes("前往處理"));
  check("[15] 事件通報與 RCA 使用獨立路由", fs.existsSync(path.join(ROOT, "src/app/incidents/page.tsx")) && fs.existsSync(path.join(ROOT, "src/app/rca/page.tsx")) && nav.includes('href: "/incidents"') && nav.includes('href: "/rca"'));

  console.log("\n=== 無留言結案 ===");
  const hotfix = await prisma.issue.findUnique({
    where: { issueKey: "HOTFIX-0012" },
    include: { currentWorkflowStage: true },
  });
  check("[16] HOTFIX-0012 可作為隔離結案驗證資料", !!hotfix?.currentWorkflowStageId);
  if (hotfix?.currentWorkflowStageId && hotfix.reporterUserId) {
    let stage = hotfix.currentWorkflowStage;
    if (stage?.stageKey === "pendingReporterConfirmation") {
      const claim = await prisma.workflowTransition.findFirstOrThrow({
        where: { fromStageId: stage.id, transitionType: "FORWARD" },
      });
      await executeIssueTransition({
        issueId: hotfix.id,
        transitionId: claim.id,
        actorId: hotfix.reporterUserId,
        reasonCode: "VERIFY_CLOSURE_CLAIM",
      });
      const refreshed = await prisma.issue.findUniqueOrThrow({ where: { id: hotfix.id }, include: { currentWorkflowStage: true } });
      stage = refreshed.currentWorkflowStage;
    }
    await prisma.comment.deleteMany({ where: { issueId: hotfix.id } });
    const requirements = stage
      ? await evaluateWorkflowStageRequirements(prisma, hotfix.id, stage.id)
      : [];
    check("[17] reporterConfirming legacy 留言需求不再阻擋", stage?.stageKey === "reporterConfirming" && requirements.every((requirement) => requirement.satisfied));

    const closeTransition = stage
      ? await prisma.workflowTransition.findFirst({
          where: { fromStageId: stage.id, transitionType: "FORWARD", toStage: { terminalOutcome: "COMPLETED" } },
        })
      : null;
    if (closeTransition) {
      await completeIssueWorkflow({
        issueId: hotfix.id,
        transitionId: closeTransition.id,
        actorId: hotfix.reporterUserId,
        reasonCode: "REPORTER_CONFIRMED_CLOSE",
      });
    }
    const [closed, commentCount, history, audit] = await Promise.all([
      prisma.issue.findUniqueOrThrow({ where: { id: hotfix.id }, include: { currentWorkflowStage: true } }),
      prisma.comment.count({ where: { issueId: hotfix.id } }),
      prisma.issueWorkflowStageHistory.findFirst({ where: { issueId: hotfix.id, terminalOutcome: "COMPLETED" }, orderBy: { executedAt: "desc" } }),
      prisma.auditLog.findFirst({ where: { entityType: "Issue", entityId: hotfix.id, actionType: "IssueWorkflowStageCompleted" }, orderBy: { createdAt: "desc" } }),
    ]);
    check("[18] 原申請人零留言可直接確認結案", closed.currentWorkflowStage?.terminalOutcome === "COMPLETED" && commentCount === 0);
    check("[19] 確認結案寫入 History 與 AuditLog", !!history && history.actorUserId === hotfix.reporterUserId && !!audit && audit.actorUserId === hotfix.reporterUserId);
  }
  const closureActions = source("src/app/issues/[id]/hotfix/closure-actions.ts");
  const closurePanel = source("src/app/issues/[id]/hotfix/close/ClosureConfirmPanel.tsx");
  check("[20] 退回原因使用獨立 validation path", closureActions.includes('"請填寫退回原因。"') && closurePanel.includes('setValidationError("請填寫退回原因。")'));
  check("[21] 結案錯誤會遮蔽技術字樣", closureActions.includes("/Transition|stageKey|Prisma|尚無任何留言|comment required|WorkflowExecution|資料表|stack/i"));

  console.log("\n=== 既有功能與受保護 DB ===");
  const relationCounts = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM "IssueRelation"
  `;
  check("[22] IssueRelation 可正常查詢", relationCounts.length === 1 && Number(relationCounts[0].count) >= 0);
  check("[23] 正式 dev.db 雜湊不變", sha256(FORMAL_DB) === FORMAL_HASH);
  check("[24] 原 Preview DB 雜湊不變", sha256(ORIGINAL_PREVIEW_DB) === PREVIEW_HASH);

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
