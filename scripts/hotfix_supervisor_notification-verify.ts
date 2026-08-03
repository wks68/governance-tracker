import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { createIssueForActor, IssueCreationValidationError } from "../src/lib/issueCreation";
import { NoEligibleApproverError } from "../src/lib/approvalService";
import {
  listActionableTasksForActor,
  listWorkflowTaskNotificationsForActor,
} from "../src/lib/workflowExecutionService";
import {
  resolveHotfixListAction,
  summarizeHotfixList,
  taipeiWeekBounds,
} from "../src/lib/hotfix-list/viewModel";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `（${detail}）` : ""}`);
  }
}

async function expectError(label: string, run: () => Promise<unknown>, ErrorType: new (...args: any[]) => Error) {
  try {
    await run();
    check(label, false, `預期 ${ErrorType.name}，實際成功`);
  } catch (error) {
    check(label, error instanceof ErrorType, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

function hotfixForm(teamId: string, applicantId: string, title: string): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    issueType: "Hotfix",
    title,
    description: "主管通知 targeted verify",
    systemName: "MyDMS",
    environment: "Production",
    riskLevel: "中",
    dueDate: "2026-08-20",
    hotfixPriority: "HIGH",
    teamId,
    applicantId,
  })) form.set(key, value);
  return form;
}

async function counts() {
  const [issues, approvals, history, audit, evidence, relationRows] = await Promise.all([
    prisma.issue.count(),
    prisma.approvalRecord.count(),
    prisma.issueWorkflowStageHistory.count(),
    prisma.auditLog.count(),
    prisma.evidence.count(),
    prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>('SELECT COUNT(*) AS count FROM "IssueRelation"'),
  ]);
  return { issues, approvals, history, audit, evidence, relations: Number(relationRows[0]?.count ?? 0) };
}

async function main() {
  console.log("\n=== A. Selena → Aaron 主管責任鏈 ===");
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({
    where: { status: "PUBLISHED", workflowDefinition: { issueType: "Hotfix" } },
    data: { status: "ARCHIVED" },
  });
  await buildHotfixWorkflowV1({
    actorId: org.admin.id,
    reasonCode: "SUPERVISOR_NOTIFICATION_VERIFY",
    keySuffix: `supervisor-notification-${Date.now()}-${process.pid}`,
  });

  const qaTeamId = org.teamIdByName.get("品管")!;
  const selenaInfo = org.personByKey.get("selena")!;
  const aaronInfo = org.personByKey.get("aaron")!;
  const jonusInfo = org.personByKey.get("jonus")!;
  const alexInfo = org.personByKey.get("alex")!;
  const [selena, aaron, jonus, alex, admin] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: selenaInfo.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: aaronInfo.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: jonusInfo.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: alexInfo.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: org.admin.id } }),
  ]);

  const created = await createIssueForActor(
    selena,
    hotfixForm(qaTeamId, selena.id, "[verify] Selena 建立等待 Aaron 核准"),
    { submitForApproval: true },
  );
  const issue = await prisma.issue.findUniqueOrThrow({
    where: { id: created.id },
    include: { currentWorkflowStage: true },
  });
  check("[1] 正式申請人是 Selena，不混用建立者／主管", issue.reporterUserId === selena.id && issue.reporter === "Selena");
  check("[2] 建立後 current stage 為申請人直屬主管簽核", issue.workflowStatus === "pendingBusinessApproval" && issue.currentWorkflowStage?.stageKey === "pendingBusinessApproval");
  check("[3] Runtime 與 currentWorkflowStageId 已建立", Boolean(issue.workflowVersionId && issue.currentWorkflowStageId));

  const assignment = await prisma.userSupervisorAssignment.findFirst({
    where: { userId: selena.id, supervisorUserId: aaron.id, isActive: true, isPrimary: true },
  });
  check("[4] Selena 的正式 primary 直屬主管關係指向 Aaron", Boolean(assignment));
  const approval = await prisma.approvalRecord.findFirst({
    where: { issueId: issue.id, relatedStageKey: "pendingBusinessApproval", decision: "PENDING", recordStatus: "ACTIVE" },
  });
  check("[5] 同交易建立唯一 pending BUSINESS_APPROVAL", Boolean(approval) && approval?.approvalType === "BUSINESS_APPROVAL");
  check("[6] requestedByUserId 是申請人 Selena", approval?.requestedByUserId === selena.id);
  check("[7] expectedApprover 與 responsibility target 都是 Aaron 的正式主管關係", approval?.expectedApproverUserId === aaron.id && approval?.supervisorAssignmentId === assignment?.id);

  const aaronTasks = await listActionableTasksForActor(aaron.id);
  const task = aaronTasks.find((row) => row.issueId === issue.id);
  check("[8] Aaron actionability 為 APPROVE", task?.action === "APPROVE");
  check("[9] actionability source 是同一 ApprovalRecord", task?.summary.actionSourceId === approval?.id);
  check("[10] canonical href 進申請人主管簽核頁", task?.actionHref === `/issues/${issue.id}/hotfix/approval/requester`, task?.actionHref);
  const action = resolveHotfixListAction({ actionKind: task?.action, actionHref: task?.actionHref, detailHref: `/issues/${issue.id}` });
  check("[11] 清單按鈕是待核准／pending-approval", action.label === "待核准" && action.variant === "pending-approval");
  const summary = summarizeHotfixList([{ issueKey: issue.issueKey, title: issue.title, systemName: issue.systemName, dueDate: issue.dueDate?.toISOString() ?? null, terminal: false, hotfixAction: action }], taipeiWeekBounds());
  check("[12] 主管簽核摘要計入 1，且不重複計入一般待處理", summary.approval === 1 && summary.work === 0);
  check("[13] 我的待辦包含該 Hotfix", aaronTasks.some((row) => row.issueId === issue.id && row.action === "APPROVE"));

  console.log("\n=== B. Notification View Model 與去重 ===");
  const firstFeed = await listWorkflowTaskNotificationsForActor(aaron.id);
  const notification = firstFeed.find((row) => row.issueId === issue.id);
  check("[14] Aaron 有一筆未讀主管核准通知", notification?.unread === true && notification.notificationType === "HOTFIX_SUPERVISOR_APPROVAL_REQUIRED");
  check("[15] recipient 僅依共用 actionability 解析為 Aaron", notification?.recipientUserId === aaron.id);
  check("[16] Notification sourceRecordId 是 transaction 中的 ApprovalRecord", notification?.sourceRecordId === approval?.id);
  check("[17] 通知標題、申請人與工單資訊正確", notification?.notificationTitle === "Hotfix 待主管核准" && notification.message.includes("Selena") && notification.message.includes(issue.issueKey));
  check("[18] 通知 href 可直接進正式核准頁", notification?.actionHref === `/issues/${issue.id}/hotfix/approval/requester`);
  const approvalsBeforeSecondRead = await prisma.approvalRecord.count({ where: { issueId: issue.id } });
  const secondFeed = await listWorkflowTaskNotificationsForActor(aaron.id);
  check("[19] 重複讀取使用相同 notificationId，不建立重複通知", secondFeed.find((row) => row.issueId === issue.id)?.notificationId === notification?.notificationId && (await prisma.approvalRecord.count({ where: { issueId: issue.id } })) === approvalsBeforeSecondRead);

  console.log("\n=== C. 權限與 active UserRole ===");
  check("[20] Selena 不可核准自己的主管關卡", !(await listActionableTasksForActor(selena.id)).some((row) => row.issueId === issue.id));
  check("[21] 其他 QA 成員不可核准", !(await listActionableTasksForActor(jonus.id)).some((row) => row.issueId === issue.id));
  const jonusMembership = await prisma.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId: qaTeamId, userId: jonus.id } } });
  await prisma.teamMember.update({ where: { id: jonusMembership.id }, data: { membershipRole: "LEAD" } });
  check("[22] 即使是同隊其他 QA Lead，非正式直屬主管仍不可核准", !(await listActionableTasksForActor(jonus.id)).some((row) => row.issueId === issue.id));
  await prisma.teamMember.update({ where: { id: jonusMembership.id }, data: { membershipRole: "MEMBER" } });
  check("[23] Admin 不是正式主管時不會取得核准 action／通知", !(await listWorkflowTaskNotificationsForActor(admin.id)).some((row) => row.issueId === issue.id));

  const aaronRole = await prisma.userRole.findUniqueOrThrow({ where: { userId_role: { userId: aaron.id, role: "QA" } } });
  await prisma.userRole.update({ where: { id: aaronRole.id }, data: { isActive: false } });
  check("[24] 主管 active UserRole 停用後 fail closed，不再取得 action", !(await listActionableTasksForActor(aaron.id)).some((row) => row.issueId === issue.id));
  check("[25] Bell feed 與 actionability 使用相同 active UserRole 語意", !(await listWorkflowTaskNotificationsForActor(aaron.id)).some((row) => row.issueId === issue.id));
  await prisma.userRole.update({ where: { id: aaronRole.id }, data: { isActive: true } });
  check("[26] 恢復有效角色後 action 與 notification 同時恢復", (await listWorkflowTaskNotificationsForActor(aaron.id)).some((row) => row.issueId === issue.id));

  console.log("\n=== D. 主管解析失敗完整 rollback ===");
  const before = await counts();
  const archTeamId = org.teamIdByName.get("系統架構")!;
  await expectError(
    "[27] 無正式主管時建立並送簽明確失敗",
    () => createIssueForActor(alex, hotfixForm(archTeamId, alex.id, "[verify] 無主管不得建立"), { submitForApproval: true }),
    NoEligibleApproverError,
  );
  const after = await counts();
  check("[28] rollback 不留下 Issue／Approval／History／Audit／Evidence／Relation", JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  await buildHotfixWorkflowV1({
    actorId: org.admin.id,
    reasonCode: "SUPERVISOR_NOTIFICATION_AMBIGUOUS_WORKFLOW_VERIFY",
    keySuffix: `supervisor-notification-ambiguous-${Date.now()}-${process.pid}`,
  });
  const beforeAmbiguousWorkflowCreate = await counts();
  await expectError(
    "[29] 找不到唯一正式 Hotfix Workflow 時 fail closed，不靜默建立 legacy 無主工單",
    () => createIssueForActor(selena, hotfixForm(qaTeamId, selena.id, "[verify] Workflow 衝突不得建立"), { submitForApproval: true }),
    IssueCreationValidationError,
  );
  check(
    "[30] Workflow 衝突送出失敗不留下任何 Issue responsibility／notification 資料",
    JSON.stringify(await counts()) === JSON.stringify(beforeAmbiguousWorkflowCreate),
  );

  console.log("\n=== E. Polling／Toast 靜態邊界 ===");
  const bell = fs.readFileSync("src/components/ActionableNotificationBell.tsx", "utf8");
  const api = fs.readFileSync("src/app/api/actionable-notifications/route.ts", "utf8");
  const nav = fs.readFileSync("src/components/Nav.tsx", "utf8");
  const notificationService = fs.readFileSync("src/lib/workflow-execution/notificationService.ts", "utf8");
  check("[31] authenticated endpoint 使用目前 session user，且 private no-store", api.includes("getCurrentUser()") && api.includes('getUserHasCapability(actor, "issue.view")') && api.includes("private, no-store"));
  check("[32] polling 固定 4 秒，沒有讀取完整 Issue detail endpoint", bell.includes("ACTIONABLE_NOTIFICATION_POLL_INTERVAL_MS = 4_000") && bell.includes('fetch("/api/actionable-notifications"'));
  check("[33] focus 與 visibilitychange 會立即 refresh", bell.includes('addEventListener("focus", refreshNow)') && bell.includes('addEventListener("visibilitychange", onVisibilityChange)'));
  check("[34] unmount 清除 timer、abort request 與 event listeners", bell.includes("window.clearTimeout(timer)") && bell.includes("controller?.abort()") && bell.includes('removeEventListener("focus", refreshNow)'));
  check("[35] inFlight 防重複 request，頁面隱藏時停止 request", bell.includes("if (stopped || inFlight || document.visibilityState") && bell.includes("inFlight = true"));
  check("[36] Toast 以 notificationId 存於 sessionStorage 去重，初始歷史待辦不提示", bell.includes("window.sessionStorage") && bell.includes("seen.has(task.notificationId)") && bell.includes("初次載入只建立基準"));
  check("[37] 只有責任集合改變才 router.refresh，同步摘要與清單", bell.includes("previousSignature !== taskSignature(nextTasks)") && bell.includes("router.refresh()"));
  check("[38] Nav、Bell、Toast 共同使用正式 Notification View Model", nav.includes("listWorkflowTaskNotificationsForActor") && notificationService.includes("listActionableTasksForActor") && notificationService.includes("sourceRecordId"));

  await prisma.$disconnect();
  console.log(`\n=== 結果：${passed} passed / ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
