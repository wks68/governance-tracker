// RD/QA/OP 接單／指派／執行／核准流程驗證腳本。
//
// 涵蓋範圍（對應任務指示第七節 30 項）：Team.domain 領域接單資格、接單併發控制、
// 指派執行人資格、執行人專屬可操作性、RD/QA/OP 主管 expected approver 解析、
// 自我核准防護、ApprovalDelegation 不得冒充接單資格、九階段完整流程推進、結案責任人、
// 工單清單不顯示技術 stageKey、正式 dev.db 全程未被觸碰。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到本 worktree 的
// prisma/dev.db；另外明確比對正式 /workspaces/governance-tracker/prisma/dev.db 前後 hash。
//
// 執行方式：
//   touch /path/to/scratch.db && DATABASE_URL="file:/path/to/scratch.db" npx prisma migrate deploy
//   DATABASE_URL="file:/path/to/scratch.db" node_modules/.bin/tsx scripts/claim_assignment-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { decideApprovalRecord, ApprovalAuthorityMismatchError } from "../src/lib/approvalService";
import { SelfApprovalError } from "../src/lib/permissions";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import {
  startIssueWorkflow,
  executeIssueTransition,
  returnIssueToStage,
  completeIssueWorkflow,
  getAvailableIssueTransitions,
  claimIssueForTeam,
  assignIssueExecutor,
  reassignIssueExecutor,
  listClaimableTeamsForStage,
  listAssignableMembers,
  evaluateCurrentActorTask,
  WorkflowExecutionAccessDeniedError,
  WorkflowExecutionStateError,
} from "../src/lib/workflowExecutionService";
import { saveExecutionFieldValues } from "../src/lib/hotfix-ui/executionFields";
import { saveClosureSummary, requireClosureOwnership } from "../src/lib/hotfix-ui/closureService";
import { setTeamDomain } from "../src/lib/team-applicant/teamManagementService";
import { getRiskCheckTemplate } from "../src/lib/riskCheckTemplates";
import { submitStageRiskCheckAnswer } from "../src/lib/workflowExecutionService";

let passCount = 0;
let failCount = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

async function checkAsync(name: string, fn: () => Promise<boolean>) {
  try {
    check(name, await fn());
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name}（未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, ErrCtor: new (...args: any[]) => Error) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期拋出 ${ErrCtor.name}，但實際成功）`);
  } catch (err) {
    if (err instanceof ErrCtor) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（預期 ${ErrCtor.name}，實際 ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

const RUN_TAG = `cav${Date.now()}`;

async function createUser(name: string, role: string) {
  const user = await prisma.user.create({ data: { name: `${RUN_TAG}-${name}`, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}
async function createTeamWithDomain(name: string, domain: "RD" | "QA" | "OP" | null, actorId: string) {
  const team = await prisma.team.create({ data: { name: `${RUN_TAG}-${name}` } });
  if (domain) await setTeamDomain({ teamId: team.id, domain, actorId, reasonCode: "VERIFY_CLASSIFY" });
  return team;
}
async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD", isActive = true) {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive } });
}
async function findTransition(workflowVersionId: string, fromStageId: string, actionKey: string) {
  const t = await prisma.workflowTransition.findFirst({ where: { workflowVersionId, fromStageId, actionKey } });
  if (!t) throw new Error(`找不到 Transition（fromStageId=${fromStageId}, actionKey=${actionKey}）`);
  return t;
}
async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  const r = await prisma.approvalRecord.findFirst({ where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" }, orderBy: { revisionNo: "desc" } });
  if (!r) throw new Error(`找不到 ApprovalRecord（${approvalType}/${relatedStageKey}）`);
  return r;
}
async function answerAllRiskChecks(issueId: string, stageKey: string, actorId: string) {
  const template = getRiskCheckTemplate(stageKey)!;
  for (const item of template) {
    await submitStageRiskCheckAnswer({ issueId, stageKey, checkKey: item.checkKey, answer: "NO", actorId });
  }
}

interface Ctx {
  hotfix: Awaited<ReturnType<typeof buildHotfixWorkflowV1>>;
  admin: { id: string; name: string };
  pm: { id: string; name: string };
  supervisor: { id: string; name: string };
}

async function createHotfixIssueAtRdTriage(ctx: Ctx, key: string): Promise<{ id: string; issueKey: string }> {
  const issue = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-${key}`,
      issueType: "Hotfix",
      title: `驗證案件 ${key}`,
      workflowStatus: "n/a",
      reporterUserId: ctx.pm.id,
      reporter: ctx.pm.name,
    },
  });
  await startIssueWorkflow({ issueId: issue.id, workflowVersionId: ctx.hotfix.version.id, actorId: ctx.admin.id, reasonCode: "VERIFY_START" });
  const draftTransition = await findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.draft, "submit");
  await executeIssueTransition({ issueId: issue.id, transitionId: draftTransition.id, actorId: ctx.pm.id, reasonCode: "VERIFY_SUBMIT" });
  const approval = await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
  await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: ctx.supervisor.id, decision: "APPROVED" });
  const approveTransition = await findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.pendingBusinessApproval, "businessApprove");
  await executeIssueTransition({ issueId: issue.id, transitionId: approveTransition.id, actorId: ctx.pm.id, reasonCode: "VERIFY" });
  return issue;
}

