import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { startIssueWorkflow, executeIssueTransition, returnIssueToStage } from "../src/lib/workflowExecutionService";
import { decideApprovalRecord } from "../src/lib/approvalService";
import {
  saveExecutionFieldValues,
  validateExecutionSubmission,
  OP_DEPLOY_FIELDS,
  OP_RESULT_FIELDS,
} from "../src/lib/hotfix-ui/executionFields";
import { setTeamDomain } from "../src/lib/team-applicant/teamManagementService";
import { executorFieldKey } from "../src/lib/workflow-execution/hotfixDomainMap";

const OFFICIAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";
const RUN = `opv-${Date.now().toString(36)}`;
let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function hash(path: string): string | null {
  return fs.existsSync(path) ? crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex") : null;
}

async function createUser(name: string, role: string) {
  const user = await prisma.user.create({
    data: { name: `${RUN}-${name}`, email: `${RUN}-${name}@example.invalid`, role, isActive: true },
  });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function findTransition(versionId: string, fromStageId: string, actionKey: string) {
  return prisma.workflowTransition.findFirstOrThrow({ where: { workflowVersionId: versionId, fromStageId, actionKey } });
}

const VALID_PLAN: Record<string, string> = {
  opDeployEnvironment: "Production",
  opDeployPlannedAt: "2026-08-08T22:00",
  opImpactDurationMode: "約",
  opImpactDurationMinutes: "10",
  opAnnouncementRequired: "是",
  opAnnouncementAudience: "MyDMS 使用者",
  opAnnouncementPlannedAt: "2026-08-08T21:30",
  opAnnouncementSummary: "22:00 進行正式環境更新",
  opServiceOperationRequired: "是",
  opOperationTypes: JSON.stringify(["滾動重啟"]),
  opOperationOther: "",
  opComponentTypes: JSON.stringify(["Kubernetes Pod／Deployment／Service／Node"]),
  opComponentOther: "",
  opOperationTargets: "MyDMS Web Pod",
  opExpectedImpacts: JSON.stringify(["服務短暫中斷"]),
  opImpactOther: "",
  opNoImpactJustification: "",
  opDeploySteps: "第一步：確認監控\n第二步：部署\n第三步：驗證",
  opRollbackTrigger: "MyDMS 網頁無法正常顯示",
  opRollbackPlan: "回復上一版映像與設定",
  opRollbackUnavailableMode: "不適用",
  opRollbackUnavailableDetail: "",
  opMonitoringMethod: "使用既有 Grafana 監控",
  opMonitoringAccess: "Grafana / MyDMS production dashboard",
  opMonitoringPageConfirmed: "true",
  opMonitoringMetricsConfirmed: "true",
  opMonitoringRecipientsConfirmed: "true",
  opMonitoringNotApplicableReason: "",
};

const VALID_RESULT: Record<string, string> = {
  opActualStartedAt: "2026-08-08T22:00",
  opActualCompletedAt: "2026-08-08T22:08",
  opDeployResult: "完成",
  opIncidentStatus: "無",
  opIncidentDetail: "",
  opRollbackActivated: "否",
  opRollbackResult: "",
  opPostMonitoringResult: "正常",
  opPostMonitoringDetail: "",
};

async function createAtOpPreparing(input: {
  key: string;
  versionId: string;
  draftStageId: string;
  opPreparingStageId: string;
  adminId: string;
  reporterId: string;
  reporterName: string;
  teamId: string;
  executorId: string;
}) {
  const issue = await prisma.issue.create({
    data: {
      issueKey: `${RUN}-${input.key}`,
      issueType: "Hotfix",
      title: "OP 雙重核准 targeted verify",
      workflowStatus: "draft",
      reporterUserId: input.reporterId,
      reporter: input.reporterName,
      systemName: "MyDMS",
      environment: "Production",
      riskLevel: "中",
      priority: "P2",
    },
  });
  await startIssueWorkflow({
    issueId: issue.id,
    workflowVersionId: input.versionId,
    actorId: input.adminId,
    reasonCode: "VERIFY_START",
  });
  const now = new Date();
  await prisma.$transaction([
    prisma.issueWorkflowStageHistory.updateMany({
      where: { issueId: issue.id, toStageId: input.draftStageId, exitedAt: null },
      data: { exitedAt: now },
    }),
    prisma.issue.update({
      where: { id: issue.id },
      data: {
        assignedTeamId: input.teamId,
        currentWorkflowStageId: input.opPreparingStageId,
        workflowStatus: "opPreparing",
        stageEnteredAt: now,
      },
    }),
    prisma.issueWorkflowStageHistory.create({
      data: {
        issueId: issue.id,
        fromStageId: input.draftStageId,
        toStageId: input.opPreparingStageId,
        transitionId: null,
        transitionType: "ENTERED",
        actorUserId: input.executorId,
        reasonCode: "VERIFY_FIXTURE",
        assignedTeamIdBefore: null,
        assignedTeamIdAfter: input.teamId,
        terminalOutcome: null,
        executedAt: now,
      },
    }),
    prisma.issueFieldValue.create({
      data: {
        issueId: issue.id,
        fieldKey: executorFieldKey("OP"),
        fieldLabel: "指派執行人",
        fieldValue: input.executorId,
      },
    }),
  ]);
  return issue;
}

async function main() {
  console.log("=== OP deployment split targeted verify ===");
  const beforeHash = hash(OFFICIAL_DEV_DB);

  console.log("\n=== 表單與 Server 條件式驗證 ===");
  check("[1] 完整上版前計畫可送出", validateExecutionSubmission("opPreparing", VALID_PLAN).length === 0);
  check("[2] 附件不在上版前必填欄位", !OP_DEPLOY_FIELDS.some((field) => /附件|Evidence|佐證/i.test(field.key)));
  check("[3] 公告選是時要求三項公告資料", validateExecutionSubmission("opPreparing", { ...VALID_PLAN, opAnnouncementAudience: "" }).some((m) => m.includes("公告對象")));
  check("[4] 服務操作選是時要求操作與元件多選", validateExecutionSubmission("opPreparing", { ...VALID_PLAN, opOperationTypes: "[]" }).some((m) => m.includes("操作類型")));
  check("[5] 操作／元件選其他時要求說明", validateExecutionSubmission("opPreparing", { ...VALID_PLAN, opOperationTypes: '["其他"]', opOperationOther: "" }).some((m) => m.includes("其他操作說明")));
  check("[6] 無明顯影響與其他影響互斥", validateExecutionSubmission("opPreparing", { ...VALID_PLAN, opExpectedImpacts: '["無明顯影響","影響功能"]' }).some((m) => m.includes("不得與")));
  check("[7] 監控連結與三項確認均由 Server 驗證", validateExecutionSubmission("opPreparing", { ...VALID_PLAN, opMonitoringPageConfirmed: "" }).some((m) => m.includes("監控頁面")));
  check("[8] 完整正式部署紀錄可送出", validateExecutionSubmission("opDeploying", VALID_RESULT).length === 0);
  check("[9] 完成時間不得早於開始時間", validateExecutionSubmission("opDeploying", { ...VALID_RESULT, opActualCompletedAt: "2026-08-08T21:59" }).some((m) => m.includes("不得早於")));
  check("[10] 未完成、異常、Rollback、監控異常皆有條件式說明", [
    validateExecutionSubmission("opDeploying", { ...VALID_RESULT, opDeployResult: "未完成" }),
    validateExecutionSubmission("opDeploying", { ...VALID_RESULT, opIncidentStatus: "有" }),
    validateExecutionSubmission("opDeploying", { ...VALID_RESULT, opRollbackActivated: "是" }),
    validateExecutionSubmission("opDeploying", { ...VALID_RESULT, opPostMonitoringResult: "異常" }),
  ].every((messages) => messages.length > 0));

  console.log("\n=== Workflow／兩次獨立核准／歷程 ===");
  const admin = await createUser("admin", "Admin");
  const reporter = await createUser("reporter", "PM");
  const lead = await createUser("op-lead", "OP");
  const executor = await createUser("op-executor", "OP");
  const team = await prisma.team.create({ data: { name: `${RUN}-team` } });
  await setTeamDomain({ teamId: team.id, domain: "OP", actorId: admin.id, reasonCode: "VERIFY" });
  await prisma.teamMember.createMany({
    data: [
      { teamId: team.id, userId: lead.id, membershipRole: "LEAD", isActive: true },
      { teamId: team.id, userId: executor.id, membershipRole: "MEMBER", isActive: true },
    ],
  });
  const workflow = await buildHotfixWorkflowV1({ actorId: admin.id, keySuffix: RUN, reasonCode: "VERIFY" });
  const issue = await createAtOpPreparing({
    key: "approve",
    versionId: workflow.version.id,
    draftStageId: workflow.stageIds.draft,
    opPreparingStageId: workflow.stageIds.opPreparing,
    adminId: admin.id,
    reporterId: reporter.id,
    reporterName: reporter.name,
    teamId: team.id,
    executorId: executor.id,
  });

  await saveExecutionFieldValues({ issueId: issue.id, actorId: executor.id, values: VALID_PLAN });
  const opSubmit = await findTransition(workflow.version.id, workflow.stageIds.opPreparing, "opSubmit");
  await executeIssueTransition({ issueId: issue.id, transitionId: opSubmit.id, actorId: executor.id, reasonCode: "SUBMIT_PRE" });
  const pre = await prisma.approvalRecord.findFirstOrThrow({
    where: { issueId: issue.id, approvalType: "DEPLOYMENT_APPROVAL", relatedStageKey: "pendingDeploymentApproval" },
  });
  check("[11] 無附件仍可送上版前核准", await prisma.evidence.count({ where: { issueId: issue.id } }) === 0 && pre.decision === "PENDING");
  await decideApprovalRecord({ approvalRecordId: pre.id, actorUserId: lead.id, decision: "APPROVED" });
  const preApprove = await findTransition(workflow.version.id, workflow.stageIds.pendingDeploymentApproval, "opLeadApprove");
  await executeIssueTransition({ issueId: issue.id, transitionId: preApprove.id, actorId: lead.id, reasonCode: "APPROVE_PRE" });
  check("[12] 上版前核准後才進入正式部署紀錄", (await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).workflowStatus === "opDeploying");

  await saveExecutionFieldValues({ issueId: issue.id, actorId: executor.id, values: VALID_RESULT });
  const deployComplete = await findTransition(workflow.version.id, workflow.stageIds.opDeploying, "opDeployComplete");
  await executeIssueTransition({ issueId: issue.id, transitionId: deployComplete.id, actorId: executor.id, reasonCode: "SUBMIT_POST" });
  const post = await prisma.approvalRecord.findFirstOrThrow({
    where: { issueId: issue.id, approvalType: "DEPLOYMENT_APPROVAL", relatedStageKey: "opCompleted" },
  });
  check("[13] 上版前／上版後為兩筆獨立 ApprovalRecord", pre.id !== post.id && pre.relatedStageKey !== post.relatedStageKey && post.decision === "PENDING");
  check("[14] 正式部署紀錄送出時不要求附件或隱藏風險檢核", await prisma.evidence.count({ where: { issueId: issue.id } }) === 0);
  check("[15] 兩次正式提交各有 append-only IssueFieldValue 快照", await prisma.issueFieldValue.count({ where: { issueId: issue.id, fieldKey: { startsWith: "workflowSubmission:" } } }) === 2);

  await decideApprovalRecord({ approvalRecordId: post.id, actorUserId: lead.id, decision: "APPROVED" });
  const postApprove = await findTransition(workflow.version.id, workflow.stageIds.opCompleted, "reporterConfirmOpen");
  await executeIssueTransition({ issueId: issue.id, transitionId: postApprove.id, actorId: lead.id, reasonCode: "APPROVE_POST" });
  check("[16] 上版後主管確認完成後才進入結案", (await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).workflowStatus === "pendingReporterConfirmation");

  const rejectedIssue = await createAtOpPreparing({
    key: "reject",
    versionId: workflow.version.id,
    draftStageId: workflow.stageIds.draft,
    opPreparingStageId: workflow.stageIds.opPreparing,
    adminId: admin.id,
    reporterId: reporter.id,
    reporterName: reporter.name,
    teamId: team.id,
    executorId: executor.id,
  });
  await saveExecutionFieldValues({ issueId: rejectedIssue.id, actorId: executor.id, values: VALID_PLAN });
  await executeIssueTransition({ issueId: rejectedIssue.id, transitionId: opSubmit.id, actorId: executor.id, reasonCode: "SUBMIT_PRE" });
  const rejectedPre = await prisma.approvalRecord.findFirstOrThrow({ where: { issueId: rejectedIssue.id, relatedStageKey: "pendingDeploymentApproval" } });
  await decideApprovalRecord({ approvalRecordId: rejectedPre.id, actorUserId: lead.id, decision: "APPROVED" });
  await executeIssueTransition({ issueId: rejectedIssue.id, transitionId: preApprove.id, actorId: lead.id, reasonCode: "APPROVE_PRE" });
  await saveExecutionFieldValues({ issueId: rejectedIssue.id, actorId: executor.id, values: VALID_RESULT });
  await executeIssueTransition({ issueId: rejectedIssue.id, transitionId: deployComplete.id, actorId: executor.id, reasonCode: "SUBMIT_POST" });
  const rejectedPost = await prisma.approvalRecord.findFirstOrThrow({ where: { issueId: rejectedIssue.id, relatedStageKey: "opCompleted" } });
  await decideApprovalRecord({ approvalRecordId: rejectedPost.id, actorUserId: lead.id, decision: "REJECTED", decisionComment: "請補正監控說明" });
  const postReject = await findTransition(workflow.version.id, workflow.stageIds.opCompleted, "opPostConfirmReject");
  await returnIssueToStage({ issueId: rejectedIssue.id, transitionId: postReject.id, actorId: lead.id, reasonCode: "請補正監控說明" });
  check("[17] 上版後駁回退回原 OP 部署紀錄階段", (await prisma.issue.findUniqueOrThrow({ where: { id: rejectedIssue.id } })).workflowStatus === "opDeploying");
  check("[18] 上版後駁回不覆蓋上版前核准", (await prisma.approvalRecord.findUniqueOrThrow({ where: { id: rejectedPre.id } })).decision === "APPROVED");
  check("[19] History 與 AuditLog 均保留上版後駁回", (await prisma.issueWorkflowStageHistory.count({ where: { issueId: rejectedIssue.id, transitionType: "RETURNED" } })) > 0 && (await prisma.auditLog.count({ where: { entityType: "Issue", entityId: rejectedIssue.id, actionType: "IssueWorkflowReturned" } })) > 0);

  console.log("\n=== UI／前序資料邊界 ===");
  const readonlySource = fs.readFileSync("src/components/hotfix-nine-stage/ExecutionFieldsForm.tsx", "utf8");
  const shellSource = fs.readFileSync("src/components/hotfix-nine-stage/HotfixStageShell.tsx", "utf8");
  const opSource = fs.readFileSync("src/app/issues/[id]/hotfix/op/page.tsx", "utf8");
  const cumulativeSource = fs.readFileSync("src/components/hotfix-nine-stage/CumulativeWorkflowContext.tsx", "utf8");
  check("[20] 尚未提交時不逐欄顯示大量「（未填寫）」", !readonlySource.includes('values[f.key] || "（未填寫）"'));
  check("[21] 所有關卡共用累積前序紀錄", shellSource.includes("CumulativeWorkflowContext") && cumulativeSource.includes("workflowSubmission:"));
  check("[22] OP 頁有三個第 7 關子步驟與獨立上版後主管確認", ["上版前確認", "OP 主管上版前核准", "正式環境部署紀錄", "ApprovalReviewPanel"].every((text) => opSource.includes(text)));
  check("[23] Server 欄位白名單分離上版前與正式部署", OP_DEPLOY_FIELDS.every((field) => !OP_RESULT_FIELDS.some((result) => result.key === field.key)));
  check("[24] 使用者畫面未寫出 Transition／stageKey／Prisma 技術錯誤", !opSource.includes("Prisma") && !readonlySource.includes("stageKey「"));

  const afterHash = hash(OFFICIAL_DEV_DB);
  check("[25] 正式 dev.db 未修改", beforeHash === afterHash, `${beforeHash} → ${afterHash}`);
  await prisma.$disconnect();
  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