async function main() {
  console.log("=== RD／QA／OP 接單／指派／執行／核准流程驗證 ===");

  const officialDevDb = "/workspaces/governance-tracker/prisma/dev.db";
  const beforeHash = fs.existsSync(officialDevDb) ? crypto.createHash("sha256").update(fs.readFileSync(officialDevDb)).digest("hex") : null;

  // ---- Fixtures ----
  const admin = await createUser("Admin", "Admin");
  const pm = await createUser("PM", "PM");
  const supervisor = await createUser("Supervisor", "DMS主管");
  await prisma.userSupervisorAssignment.create({
    data: { userId: pm.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });

  const iadTeam = await createTeamWithDomain("IAD", "RD", admin.id);
  const iadLead = await createUser("IadLead", "RD");
  const iadMemberA = await createUser("IadMemberA", "RD");
  const iadMemberB = await createUser("IadMemberB", "RD");
  const iadMemberInactive = await createUser("IadInactive", "RD");
  await addMember(iadTeam.id, iadLead.id, "LEAD");
  await addMember(iadTeam.id, iadMemberA.id, "MEMBER");
  await addMember(iadTeam.id, iadMemberB.id, "MEMBER");
  await addMember(iadTeam.id, iadMemberInactive.id, "MEMBER", false);

  const aadTeam = await createTeamWithDomain("AAD", "RD", admin.id);
  const aadLead = await createUser("AadLead", "RD");
  const aadMemberA = await createUser("AadMemberA", "RD");
  await addMember(aadTeam.id, aadLead.id, "LEAD");
  await addMember(aadTeam.id, aadMemberA.id, "MEMBER");

  const unclassifiedTeam = await createTeamWithDomain("Unclassified", null, admin.id);
  const unclassifiedLead = await createUser("UnclassifiedLead", "RD");
  await addMember(unclassifiedTeam.id, unclassifiedLead.id, "LEAD");

  const qaTeam1 = await createTeamWithDomain("QA1", "QA", admin.id);
  const qaTeam1Lead = await createUser("Qa1Lead", "QA");
  const qaTeam1MemberA = await createUser("Qa1MemberA", "QA");
  await addMember(qaTeam1.id, qaTeam1Lead.id, "LEAD");
  await addMember(qaTeam1.id, qaTeam1MemberA.id, "MEMBER");

  const qaTeam2 = await createTeamWithDomain("QA2", "QA", admin.id);
  const qaTeam2Lead = await createUser("Qa2Lead", "QA");
  await addMember(qaTeam2.id, qaTeam2Lead.id, "LEAD");

  const opTeam1 = await createTeamWithDomain("OP1", "OP", admin.id);
  const opTeam1Lead = await createUser("Op1Lead", "OP");
  const opTeam1MemberA = await createUser("Op1MemberA", "OP");
  await addMember(opTeam1.id, opTeam1Lead.id, "LEAD");
  await addMember(opTeam1.id, opTeam1MemberA.id, "MEMBER");

  const opTeam2 = await createTeamWithDomain("OP2", "OP", admin.id);
  const opTeam2Lead = await createUser("Op2Lead", "OP");
  await addMember(opTeam2.id, opTeam2Lead.id, "LEAD");

  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "VERIFY_BUILD_HOTFIX_V1", keySuffix: RUN_TAG });
  const ctx: Ctx = { hotfix, admin, pm, supervisor };

  // -------------------------------------------------------------------------
  // 【RD 接單】
  // -------------------------------------------------------------------------
  console.log("\n=== RD 接單 ===");

  const issue1 = await createHotfixIssueAtRdTriage(ctx, "RD1"); // pendingRdTriage, unclaimed

  await checkAsync("listClaimableTeamsForStage：IAD／AAD 皆列出且僅 IAD Lead 標記為 eligible", async () => {
    const preview = await listClaimableTeamsForStage(issue1.id, iadLead.id);
    if (!preview.claimable || preview.domain !== "RD") return false;
    const iadEntry = preview.teams.find((t) => t.teamId === iadTeam.id);
    const aadEntry = preview.teams.find((t) => t.teamId === aadTeam.id);
    return iadEntry?.actorIsEligibleLead === true && aadEntry?.actorIsEligibleLead === false;
  });

  await checkAsync("[1] domain=null 團隊不可接單", async () => {
    try {
      await claimIssueForTeam({ issueId: issue1.id, teamId: unclassifiedTeam.id, actorId: unclassifiedLead.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  await checkAsync("[2] QA domain 團隊不可接 RD 階段", async () => {
    try {
      await claimIssueForTeam({ issueId: issue1.id, teamId: qaTeam1.id, actorId: qaTeam1Lead.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  await checkAsync("[6] 一般成員（非 Lead）不能接單", async () => {
    try {
      await claimIssueForTeam({ issueId: issue1.id, teamId: iadTeam.id, actorId: iadMemberA.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  const issue1ForAdmin = await createHotfixIssueAtRdTriage(ctx, "RD1-ADMIN");
  await checkAsync("[8] Admin 不自動取得接單權（Admin 非任何 Team 成員）", async () => {
    try {
      await claimIssueForTeam({ issueId: issue1ForAdmin.id, teamId: iadTeam.id, actorId: admin.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  await checkAsync("[7] active Team Lead 可以接單", async () => {
    const result = await claimIssueForTeam({ issueId: issue1.id, teamId: iadTeam.id, actorId: iadLead.id, reasonCode: "V" });
    return result.issue.assignedTeamId === iadTeam.id;
  });

  await checkAsync("[11] 其他團隊顯示承接狀態（接單同時前進至待指派關卡，AAD 看到「已由 IAD 團隊承接」）", async () => {
    const task = await evaluateCurrentActorTask(issue1.id, aadLead.id);
    const assignPreview = await listAssignableMembers(issue1.id, aadLead.id);
    return task?.businessStatusLabel === `已由 ${iadTeam.name} 團隊承接，待指派` && task.assignedTeamName === iadTeam.name && assignPreview.actorIsLead === false;
  });

  await checkAsync("[10] 接單後不可被覆蓋（第二個團隊嘗試接單 fail closed）", async () => {
    try {
      await claimIssueForTeam({ issueId: issue1.id, teamId: aadTeam.id, actorId: aadLead.id, reasonCode: "V" });
      return false;
    } catch (err) {
      if (!(err instanceof WorkflowExecutionStateError)) return false;
      const fresh = await prisma.issue.findUniqueOrThrow({ where: { id: issue1.id } });
      return fresh.assignedTeamId === iadTeam.id; // 未被覆蓋
    }
  });

  // 併發接單競賽：IAD／AAD 同時對同一張全新工單接單，只能有一個成功
  const raceIssue = await createHotfixIssueAtRdTriage(ctx, "RD-RACE");
  await checkAsync("[9] IAD 與 AAD 同時競爭接單時只有一隊成功", async () => {
    const results = await Promise.allSettled([
      claimIssueForTeam({ issueId: raceIssue.id, teamId: iadTeam.id, actorId: iadLead.id, reasonCode: "V" }),
      claimIssueForTeam({ issueId: raceIssue.id, teamId: aadTeam.id, actorId: aadLead.id, reasonCode: "V" }),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const fresh = await prisma.issue.findUniqueOrThrow({ where: { id: raceIssue.id } });
    return succeeded === 1 && failed === 1 && (fresh.assignedTeamId === iadTeam.id || fresh.assignedTeamId === aadTeam.id);
  });

  // -------------------------------------------------------------------------
  // 【RD 指派與執行】
  // -------------------------------------------------------------------------
  console.log("\n=== RD 指派與執行 ===");

  await checkAsync("[13] 不可指派其他團隊（AAD）成員", async () => {
    try {
      await assignIssueExecutor({ issueId: issue1.id, executorUserId: aadMemberA.id, actorId: iadLead.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  await checkAsync("[14] 不可指派 inactive 成員", async () => {
    try {
      await assignIssueExecutor({ issueId: issue1.id, executorUserId: iadMemberInactive.id, actorId: iadLead.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  await checkAsync("[12] Lead 只能指派自己團隊 active 合格成員（成功指派 IAD 成員）", async () => {
    const result = await assignIssueExecutor({ issueId: issue1.id, executorUserId: iadMemberA.id, actorId: iadLead.id, reasonCode: "V" });
    return result.issue.currentWorkflowStageId !== null;
  });

  await checkAsync("[15] assigned executor 看到「待我處理」（action=ENTER_WORK）", async () => {
    const task = await evaluateCurrentActorTask(issue1.id, iadMemberA.id);
    return task?.action === "ENTER_WORK";
  });

  await checkAsync("[16] 非 executor（IAD Lead 本人）唯讀，寫入被拒絕", async () => {
    try {
      await saveExecutionFieldValues({ issueId: issue1.id, actorId: iadLead.id, values: { rdFixVersion: "x" } });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  await checkAsync("[16a] 非主管不可重新指派", async () => {
    try {
      await reassignIssueExecutor({ issueId: issue1.id, executorUserId: iadMemberB.id, actorId: iadMemberA.id, reasonCode: "VERIFY_REASSIGN" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError && err.message === "只有目前承接團隊主管可重新指派執行人。";
    }
  });

  await checkAsync("[16b] 不可跨團隊重新指派", async () => {
    try {
      await reassignIssueExecutor({ issueId: issue1.id, executorUserId: aadMemberA.id, actorId: iadLead.id, reasonCode: "VERIFY_REASSIGN" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError && err.message === "所選人員不屬於目前承接團隊，無法指派。";
    }
  });

  await checkAsync("[16c] 可成功改派不同成員，並同步寫入執行人、指派時間、History 與 AuditLog", async () => {
    const beforeHistory = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue1.id } });
    const beforeAudit = await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue1.id, actionType: "IssueExecutorReassigned" } });
    const result = await reassignIssueExecutor({
      issueId: issue1.id,
      executorUserId: iadMemberB.id,
      actorId: iadLead.id,
      reasonCode: "VERIFY_REASSIGN",
    });
    const preview = await listAssignableMembers(issue1.id, iadLead.id);
    const history = await prisma.issueWorkflowStageHistory.findFirst({
      where: { issueId: issue1.id, transitionType: "REASSIGNED" },
      orderBy: { executedAt: "desc" },
    });
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Issue", entityId: issue1.id, actionType: "IssueExecutorReassigned" },
      orderBy: { createdAt: "desc" },
    });
    return (
      result.changed &&
      result.executorName === iadMemberB.name &&
      preview.currentExecutorUserId === iadMemberB.id &&
      preview.currentExecutorName === iadMemberB.name &&
      preview.currentExecutorAssignedAt !== null &&
      (await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue1.id } })) === beforeHistory + 1 &&
      (await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue1.id, actionType: "IssueExecutorReassigned" } })) === beforeAudit + 1 &&
      history?.fromStageId === hotfix.stageIds.rdInProgress &&
      history.toStageId === hotfix.stageIds.rdInProgress &&
      history.exitedAt?.getTime() === history.executedAt.getTime() &&
      audit?.fromValue === iadMemberA.id &&
      audit.toValue === iadMemberB.id &&
      audit.summary.includes(iadMemberA.name) &&
      audit.summary.includes(iadMemberB.name)
    );
  });

  await checkAsync("[16d] 選同一人為成功 no-op，不新增 History／AuditLog", async () => {
    const beforeHistory = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue1.id } });
    const beforeAudit = await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue1.id, actionType: "IssueExecutorReassigned" } });
    const result = await reassignIssueExecutor({
      issueId: issue1.id,
      executorUserId: iadMemberB.id,
      actorId: iadLead.id,
      reasonCode: "VERIFY_REASSIGN",
    });
    return (
      !result.changed &&
      result.executorName === iadMemberB.name &&
      (await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue1.id } })) === beforeHistory &&
      (await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue1.id, actionType: "IssueExecutorReassigned" } })) === beforeAudit
    );
  });

  // 後續既有流程仍由 iadMemberA 驗證，故由 Lead 正常改派回 A。
  await reassignIssueExecutor({
    issueId: issue1.id,
    executorUserId: iadMemberA.id,
    actorId: iadLead.id,
    reasonCode: "VERIFY_REASSIGN_BACK",
  });

  await saveExecutionFieldValues({
    issueId: issue1.id,
    actorId: iadMemberA.id,
    values: { rdFixVersion: "v1", rdFixDescription: "修正說明", rdSelfTestResult: "自測通過", rdImpactScope: "低" },
  });
  await answerAllRiskChecks(issue1.id, "pendingRdLeadApproval", iadMemberA.id);
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.rdInProgress, "rdSubmit");
    await executeIssueTransition({ issueId: issue1.id, transitionId: t.id, actorId: iadMemberA.id, reasonCode: "VERIFY" });
  }

  await checkAsync("[16e] 已送主管簽核後不可重新指派", async () => {
    try {
      await reassignIssueExecutor({ issueId: issue1.id, executorUserId: iadMemberB.id, actorId: iadLead.id, reasonCode: "VERIFY_REASSIGN" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionStateError && err.message === "此工單目前狀態不可重新指派執行人。";
    }
  });

  await checkAsync("[17] RD 提交後 expected approver 來自 assigned RD Team（IAD Lead）", async () => {
    const approval = await findActiveApproval(issue1.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    return approval.approverTeamId === iadTeam.id && approval.expectedApproverUserId === iadLead.id;
  });

  await expectError(
    "[20] 不可自我核准（執行人送核，執行人本人嘗試核准）",
    async () => decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue1.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval")).id, actorUserId: iadMemberA.id, decision: "APPROVED" }),
    SelfApprovalError,
  );

  // ApprovalDelegation 只用於核准，不用於接單／指派：即使 aadLead 持有 IAD 團隊
  // RD_LEAD_APPROVAL 的有效代理，仍不得用來接單或指派 IAD 團隊的工單。
  const delegationIssue = await createHotfixIssueAtRdTriage(ctx, "RD-DELEGATION");
  await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: iadLead.id,
      delegateUserId: aadLead.id,
      teamId: iadTeam.id,
      approvalType: "RD_LEAD_APPROVAL",
      validFrom: new Date(Date.now() - 86_400_000),
      validUntil: new Date(Date.now() + 86_400_000 * 30),
      isActive: true,
      createdByUserId: admin.id,
    },
  });
  await checkAsync("[21] ApprovalDelegation 持有者不得用來接單（僅適用於核准決策）", async () => {
    try {
      await claimIssueForTeam({ issueId: delegationIssue.id, teamId: iadTeam.id, actorId: aadLead.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  {
    const approval = await findActiveApproval(issue1.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: iadLead.id, decision: "APPROVED" });
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.pendingRdLeadApproval, "rdLeadApprove");
    await executeIssueTransition({ issueId: issue1.id, transitionId: t.id, actorId: iadLead.id, reasonCode: "VERIFY" });
  }

  await checkAsync("[22] RD 主管核准後進 QA 待接單", async () => {
    const fresh = await prisma.issue.findUniqueOrThrow({ where: { id: issue1.id } });
    const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: fresh.currentWorkflowStageId! } });
    return stage.stageKey === "pendingQaTriage" && fresh.assignedTeamId === null;
  });

  await checkAsync("[3] QA domain 團隊只能接 QA 階段（RD domain 團隊不可接 QA 階段）", async () => {
    try {
      await claimIssueForTeam({ issueId: issue1.id, teamId: iadTeam.id, actorId: iadLead.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  // -------------------------------------------------------------------------
  // 【QA】
  // -------------------------------------------------------------------------
  console.log("\n=== QA 接單／指派／核准 ===");

  await claimIssueForTeam({ issueId: issue1.id, teamId: qaTeam1.id, actorId: qaTeam1Lead.id, reasonCode: "VERIFY_QA_CLAIM" });
  await assignIssueExecutor({ issueId: issue1.id, executorUserId: qaTeam1MemberA.id, actorId: qaTeam1Lead.id, reasonCode: "VERIFY_QA_ASSIGN" });
  await saveExecutionFieldValues({
    issueId: issue1.id,
    actorId: qaTeam1MemberA.id,
    values: { qaTestScope: "s", qaTestEnvironment: "UAT", qaTestResult: "驗證通過" },
  });
  await answerAllRiskChecks(issue1.id, "pendingQaLeadApproval", qaTeam1MemberA.id);
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.qaInProgress, "qaSubmit");
    await executeIssueTransition({ issueId: issue1.id, transitionId: t.id, actorId: qaTeam1MemberA.id, reasonCode: "VERIFY" });
  }

  await checkAsync("[18] QA 提交後 expected approver 來自 assigned QA Team", async () => {
    const approval = await findActiveApproval(issue1.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
    return approval.approverTeamId === qaTeam1.id && approval.expectedApproverUserId === qaTeam1Lead.id;
  });

  await expectError(
    "QA 主管不可為 QA2 團隊主管（非合格核准人）",
    async () => decideApprovalRecord({ approvalRecordId: (await findActiveApproval(issue1.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval")).id, actorUserId: qaTeam2Lead.id, decision: "APPROVED" }),
    ApprovalAuthorityMismatchError,
  );

  {
    const approval = await findActiveApproval(issue1.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
    await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: qaTeam1Lead.id, decision: "APPROVED" });
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.pendingQaLeadApproval, "qaLeadApprove");
    await executeIssueTransition({ issueId: issue1.id, transitionId: t.id, actorId: qaTeam1Lead.id, reasonCode: "VERIFY" });
  }

  await checkAsync("[23] QA 主管核准後進 OP 待接單", async () => {
    const fresh = await prisma.issue.findUniqueOrThrow({ where: { id: issue1.id } });
    const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: fresh.currentWorkflowStageId! } });
    return stage.stageKey === "pendingOpTriage" && fresh.assignedTeamId === null;
  });

  await checkAsync("[4] OP domain 團隊限定 OP 階段（QA domain 團隊不可接 OP 階段）", async () => {
    try {
      await claimIssueForTeam({ issueId: issue1.id, teamId: qaTeam1.id, actorId: qaTeam1Lead.id, reasonCode: "V" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  // -------------------------------------------------------------------------
  // 【OP】
  // -------------------------------------------------------------------------
  console.log("\n=== OP 接單／指派／核准 ===");

  await claimIssueForTeam({ issueId: issue1.id, teamId: opTeam1.id, actorId: opTeam1Lead.id, reasonCode: "VERIFY_OP_CLAIM" });
  await assignIssueExecutor({ issueId: issue1.id, executorUserId: opTeam1MemberA.id, actorId: opTeam1Lead.id, reasonCode: "VERIFY_OP_ASSIGN" });
  await saveExecutionFieldValues({
    issueId: issue1.id,
    actorId: opTeam1MemberA.id,
    values: {
      opDeployEnvironment: "Production",
      opDeployPlannedAt: "2026-08-05T02:00",
      opDeploySteps: "steps",
      opRollbackPlan: "rollback",
      opMonitoringChecklist: "checklist",
    },
  });
  await answerAllRiskChecks(issue1.id, "pendingDeploymentApproval", opTeam1MemberA.id);
  await prisma.evidence.create({ data: { issueId: issue1.id, type: "文件", title: "檢查清單", url: "https://example.invalid/checklist" } });
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.opPreparing, "opSubmit");
    await executeIssueTransition({ issueId: issue1.id, transitionId: t.id, actorId: opTeam1MemberA.id, reasonCode: "VERIFY" });
  }

  await checkAsync("[19] OP 提交後 expected approver 來自 assigned OP Team", async () => {
    const approval = await findActiveApproval(issue1.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
    return approval.approverTeamId === opTeam1.id && approval.expectedApproverUserId === opTeam1Lead.id;
  });

  {
    const approval = await findActiveApproval(issue1.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
    await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: opTeam1Lead.id, decision: "APPROVED" });
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.pendingDeploymentApproval, "opLeadApprove");
    await executeIssueTransition({ issueId: issue1.id, transitionId: t.id, actorId: opTeam1Lead.id, reasonCode: "VERIFY" });
  }
  await saveExecutionFieldValues({ issueId: issue1.id, actorId: opTeam1MemberA.id, values: { opDeployResult: "成功", opProdConfirmResult: "確認無誤" } });
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.opDeploying, "opDeployComplete");
    await executeIssueTransition({ issueId: issue1.id, transitionId: t.id, actorId: opTeam1MemberA.id, reasonCode: "VERIFY" });
  }
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.opCompleted, "reporterConfirmOpen");
    await executeIssueTransition({ issueId: issue1.id, transitionId: t.id, actorId: opTeam1MemberA.id, reasonCode: "VERIFY" });
  }

  await checkAsync("[24] OP 主管核准並完成部署後進待申請人結案", async () => {
    const fresh = await prisma.issue.findUniqueOrThrow({ where: { id: issue1.id } });
    const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: fresh.currentWorkflowStageId! } });
    return stage.stageKey === "pendingReporterConfirmation";
  });

  // -------------------------------------------------------------------------
  // 【結案】
  // -------------------------------------------------------------------------
  console.log("\n=== 結案 ===");

  await checkAsync("[26] 代建 actor（Admin）不可取代申請人結案", async () => {
    try {
      await requireClosureOwnership(issue1.id, admin.id);
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionAccessDeniedError;
    }
  });

  await checkAsync("[25] 原申請人可確認結案（terminalOutcome=COMPLETED，closedAt 寫入）", async () => {
    const claimT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingReporterConfirmation, "reporterClaim");
    await executeIssueTransition({ issueId: issue1.id, transitionId: claimT.id, actorId: pm.id, reasonCode: "VERIFY" });
    await saveClosureSummary({ issueId: issue1.id, actorId: pm.id, summary: "已確認正常", followUpNotes: "" });
    const closeT = await findTransition(hotfix.version.id, hotfix.stageIds.reporterConfirming, "reporterClose");
    await completeIssueWorkflow({ issueId: issue1.id, transitionId: closeT.id, actorId: pm.id, reasonCode: "VERIFY" });
    const fresh = await prisma.issue.findUniqueOrThrow({ where: { id: issue1.id } });
    const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: fresh.currentWorkflowStageId! } });
    return stage.terminalOutcome === "COMPLETED" && fresh.closedAt !== null;
  });

  await checkAsync("結案後不可再次操作（已無可用 Transition）", async () => {
    const transitions = await getAvailableIssueTransitions(issue1.id, pm.id);
    return transitions.length === 0;
  });

  // -------------------------------------------------------------------------
  // 【清單與顯示】
  // -------------------------------------------------------------------------
  console.log("\n=== 清單與顯示 ===");

  const claimableIssue = await createHotfixIssueAtRdTriage(ctx, "LIST-DISPLAY");
  await checkAsync("[27] evaluateCurrentActorTask 回傳業務中文子狀態，不含技術 stageKey 字樣", async () => {
    const task = await evaluateCurrentActorTask(claimableIssue.id, iadLead.id);
    if (!task) return false;
    return task.businessStatusLabel === "待 RD 團隊接單" && !/pending[A-Z]/.test(task.businessStatusLabel);
  });

  await checkAsync("[28] 各角色按鈕正確：接單／指派成員／進入處理／審核 對應正確 action", async () => {
    const claimTask = await evaluateCurrentActorTask(claimableIssue.id, iadLead.id);
    if (claimTask?.action !== "CLAIM") return false;
    await claimIssueForTeam({ issueId: claimableIssue.id, teamId: iadTeam.id, actorId: iadLead.id, reasonCode: "V" });
    const assignTask = await evaluateCurrentActorTask(claimableIssue.id, iadLead.id);
    if (assignTask?.action !== "ASSIGN_MEMBER") return false;
    await assignIssueExecutor({ issueId: claimableIssue.id, executorUserId: iadMemberA.id, actorId: iadLead.id, reasonCode: "V" });
    const workTask = await evaluateCurrentActorTask(claimableIssue.id, iadMemberA.id);
    return workTask?.action === "ENTER_WORK";
  });

  await checkAsync("[5] 不依團隊名稱猜 domain（原始碼靜態檢查）", () =>
    Promise.resolve(
      !fs.readFileSync("src/lib/workflow-execution/claimService.ts", "utf8").match(/name\.includes\(|name\.startsWith\(/) &&
        !fs.readFileSync("src/lib/workflow-execution/hotfixDomainMap.ts", "utf8").match(/name\.includes\(|name\.startsWith\(/),
    ),
  );

  await checkAsync("[29] 重新指派表單已移出正文，右上角操作區使用 Dialog 並處理同人提示", () => {
    const shell = fs.readFileSync("src/components/hotfix-nine-stage/HotfixStageShell.tsx", "utf8");
    const dialog = fs.readFileSync("src/components/hotfix-nine-stage/ReassignExecutorDialog.tsx", "utf8");
    const pages = ["rd", "qa", "op"].map((domain) => fs.readFileSync(`src/app/issues/[id]/hotfix/${domain}/page.tsx`, "utf8"));
    const executionPageHasInlinePanel = pages.some((source) => /<AssignExecutorPanel issueId=\{params\.id\} preview=\{reassignPreview\}/.test(source));
    return Promise.resolve(
      !executionPageHasInlinePanel &&
        shell.includes("headerActions") &&
        dialog.includes('role="dialog"') &&
        dialog.includes("已是目前執行人") &&
        dialog.includes("disabled={!canSubmit}") &&
        pages.every((source) => source.includes("<ExecutorAssignmentSummary preview={reassignPreview} />")),
    );
  });

  const finalHash = fs.existsSync(officialDevDb) ? crypto.createHash("sha256").update(fs.readFileSync(officialDevDb)).digest("hex") : null;
  check("[30] 正式 dev.db 前後完全不變", beforeHash === finalHash, `before=${beforeHash} after=${finalHash}`);

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} ===`);
  await prisma.$disconnect();
  if (failCount > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("claim_assignment-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
