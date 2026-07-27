// M2-B 驗證腳本
//
// 目的：驗證 M2-B（Issue Workflow 執行引擎：階段轉移、RETURN／CANCEL、執行介面）的正確性。
// 涵蓋 Plan 與任務指示第十一節列出的所有項目，全數以實際建立的暫存測試資料庫驗證，
// 不使用 SKIP 規避任何一項（DB 相依測試僅在 Migration 尚未套用於本次測試 DB 時才 SKIP，
// 比照既有 m2_a-verify.ts 慣例）。
//
// Fail-closed：本檔第一行 import 為 assertSafeTestDatabase，若呼叫端未顯式設定
// DATABASE_URL，或其解析後（含 symlink／device+inode 比對）指向正式 prisma/dev.db，
// 一律立即 process.exit(1)，不建立 Prisma Client、不寫入任何資料。
//
// 執行方式：
//   DATABASE_URL="file:<絕對路徑>/<測試 scratch DB>" node_modules/.bin/tsx scripts/m2_b-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { decideApprovalRecord } from "../src/lib/approvalService";
import { getRiskCheckTemplate } from "../src/lib/riskCheckTemplates";
import {
  createWorkflowDefinition,
  createDraftVersion,
  addWorkflowStage,
  addWorkflowTransition,
  publishWorkflowVersion,
  archiveVersion,
} from "../src/lib/workflowService";
import {
  startIssueWorkflow,
  startWorkflowForIssueSystemTx,
  executeIssueTransition,
  returnIssueToStage,
  cancelIssueWorkflow,
  completeIssueWorkflow,
  getAvailableIssueTransitions,
  validateIssueTransition,
  setIssueAssignedTeamAtTriage,
  getIssueWorkflowHistory,
  getIssueWorkflowRuntime,
  recordStageRequirementResult,
  isIssueOnVersionedWorkflow,
  resolveUniqueAutoStartVersionForIssueType,
  WorkflowExecutionStateError,
  WorkflowExecutionAccessDeniedError,
  WorkflowExecutionBlockedError,
} from "../src/lib/workflowExecutionService";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function skip(name: string, reason: string) {
  skipCount++;
  console.log(`  SKIP  ${name}（${reason}）`);
}

async function checkAsync(name: string, fn: () => Promise<boolean>) {
  try {
    check(name, await fn());
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name}（未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, matcher: (err: unknown) => boolean) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期拋出例外，但沒有拋出）`);
  } catch (err) {
    if (matcher(err)) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（拋出了非預期的例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

const RUN_TAG = `m2bv${Date.now()}`;

// ---------------------------------------------------------------------------
// Migration 路徑驗證用的獨立 scratch 檔案（與上方主測試 DB 完全分離，各自獨立生命
// 週期，互不干擾）。比照 scripts/m1_5_c1_a-verify.ts 的 freshScratchPath／migrateDeploy／
// runSeed／clientFor 慣例。OFFICIAL_DEV_DB 一律只被讀取（fs.copyFileSync 的來源），
// 本檔任何地方都不對它送出 migrate/seed，也不直接開啟連線寫入。
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..");
const PRISMA_DIR = path.join(REPO_ROOT, "prisma");
const OFFICIAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";
const MIGRATION_SCRATCH_DIR = path.join(PRISMA_DIR, ".m2_b_verify_migration_scratch");

function freshMigrationScratchPath(name: string): string {
  return path.join(MIGRATION_SCRATCH_DIR, name);
}

function migrateDeployOn(scratchAbsPath: string) {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  execSync(`npx prisma migrate deploy`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `file:./${rel}` },
    stdio: "pipe",
  });
}

function seedOn(scratchAbsPath: string) {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  execSync(`npx tsx prisma/seed.ts`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `file:./${rel}` },
    stdio: "pipe",
  });
}

function migrationScratchClientFor(scratchAbsPath: string): PrismaClient {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  return new PrismaClient({ datasources: { db: { url: `file:./${rel}` } } });
}

interface Fixtures {
  userIds: string[];
  teamIds: string[];
  issueIds: string[];
  definitionIds: string[];
}

async function createUser(fx: Fixtures, name: string, role: string, noRole = false): Promise<{ id: string; name: string; role: string }> {
  const user = await prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive: true } });
  fx.userIds.push(user.id);
  if (!noRole) {
    await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  }
  return user;
}

async function createTeam(fx: Fixtures, name: string): Promise<{ id: string; name: string }> {
  const team = await prisma.team.create({ data: { name: `${RUN_TAG}-${name}` } });
  fx.teamIds.push(team.id);
  return team;
}

async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD") {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
}

async function createIssueRow(fx: Fixtures, issueType: string, key: string): Promise<{ id: string; issueType: string }> {
  const issue = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-${key}`, issueType, title: `測試工單 ${key}`, workflowStatus: "n/a" },
  });
  fx.issueIds.push(issue.id);
  return issue;
}

async function answerRiskChecks(issueId: string, stageKey: string, answeredByUserId: string) {
  const template = getRiskCheckTemplate(stageKey);
  if (!template) throw new Error(`測試腳本錯誤：stageKey「${stageKey}」無風險檢核模板`);
  for (const item of template) {
    await prisma.stageRiskCheck.create({
      data: { issueId, stageKey, assessmentRound: 1, checkKey: item.checkKey, answer: "NO", answeredByUserId, answeredAt: new Date() },
    });
  }
}

async function findTransition(workflowVersionId: string, fromStageId: string, actionKey: string) {
  const t = await prisma.workflowTransition.findFirst({ where: { workflowVersionId, fromStageId, actionKey } });
  if (!t) throw new Error(`測試腳本錯誤：找不到 Transition（fromStageId=${fromStageId}, actionKey=${actionKey}）`);
  return t;
}

async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  const r = await prisma.approvalRecord.findFirst({ where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" }, orderBy: { revisionNo: "desc" } });
  if (!r) throw new Error(`測試腳本錯誤：找不到 ApprovalRecord（${approvalType}/${relatedStageKey}）`);
  return r;
}

// ---------------------------------------------------------------------------
// 1. Hotfix v1 端到端 happy path：涵蓋啟動／固定版本／FORWARD／TRIAGE 指派／
//    Requirement／風險檢核／核准／RETURN＋重新送核／CANCEL 後不得再 FORWARD／
//    COMPLETED／Stage History 完整性／Audit transaction。
// ---------------------------------------------------------------------------

async function runHotfixV1HappyPath(fx: Fixtures) {
  console.log("\n=== 一、Hotfix v1 端到端 happy path ===");

  const admin = await createUser(fx, "Admin", "Admin");
  const pm = await createUser(fx, "PM", "PM");
  const supervisor = await createUser(fx, "Supervisor", "DMS主管");
  await prisma.userSupervisorAssignment.create({
    data: { userId: pm.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - 86400000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });

  const rdTeam = await createTeam(fx, "RD");
  const rdMember = await createUser(fx, "RdMember", "RD");
  const rdLead = await createUser(fx, "RdLead", "RD");
  await addMember(rdTeam.id, rdMember.id, "MEMBER");
  await addMember(rdTeam.id, rdLead.id, "LEAD");

  const qaTeam = await createTeam(fx, "QA");
  const qaMember = await createUser(fx, "QaMember", "QA");
  const qaLead = await createUser(fx, "QaLead", "QA");
  await addMember(qaTeam.id, qaMember.id, "MEMBER");
  await addMember(qaTeam.id, qaLead.id, "LEAD");

  const opTeam = await createTeam(fx, "OP");
  const opMember = await createUser(fx, "OpMember", "OP");
  const opLead = await createUser(fx, "OpLead", "OP");
  await addMember(opTeam.id, opMember.id, "MEMBER");
  await addMember(opTeam.id, opLead.id, "LEAD");

  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "TEST_BUILD_HOTFIX_V1", keySuffix: RUN_TAG });
  fx.definitionIds.push(hotfix.definition.id);

  check("[H0] Hotfix v1 建構＋發布成功（20 關卡，狀態 PUBLISHED）", hotfix.version.status === "PUBLISHED");
  const stageCount = await prisma.workflowStage.count({ where: { workflowVersionId: hotfix.version.id } });
  const forwardCount = await prisma.workflowTransition.count({ where: { workflowVersionId: hotfix.version.id, transitionType: "FORWARD" } });
  const returnCount = await prisma.workflowTransition.count({ where: { workflowVersionId: hotfix.version.id, transitionType: "RETURN" } });
  const cancelCount = await prisma.workflowTransition.count({ where: { workflowVersionId: hotfix.version.id, transitionType: "CANCEL" } });
  check("[H0b] Hotfix v1 關卡數為 20", stageCount === 20, `實際 ${stageCount}`);
  check("[H0c] Hotfix v1 FORWARD 數為 18", forwardCount === 18, `實際 ${forwardCount}`);
  check("[H0d] Hotfix v1 RETURN 數為 8", returnCount === 8, `實際 ${returnCount}`);
  check("[H0e] Hotfix v1 CANCEL 數為 2", cancelCount === 2, `實際 ${cancelCount}`);

  const issue = await createIssueRow(fx, "Hotfix", "HOTFIX-0001");

  // ---- 啟動 Workflow（管理者明確操作，admin.full 能力） ----
  await checkAsync("[1] startIssueWorkflow：成功啟動，currentWorkflowStageId＝起始關卡", async () => {
    const updated = await startIssueWorkflow({ issueId: issue.id, workflowVersionId: hotfix.version.id, actorId: admin.id, reasonCode: "TEST_START" });
    return updated.workflowVersionId === hotfix.version.id && updated.currentWorkflowStageId === hotfix.stageIds.draft && updated.workflowStatus === "draft";
  });

  await expectError(
    "[2] 固定 Version：Issue 已綁定後不得重複啟動",
    () => startIssueWorkflow({ issueId: issue.id, workflowVersionId: hotfix.version.id, actorId: admin.id, reasonCode: "TEST_RESTART" }),
    (e) => e instanceof WorkflowExecutionStateError,
  );

  await checkAsync("[3] 開始 Stage：ENTERED 歷程列存在，fromStageId=null／toStageId=起始關卡", async () => {
    const rows = await getIssueWorkflowHistory(issue.id, admin.id);
    const entered = rows.find((r) => r.transitionType === "ENTERED");
    return !!entered && entered.fromStageId === null && entered.toStageId === hotfix.stageIds.draft && entered.transitionId === null;
  });

  // ---- FORWARD：draft -> pendingBusinessApproval ----
  const submitT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
  await checkAsync("[4] FORWARD 執行成功：draft -> pendingBusinessApproval", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: submitT.id, actorId: pm.id, reasonCode: "TEST_SUBMIT" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingBusinessApproval;
  });

  const businessApproveT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingBusinessApproval, "businessApprove");
  await expectError(
    "[13a] Approval 未通過阻擋：業務核准尚未決策時不得 FORWARD",
    () => executeIssueTransition({ issueId: issue.id, transitionId: businessApproveT.id, actorId: pm.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionBlockedError && e.reasons.some((r) => r.code === "APPROVAL_NOT_GRANTED"),
  );

  const businessApproval = await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
  await decideApprovalRecord({ approvalRecordId: businessApproval.id, actorUserId: supervisor.id, decision: "APPROVED" });
  await checkAsync("[4b] FORWARD 執行成功：pendingBusinessApproval -> pendingRdTriage（核准後）", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: businessApproveT.id, actorId: pm.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingRdTriage;
  });

  // ---- TRIAGE：未指派團隊前不得 FORWARD ----
  const rdAssignT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingRdTriage, "rdAssign");
  await expectError(
    "[15a] TRIAGE assignedTeam 未指派時阻擋 FORWARD",
    () => executeIssueTransition({ issueId: issue.id, transitionId: rdAssignT.id, actorId: supervisor.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionBlockedError && e.reasons.some((r) => r.code === "TRIAGE_TEAM_NOT_ASSIGNED"),
  );

  await checkAsync("[15b] setIssueAssignedTeamAtTriage：實際寫入 Issue.assignedTeamId", async () => {
    const updated = await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: rdTeam.id, actorId: supervisor.id, reasonCode: "TEST_ASSIGN_RD" });
    return updated.assignedTeamId === rdTeam.id;
  });

  await checkAsync("[4c] FORWARD 執行成功：pendingRdTriage -> pendingRdClaim（已指派後）", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: rdAssignT.id, actorId: supervisor.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingRdClaim;
  });

  const rdClaimT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingRdClaim, "rdClaim");
  await checkAsync("[4d] FORWARD 執行成功：pendingRdClaim -> rdInProgress（RD 成員資格檢查通過）", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: rdClaimT.id, actorId: rdMember.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.rdInProgress;
  });

  const rdSubmitTForAccessCheck = await findTransition(hotfix.version.id, hotfix.stageIds.rdInProgress, "rdSubmit");
  await expectError(
    "[Access1] 非團隊成員不具資格執行 CLAIM 類關卡動作",
    () => executeIssueTransition({ issueId: issue.id, transitionId: rdSubmitTForAccessCheck.id, actorId: qaMember.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionAccessDeniedError,
  );

  const rdSubmitT = await findTransition(hotfix.version.id, hotfix.stageIds.rdInProgress, "rdSubmit");
  await expectError(
    "[12a] Requirement 未完成阻擋：rdFixVersion 欄位未填寫時不得送核",
    () => executeIssueTransition({ issueId: issue.id, transitionId: rdSubmitT.id, actorId: rdMember.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionBlockedError && e.reasons.some((r) => r.code === "STAGE_REQUIREMENT_NOT_MET"),
  );

  await prisma.issueFieldValue.create({ data: { issueId: issue.id, fieldKey: "rdFixVersion", fieldLabel: "修正版本", fieldValue: "v1.2.3" } });

  // ---- Risk 未回答阻擋 + rollback／Audit transaction 驗證 ----
  const beforeAudit = await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue.id } });
  const beforeHistory = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue.id } });
  await expectError(
    "[14a] Risk 未回答阻擋：風險檢核未填答時不得進入核准關卡",
    () => executeIssueTransition({ issueId: issue.id, transitionId: rdSubmitT.id, actorId: rdMember.id, reasonCode: "TEST" }),
    (e) => e instanceof Error && e.name === "RiskCheckIncompleteError",
  );
  await checkAsync("[17/18] rollback／Audit transaction：風險檢核失敗時 Issue／History／AuditLog 三者皆未變動", async () => {
    const issueNow = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    const auditNow = await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue.id } });
    const historyNow = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue.id } });
    return issueNow.currentWorkflowStageId === hotfix.stageIds.rdInProgress && auditNow === beforeAudit && historyNow === beforeHistory;
  });

  await answerRiskChecks(issue.id, "pendingRdLeadApproval", rdMember.id);
  await checkAsync("[4e] FORWARD 執行成功：rdInProgress -> pendingRdLeadApproval（Requirement＋風險檢核皆完成後）", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: rdSubmitT.id, actorId: rdMember.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingRdLeadApproval;
  });

  // ---- RETURN：RD 主管駁回，重新送核，再次核准 ----
  const rdLeadRejectT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingRdLeadApproval, "rdLeadReject");
  await expectError(
    "[13b] Approval 未通過阻擋（RETURN 版）：核准尚未被駁回時不得 RETURN",
    () => returnIssueToStage({ issueId: issue.id, transitionId: rdLeadRejectT.id, actorId: rdLead.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionBlockedError && e.reasons.some((r) => r.code === "APPROVAL_NOT_REJECTED"),
  );
  await expectError(
    "[R1] RETURN 未填 reasonCode 一律拒絕",
    () => returnIssueToStage({ issueId: issue.id, transitionId: rdLeadRejectT.id, actorId: rdLead.id, reasonCode: "" }),
    (e) => e instanceof WorkflowExecutionBlockedError,
  );

  const rdLeadApproval1 = await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
  await decideApprovalRecord({ approvalRecordId: rdLeadApproval1.id, actorUserId: rdLead.id, decision: "REJECTED", decisionReasonCode: "NEEDS_MORE_WORK" });

  await checkAsync("[5] RETURN 執行成功：pendingRdLeadApproval -> rdInProgress（核准已駁回後）", async () => {
    const r = await returnIssueToStage({ issueId: issue.id, transitionId: rdLeadRejectT.id, actorId: rdLead.id, reasonCode: "NEEDS_MORE_WORK" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.rdInProgress;
  });
  await checkAsync("[R2] RETURN 不清空既有 Requirement 佐證（rdFixVersion 欄位仍在）", async () => {
    const fv = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: issue.id, fieldKey: "rdFixVersion" } } });
    return !!fv && fv.fieldValue === "v1.2.3";
  });

  await checkAsync("[4f] 重新 FORWARD 送核：rdInProgress -> pendingRdLeadApproval（沿用既有風險檢核答案，形成 resubmit revision）", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: rdSubmitT.id, actorId: rdMember.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingRdLeadApproval;
  });
  await checkAsync("[R3] 重新送核形成 revisionNo=2 且舊紀錄 SUPERSEDED", async () => {
    const superseded = await prisma.approvalRecord.findUnique({ where: { id: rdLeadApproval1.id } });
    const active = await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    return superseded?.recordStatus === "SUPERSEDED" && active.revisionNo === 2 && active.supersedesApprovalRecordId === rdLeadApproval1.id;
  });

  const rdLeadApproval2 = await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
  await decideApprovalRecord({ approvalRecordId: rdLeadApproval2.id, actorUserId: rdLead.id, decision: "APPROVED" });
  const rdLeadApproveT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingRdLeadApproval, "rdLeadApprove");
  await checkAsync("[4g] FORWARD 執行成功：pendingRdLeadApproval -> pendingQaTriage", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: rdLeadApproveT.id, actorId: rdLead.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingQaTriage;
  });

  // ---- QA 段（快速走完，不重複已驗證過的阻擋情境） ----
  await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: qaTeam.id, actorId: supervisor.id, reasonCode: "TEST_ASSIGN_QA" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.pendingQaTriage, "qaAssign")).id, actorId: supervisor.id, reasonCode: "TEST" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.pendingQaClaim, "qaClaim")).id, actorId: qaMember.id, reasonCode: "TEST" });
  await prisma.issueFieldValue.create({ data: { issueId: issue.id, fieldKey: "qaTestResult", fieldLabel: "QA 測試結果", fieldValue: "通過" } });
  await answerRiskChecks(issue.id, "pendingQaLeadApproval", qaMember.id);
  await checkAsync("[4h] FORWARD 執行成功：qaInProgress -> pendingQaLeadApproval", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.qaInProgress, "qaSubmit")).id, actorId: qaMember.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingQaLeadApproval;
  });
  const qaLeadApproval = await findActiveApproval(issue.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
  await decideApprovalRecord({ approvalRecordId: qaLeadApproval.id, actorUserId: qaLead.id, decision: "APPROVED" });
  await checkAsync("[4i] FORWARD 執行成功：pendingQaLeadApproval -> pendingOpTriage", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.pendingQaLeadApproval, "qaLeadApprove")).id, actorId: qaLead.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingOpTriage;
  });

  // ---- OP 段 ----
  await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: opTeam.id, actorId: supervisor.id, reasonCode: "TEST_ASSIGN_OP" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.pendingOpTriage, "opAssign")).id, actorId: supervisor.id, reasonCode: "TEST" });
  await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.pendingOpClaim, "opClaim")).id, actorId: opMember.id, reasonCode: "TEST" });

  const opSubmitT = await findTransition(hotfix.version.id, hotfix.stageIds.opPreparing, "opSubmit");
  await expectError(
    "[12b] Requirement 未完成阻擋：opPreparing 缺佐證資料時不得送核",
    () => executeIssueTransition({ issueId: issue.id, transitionId: opSubmitT.id, actorId: opMember.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionBlockedError && e.reasons.some((r) => r.code === "STAGE_REQUIREMENT_NOT_MET"),
  );
  await prisma.evidence.create({ data: { issueId: issue.id, type: "Log", title: "部署前檢查", url: "http://example.invalid/checklist" } });
  await answerRiskChecks(issue.id, "pendingDeploymentApproval", opMember.id);
  await checkAsync("[4j] FORWARD 執行成功：opPreparing -> pendingDeploymentApproval", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: opSubmitT.id, actorId: opMember.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingDeploymentApproval;
  });
  const deployApproval = await findActiveApproval(issue.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
  await decideApprovalRecord({ approvalRecordId: deployApproval.id, actorUserId: opLead.id, decision: "APPROVED" });
  await checkAsync("[4k] FORWARD 執行成功：pendingDeploymentApproval -> opDeploying", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.pendingDeploymentApproval, "opLeadApprove")).id, actorId: opLead.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.opDeploying;
  });
  await checkAsync("[4l] FORWARD 執行成功：opDeploying -> opCompleted", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.opDeploying, "opDeployComplete")).id, actorId: opMember.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.opCompleted;
  });
  await checkAsync("[4m] FORWARD 執行成功：opCompleted -> pendingReporterConfirmation", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.opCompleted, "reporterConfirmOpen")).id, actorId: pm.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.pendingReporterConfirmation;
  });
  await checkAsync("[4n] FORWARD 執行成功：pendingReporterConfirmation -> reporterConfirming", async () => {
    const r = await executeIssueTransition({ issueId: issue.id, transitionId: (await findTransition(hotfix.version.id, hotfix.stageIds.pendingReporterConfirmation, "reporterClaim")).id, actorId: pm.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.reporterConfirming;
  });

  const reporterCloseT = await findTransition(hotfix.version.id, hotfix.stageIds.reporterConfirming, "reporterClose");
  await expectError(
    "[12c] Requirement 未完成阻擋：reporterConfirming 缺留言時不得結案",
    () => completeIssueWorkflow({ issueId: issue.id, transitionId: reporterCloseT.id, actorId: pm.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionBlockedError && e.reasons.some((r) => r.code === "STAGE_REQUIREMENT_NOT_MET"),
  );
  await prisma.comment.create({ data: { issueId: issue.id, authorRole: pm.role, authorName: pm.name, body: "確認完成，可以結案" } });

  await checkAsync("[7] completeIssueWorkflow：抵達 terminalOutcome=COMPLETED，closedAt 已設定", async () => {
    const r = await completeIssueWorkflow({ issueId: issue.id, transitionId: reporterCloseT.id, actorId: pm.id, reasonCode: "TEST_CLOSE" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.closed && r.issue.closedAt !== null;
  });

  await checkAsync("[16] Stage History 完整：全程歷程列數與 transitionType 分布正確", async () => {
    const rows = await getIssueWorkflowHistory(issue.id, admin.id);
    const entered = rows.filter((r) => r.transitionType === "ENTERED").length;
    const forwarded = rows.filter((r) => r.transitionType === "FORWARDED").length;
    const returned = rows.filter((r) => r.transitionType === "RETURNED").length;
    const allHaveActor = rows.every((r) => !!r.actorUserId);
    const lastRow = rows[rows.length - 1];
    return entered === 1 && forwarded >= 15 && returned === 1 && allHaveActor && lastRow.terminalOutcome === "COMPLETED" && lastRow.exitedAt === null;
  });

  await checkAsync("[Audit1] AuditLog 含 IssueWorkflowStarted／Advanced／Returned／StageCompleted 各類事件", async () => {
    const types = new Set(
      (await prisma.auditLog.findMany({ where: { entityType: "Issue", entityId: issue.id }, select: { actionType: true } })).map((a) => a.actionType),
    );
    return types.has("IssueWorkflowStarted") && types.has("IssueWorkflowAdvanced") && types.has("IssueWorkflowReturned") && types.has("IssueWorkflowStageCompleted") && types.has("ApprovalRequested");
  });

  return { hotfix, admin, pm, supervisor, rdTeam, rdMember, rdLead };
}

// ---------------------------------------------------------------------------
// 2. CANCEL 流程 + 取消後不得再 FORWARD
// ---------------------------------------------------------------------------

async function runCancelFlow(fx: Fixtures, hotfix: Awaited<ReturnType<typeof buildHotfixWorkflowV1>>, admin: { id: string }) {
  console.log("\n=== 二、CANCEL 流程 ===");
  const issue = await createIssueRow(fx, "Hotfix", "HOTFIX-0002-CANCEL");
  await startIssueWorkflow({ issueId: issue.id, workflowVersionId: hotfix.version.id, actorId: admin.id, reasonCode: "TEST_START" });

  const cancelT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "cancelDraft");
  await expectError(
    "[C1] CANCEL 未填 reasonCode 一律拒絕",
    () => cancelIssueWorkflow({ issueId: issue.id, transitionId: cancelT.id, actorId: admin.id, reasonCode: "" }),
    (e) => e instanceof WorkflowExecutionBlockedError,
  );

  await checkAsync("[6] CANCEL 執行成功：terminalOutcome=CANCELLED，closedAt 已設定", async () => {
    const r = await cancelIssueWorkflow({ issueId: issue.id, transitionId: cancelT.id, actorId: admin.id, reasonCode: "TEST_CANCEL" });
    return r.issue.currentWorkflowStageId === hotfix.stageIds.cancelled && r.issue.closedAt !== null;
  });

  await checkAsync("[C2] CANCEL 不得等同刪除 Issue：Issue 仍可查詢", async () => {
    const stillThere = await prisma.issue.findUnique({ where: { id: issue.id } });
    return !!stillThere;
  });

  await checkAsync("[C3] 歷程列 transitionType=CANCELLED，非 RETURNED", async () => {
    const rows = await getIssueWorkflowHistory(issue.id, admin.id);
    return rows[rows.length - 1].transitionType === "CANCELLED";
  });

  await expectError(
    "[C4] 取消後不得再執行普通 FORWARD",
    () => executeIssueTransition({ issueId: issue.id, transitionId: cancelT.id, actorId: admin.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionStateError,
  );
}

// ---------------------------------------------------------------------------
// 3. 通用最小流程（issueType=ChangeRelease，驗證引擎完全由定義驅動、不寫死 Hotfix）：
//    state precondition／重複送出拒絕／跨 Version 拒絕／disabled Transition 拒絕／
//    非授權直接服務呼叫拒絕／workflowStatus 不作執行來源／舊 Issue 相容。
// ---------------------------------------------------------------------------

async function buildGenericVersion(fx: Fixtures, actorId: string, issueType: string, keySuffix: string) {
  const definition = await createWorkflowDefinition({ key: `${RUN_TAG}-generic-${keySuffix}`, name: "通用測試流程", issueType, actorId, reasonCode: "TEST" });
  fx.definitionIds.push(definition.id);
  const version = await createDraftVersion({ workflowDefinitionId: definition.id, actorId, reasonCode: "TEST" });
  const start = await addWorkflowStage({ workflowVersionId: version.id, stageKey: "start", label: "起點", stageType: "SUBMISSION", sortOrder: 0, isStart: true, actorId, reasonCode: "TEST" });
  const mid = await addWorkflowStage({ workflowVersionId: version.id, stageKey: "mid", label: "進行中", stageType: "WORK", sortOrder: 1, actorId, reasonCode: "TEST" });
  const done = await addWorkflowStage({
    workflowVersionId: version.id, stageKey: "done", label: "完成", stageType: "CLOSURE", sortOrder: 2, isEnd: true, terminalOutcome: "COMPLETED", actorId, reasonCode: "TEST",
  });
  const cancelled = await addWorkflowStage({
    workflowVersionId: version.id, stageKey: "cancelled", label: "已取消", stageType: "CLOSURE", sortOrder: 3, isEnd: true, terminalOutcome: "CANCELLED", actorId, reasonCode: "TEST",
  });
  await addWorkflowTransition({ workflowVersionId: version.id, fromStageId: start.id, toStageId: mid.id, transitionType: "FORWARD", actionKey: "go", label: "前進", actorId, reasonCode: "TEST" });
  await addWorkflowTransition({ workflowVersionId: version.id, fromStageId: mid.id, toStageId: done.id, transitionType: "FORWARD", actionKey: "finish", label: "完成", actorId, reasonCode: "TEST" });
  await addWorkflowTransition({ workflowVersionId: version.id, fromStageId: start.id, toStageId: cancelled.id, transitionType: "CANCEL", actionKey: "cancel", label: "取消", requireReason: true, actorId, reasonCode: "TEST" });
  const published = await publishWorkflowVersion({ versionId: version.id, actorId, reasonCode: "TEST" });
  return { definition, version: published, stages: { start, mid, done, cancelled } };
}

async function runGenericEngineTests(fx: Fixtures) {
  console.log("\n=== 三、通用引擎行為（非 Hotfix 專屬，證明完全由定義驅動） ===");

  const admin = await createUser(fx, "Admin2", "Admin");
  const editor = await createUser(fx, "Editor", "PM");
  const noRoleUser = await createUser(fx, "NoRole", "PM", true); // 刻意不建立 UserRole：無任何 active 角色

  const genA = await buildGenericVersion(fx, admin.id, "ChangeRelease", "a");
  const genB = await buildGenericVersion(fx, admin.id, "MonitoringInventory", "b");
  const genC = await buildGenericVersion(fx, admin.id, "ChangeRelease", "c");

  // ---- 靜態原始碼檢查：workflow-execution 目錄內不得出現 issueType==="Hotfix" 之類散落判斷 ----
  const repoRoot = path.resolve(__dirname, "..");
  const executionDir = path.join(repoRoot, "src", "lib", "workflow-execution");
  const executionFiles = execSync(`find "${executionDir}" -name "*.ts"`).toString().trim().split("\n").filter(Boolean);
  let hardcodedIssueType = false;
  for (const f of executionFiles) {
    const src = fs.readFileSync(f, "utf8");
    if (/issueType\s*===\s*["']Hotfix["']/.test(src) || /workflowStatus\s*===\s*["']/.test(src)) hardcodedIssueType = true;
  }
  check("[HF1] src/lib/workflow-execution/** 不含 issueType===\"Hotfix\" 或 workflowStatus===\"...\" 散落判斷", !hardcodedIssueType);

  const issueA = await createIssueRow(fx, "ChangeRelease", "CHG-0001");
  await startIssueWorkflow({ issueId: issueA.id, workflowVersionId: genA.version.id, actorId: admin.id, reasonCode: "TEST" });

  // startWorkflowForIssueSystemTx：供 createIssueAction 於建立 Issue 的同一 transaction 內
  // 自動呼叫（見 [UI4] 靜態檢查），此處另外直接驗證這個內部進入點本身可用（不重複要求
  // admin.full，符合「系統本身於建單當下呼叫」的設計）。
  const issueSystemStart = await createIssueRow(fx, "ChangeRelease", "CHG-0000-SYSTEM-START");
  await checkAsync("[Sys1] startWorkflowForIssueSystemTx：供 createIssueAction 建單當下自動啟動使用", async () => {
    const updated = await prisma.$transaction((tx) =>
      startWorkflowForIssueSystemTx(tx, { issueId: issueSystemStart.id, workflowVersionId: genA.version.id, actorId: editor.id, reasonCode: "ISSUE_CREATED_AUTO_START" }),
    );
    return updated.workflowVersionId === genA.version.id && updated.currentWorkflowStageId === genA.stages.start.id;
  });

  const goT = await findTransition(genA.version.id, genA.stages.start.id, "go");

  await checkAsync("[8/9] state precondition／重複送出拒絕：第一次 FORWARD 成功，第二次相同呼叫被拒", async () => {
    const first = await executeIssueTransition({ issueId: issueA.id, transitionId: goT.id, actorId: editor.id, reasonCode: "TEST" });
    if (first.issue.currentWorkflowStageId !== genA.stages.mid.id) return false;
    try {
      await executeIssueTransition({ issueId: issueA.id, transitionId: goT.id, actorId: editor.id, reasonCode: "TEST" });
      return false;
    } catch (err) {
      return err instanceof WorkflowExecutionStateError;
    }
  });

  const crossVersionT = await findTransition(genB.version.id, genB.stages.start.id, "go");
  await expectError(
    "[10] 跨 Version Transition 拒絕",
    () => executeIssueTransition({ issueId: issueA.id, transitionId: crossVersionT.id, actorId: editor.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionStateError,
  );

  // ---- disabled Transition 拒絕：封存後不得再執行 ----
  const issueC = await createIssueRow(fx, "ChangeRelease", "CHG-0002-ARCHIVE");
  await startIssueWorkflow({ issueId: issueC.id, workflowVersionId: genC.version.id, actorId: admin.id, reasonCode: "TEST" });
  await archiveVersion({ versionId: genC.version.id, actorId: admin.id, reasonCode: "TEST_ARCHIVE" });
  const goCT = await findTransition(genC.version.id, genC.stages.start.id, "go");
  await expectError(
    "[11] disabled Transition 拒絕：版本已封存（ARCHIVED）後不得再執行",
    () => executeIssueTransition({ issueId: issueC.id, transitionId: goCT.id, actorId: editor.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionStateError,
  );

  // ---- 非授權直接服務呼叫拒絕 ----
  const finishTForAccessCheck = await findTransition(genA.version.id, genA.stages.mid.id, "finish");
  await expectError(
    "[22a] 非授權直接服務呼叫拒絕：無 UserRole 的帳號無法執行 FORWARD",
    () => executeIssueTransition({ issueId: issueA.id, transitionId: finishTForAccessCheck.id, actorId: noRoleUser.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionAccessDeniedError,
  );
  await expectError(
    "[22b] 非授權直接服務呼叫拒絕：無 admin.full 能力者不得 startIssueWorkflow",
    () => startIssueWorkflow({ issueId: issueA.id, workflowVersionId: genA.version.id, actorId: editor.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowExecutionAccessDeniedError || e instanceof WorkflowExecutionStateError,
  );

  // ---- workflowStatus 不作執行來源 ----
  await prisma.issue.update({ where: { id: issueA.id }, data: { workflowStatus: "totally-bogus-legacy-value" } });
  const finishT = await findTransition(genA.version.id, genA.stages.mid.id, "finish");
  await checkAsync("[20] workflowStatus 不作執行來源：即使 workflowStatus 被竄改為無效值，仍能依 currentWorkflowStageId 正確判斷並完成 FORWARD", async () => {
    const preview = await getAvailableIssueTransitions(issueA.id, editor.id);
    const found = preview.find((p) => p.transition.id === finishT.id);
    if (!found || !found.allowed) return false;
    const r = await completeIssueWorkflow({ issueId: issueA.id, transitionId: finishT.id, actorId: editor.id, reasonCode: "TEST" });
    return r.issue.currentWorkflowStageId === genA.stages.done.id && r.issue.workflowStatus === "done";
  });

  // ---- validateIssueTransition 唯讀預覽（不寫入） ----
  await checkAsync("[V1] validateIssueTransition：已完成的 Issue 對舊 transition 回報 invalid 且不寫入任何資料", async () => {
    const before = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issueA.id } });
    const result = await validateIssueTransition(issueA.id, goT.id, editor.id, "TEST");
    const after = await prisma.issueWorkflowStageHistory.count({ where: { issueId: issueA.id } });
    return !result.valid && result.errors.length > 0 && before === after;
  });

  // ---- 舊 Issue 相容 ----
  const legacyIssue = await prisma.issue.create({ data: { issueKey: `${RUN_TAG}-LEGACY-0001`, issueType: "Hotfix", title: "舊流程 Issue", workflowStatus: "opened" } });
  fx.issueIds.push(legacyIssue.id);
  check("[19a] 舊 Issue 相容：isIssueOnVersionedWorkflow 為 false", isIssueOnVersionedWorkflow(legacyIssue) === false);
  await checkAsync("[19b] 舊 Issue 相容：getIssueWorkflowRuntime 回傳 onVersionedWorkflow:false，不拋錯", async () => {
    const runtime = await getIssueWorkflowRuntime(legacyIssue.id, admin.id);
    return runtime.onVersionedWorkflow === false;
  });
  await checkAsync("[19c] 舊 Issue 相容：getAvailableIssueTransitions 回傳空陣列，不拋錯", async () => {
    const preview = await getAvailableIssueTransitions(legacyIssue.id, admin.id);
    return Array.isArray(preview) && preview.length === 0;
  });
  await checkAsync("[19d] 舊 Issue 相容：recordStageRequirementResult 回傳空陣列，不拋錯", async () => {
    const result = await recordStageRequirementResult(legacyIssue.id, admin.id);
    return Array.isArray(result) && result.length === 0;
  });

  // ---- 不得批次自動綁定既有 Issue：legacyIssue 在整個測試過程中應維持 workflowVersionId=null ----
  await checkAsync("[19e] 不得批次自動綁定既有 Issue：legacyIssue 全程維持 workflowVersionId=null", async () => {
    const now = await prisma.issue.findUniqueOrThrow({ where: { id: legacyIssue.id } });
    return now.workflowVersionId === null && now.currentWorkflowStageId === null;
  });
}

// ---------------------------------------------------------------------------
// 4. UI／Server Action 靜態邊界檢查
// ---------------------------------------------------------------------------

async function runStaticSourceChecks() {
  console.log("\n=== 四、UI／Server Action 靜態邊界檢查（必定執行，不依賴 DB） ===");
  const repoRoot = path.resolve(__dirname, "..");

  const execComponentsDir = path.join(repoRoot, "src", "components", "workflow-execution");
  if (fs.existsSync(execComponentsDir)) {
    const files = execSync(`find "${execComponentsDir}" -name "*.tsx" -o -name "*.ts"`).toString().trim().split("\n").filter(Boolean);
    let anyDirectPrisma = false;
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (/from ["']@prisma\/client["']/.test(src) || /from ["'].*\/prisma["']/.test(src)) {
        anyDirectPrisma = true;
        console.log(`    發現直接 import Prisma：${f}`);
      }
    }
    check("[UI1] src/components/workflow-execution/** 所有檔案皆不直接 import Prisma", !anyDirectPrisma);
  } else {
    skip("[UI1] 執行 UI 靜態檢查", "尚未建立 src/components/workflow-execution（UI 階段才會建立）");
  }

  const execActionsPath = path.join(repoRoot, "src", "app", "issues", "[id]", "workflow-execution-actions.ts");
  if (fs.existsSync(execActionsPath)) {
    const src = fs.readFileSync(execActionsPath, "utf8");
    check(
      '[UI2] workflow-execution-actions.ts 不 import "@prisma/client" 或 "@/lib/prisma"，只呼叫 workflowExecutionService',
      !/from ["']@prisma\/client["']/.test(src) && !/from ["']@\/lib\/prisma["']/.test(src),
    );
  } else {
    skip("[UI2] 執行 Server Action 靜態檢查", "尚未建立 workflow-execution-actions.ts（UI 階段才會建立）");
  }

  const actionsPath = path.join(repoRoot, "src", "lib", "actions.ts");
  const actionsSrc = fs.readFileSync(actionsPath, "utf8");
  check("[UI3] actions.ts 的 transitionStatusAction／sendBackToRdAction 已改為對新流程 Issue 拒絕執行", /isIssueOnVersionedWorkflow\(issue\)/.test(actionsSrc));
  check("[UI4] actions.ts 的 createIssueAction 已串接 startWorkflowForIssueSystemTx", /startWorkflowForIssueSystemTx/.test(actionsSrc));

  // [UI5]/[UI6]：未授權時不得建立 Issue。createIssueAction 呼叫 requireCurrentUser()
  // 需要 next/headers 的 cookies()，離開真實 request 情境無法直接呼叫（比照既有
  // m1_5_c1_b-verify.ts [9a]-[9d]／m1_5_c1_c-verify.ts 對 Server Action 的既有處理慣例，
  // 改以靜態原始碼檢查取代執行期呼叫）。這裡驗證的是「requireCurrentUser() 是
  // createIssueAction 函式體的第一行可執行陳述式，且早於任何 Issue 寫入（prisma.issue.create
  // 或 prisma.$transaction）」——未登入或已停用帳號會在 requireCurrentUser() 內被
  // redirect("/login")，函式體會在抵達任何寫入前就中止，因此不會建立孤兒 Issue。
  const createIssueActionMatch = actionsSrc.match(
    /export async function createIssueAction\([^)]*\)\s*\{([\s\S]*?)\n\}/,
  );
  check("[UI5] 找到 createIssueAction 函式本體，可供靜態檢查", createIssueActionMatch !== null);
  if (createIssueActionMatch) {
    const body = createIssueActionMatch[1];
    const requireCurrentUserIdx = body.indexOf("requireCurrentUser()");
    const firstIssueWriteIdx = (() => {
      const candidates = [body.indexOf("prisma.issue.create"), body.indexOf("prisma.$transaction")].filter((i) => i >= 0);
      return candidates.length > 0 ? Math.min(...candidates) : -1;
    })();
    check(
      "[UI6] createIssueAction 內 requireCurrentUser() 早於任何 Issue 寫入（未授權會在寫入前以 redirect 中止，不留下孤兒 Issue）",
      requireCurrentUserIdx >= 0 && firstIssueWriteIdx >= 0 && requireCurrentUserIdx < firstIssueWriteIdx,
      `requireCurrentUser() at ${requireCurrentUserIdx}, first issue write at ${firstIssueWriteIdx}`,
    );
  } else {
    skip("[UI6] createIssueAction 內 requireCurrentUser() 早於任何 Issue 寫入", "找不到 createIssueAction 函式本體");
  }
}

// ---------------------------------------------------------------------------
// 5. Migration 路徑驗證（Existing DB／Fresh DB／Synthetic M2-A History）
//
// 三者完全獨立於上面各段使用的主測試 DB，各自在 .m2_b_verify_migration_scratch/
// 底下建立自己的 scratch 檔案，只對 scratch 檔案執行 `prisma migrate deploy`／
// `prisma/seed.ts`，不曾對 DATABASE_URL 指定的主測試 DB、也不曾對正式
// /workspaces/governance-tracker/prisma/dev.db 送出任何 migrate/seed 或寫入——
// 正式 dev.db 只被當作「唯讀複製來源」（fs.copyFileSync）使用。
// ---------------------------------------------------------------------------

// 與 scripts/m1_5_c1_a-verify.ts 的 issueSetHash 完全相同的演算法（欄位順序、排序鍵、
// 序列化方式皆相同）——只用來確認「migration 前後 Issue 資料本身沒有變動」，不是拿來
// 跟外部提供、演算法未知的參考值逐位元比對。
const ISSUE_HASH_COLUMNS = [
  "id", "issueKey", "issueType", "title", "description", "systemName", "environment",
  "riskLevel", "priority", "ownerRole", "ownerName", "ownerUserId", "reporter", "reporterUserId",
  "workflowStatus", "statusLight", "dueDate", "needRca", "needRiskException", "impactProduction",
  "evidenceStatus", "blockReason", "waitingRole", "nextStep", "alertLevel", "firstResponseAt",
  "assignedTeamId", "stageEnteredAt", "changeSubType", "createdAt", "updatedAt", "closedAt",
]
  .map((c) => `"${c}"`)
  .join(", ");

async function issueSetHash(client: PrismaClient): Promise<string> {
  const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT ${ISSUE_HASH_COLUMNS} FROM "Issue" ORDER BY "id"`);
  const serialized = rows.map((r) => Object.values(r).join("|")).join("\n");
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

async function runExistingDbMigrationTest(): Promise<void> {
  const scratchPath = freshMigrationScratchPath("existing-upgrade.db");
  fs.rmSync(scratchPath, { force: true });

  const officialStatBefore = fs.statSync(OFFICIAL_DEV_DB);
  const officialHashBefore = crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex");
  fs.copyFileSync(OFFICIAL_DEV_DB, scratchPath);

  const before = migrationScratchClientFor(scratchPath);
  let snapBefore: Record<string, number | string>;
  try {
    snapBefore = {
      issueCount: await before.issue.count(),
      hotfix0004Count: await before.issue.count({ where: { issueKey: "HOTFIX-0004" } }),
      issueHash: await issueSetHash(before),
      userCount: await before.user.count(),
      userRoleCount: await before.userRole.count(),
      teamCount: await before.team.count(),
      teamMemberCount: await before.teamMember.count(),
      approvalRecordCount: await before.approvalRecord.count(),
      stageRiskCheckCount: await before.stageRiskCheck.count(),
      supervisorAssignmentCount: await before.userSupervisorAssignment.count(),
      approvalDelegationCount: await before.approvalDelegation.count(),
      workflowDefinitionCount: await before.workflowDefinition.count(),
      workflowVersionCount: await before.workflowVersion.count(),
      workflowStageCount: await before.workflowStage.count(),
      workflowTransitionCount: await before.workflowTransition.count(),
    };
  } finally {
    await before.$disconnect();
  }

  check("[MIG1-0] 複本 Issue 筆數為 19（正式基準）", snapBefore.issueCount === 19, `實際 ${snapBefore.issueCount}`);
  check("[MIG1-0b] 複本 HOTFIX-0004 為 0 筆（已清理殘留）", snapBefore.hotfix0004Count === 0, `實際 ${snapBefore.hotfix0004Count}`);

  migrateDeployOn(scratchPath);

  const after = migrationScratchClientFor(scratchPath);
  try {
    const issueCountAfter = await after.issue.count();
    const hotfix0004CountAfter = await after.issue.count({ where: { issueKey: "HOTFIX-0004" } });
    const issueHashAfter = await issueSetHash(after);
    const historyCountAfter = await after.issueWorkflowStageHistory.count();

    check("[MIG1-1] Issue 筆數不變（19）", issueCountAfter === snapBefore.issueCount, `前 ${snapBefore.issueCount} 後 ${issueCountAfter}`);
    check("[MIG1-2] HOTFIX-0004 不變（0）", hotfix0004CountAfter === snapBefore.hotfix0004Count);
    check("[MIG1-3] Issue hash 不變（migration 未曾觸碰 Issue 資料）", issueHashAfter === snapBefore.issueHash, `前 ${snapBefore.issueHash} 後 ${issueHashAfter}`);
    check("[MIG1-4] User 筆數不變", (await after.user.count()) === snapBefore.userCount);
    check("[MIG1-5] UserRole 筆數不變", (await after.userRole.count()) === snapBefore.userRoleCount);
    check("[MIG1-6] Team／TeamMember 筆數不變", (await after.team.count()) === snapBefore.teamCount && (await after.teamMember.count()) === snapBefore.teamMemberCount);
    check(
      "[MIG1-7] 治理資料（ApprovalRecord／StageRiskCheck／UserSupervisorAssignment／ApprovalDelegation）筆數不變",
      (await after.approvalRecord.count()) === snapBefore.approvalRecordCount &&
        (await after.stageRiskCheck.count()) === snapBefore.stageRiskCheckCount &&
        (await after.userSupervisorAssignment.count()) === snapBefore.supervisorAssignmentCount &&
        (await after.approvalDelegation.count()) === snapBefore.approvalDelegationCount,
    );
    check(
      "[MIG1-8] M2-A Workflow 定義資料（Definition／Version／Stage／Transition）筆數不變",
      (await after.workflowDefinition.count()) === snapBefore.workflowDefinitionCount &&
        (await after.workflowVersion.count()) === snapBefore.workflowVersionCount &&
        (await after.workflowStage.count()) === snapBefore.workflowStageCount &&
        (await after.workflowTransition.count()) === snapBefore.workflowTransitionCount,
    );
    check("[MIG1-9] IssueWorkflowStageHistory 為 0 筆（正式庫尚無既有執行紀錄）", historyCountAfter === 0, `實際 ${historyCountAfter}`);

    const fkCheck = await after.$queryRawUnsafe<Record<string, unknown>[]>("PRAGMA foreign_key_check;");
    check("[MIG1-10] 無孤兒 FK（套用 M2-B migration 後）", fkCheck.length === 0, JSON.stringify(fkCheck));

    const integrity = await after.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check;");
    check("[MIG1-11] PRAGMA integrity_check = ok", integrity[0]?.integrity_check === "ok", integrity[0]?.integrity_check);
  } finally {
    await after.$disconnect();
  }

  const officialStatAfter = fs.statSync(OFFICIAL_DEV_DB);
  const officialHashAfter = crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex");
  check(
    "[MIG1-12] 正式 dev.db 全程未被寫入（bytes／SHA-256／mtime 皆不變，本測試只複製，從未對正式檔案 migrate/寫入）",
    officialStatBefore.size === officialStatAfter.size && officialStatBefore.mtimeMs === officialStatAfter.mtimeMs && officialHashBefore === officialHashAfter,
  );
}

async function runFreshDbMigrationTest(): Promise<boolean> {
  const scratchPath = freshMigrationScratchPath("fresh-seed.db");
  fs.rmSync(scratchPath, { force: true });
  migrateDeployOn(scratchPath);
  seedOn(scratchPath);

  const client = migrationScratchClientFor(scratchPath);
  try {
    const userCount = await client.user.count();
    const issueCount = await client.issue.count();
    const historyCount = await client.issueWorkflowStageHistory.count();
    return userCount === 7 && issueCount === 19 && historyCount === 0;
  } finally {
    await client.$disconnect();
  }
}

/**
 * 官方 dev.db 目前仍停在 M2-A1（IssueWorkflowStageHistory 舊形狀：workflowStageId／
 * reason／enteredAt，0 筆既有資料），因此單獨複製官方 dev.db 並不足以驗證 M2-B
 * migration.sql 手動修正過的 INSERT...SELECT 資料搬移邏輯是否正確——0 筆資料的
 * migration 永遠會「成功」，卻證明不了任何東西。這裡刻意合成兩筆舊形狀歷史列
 * （一筆進行中關卡 terminalOutcome 應為 null，一筆終點關卡 terminalOutcome 應由
 * WorkflowStage 現場查出），驗證 migration 後的新形狀資料逐欄正確、且新增的
 * fromStageId／transitionId／assignedTeamIdBefore／assignedTeamIdAfter 四欄
 * 明確為 null（舊資料本來就不含這些事實，而非搬移遺漏）。
 */
async function runSyntheticM2aHistoryMigrationTest(): Promise<{ ok: boolean; detail?: string }> {
  const scratchPath = freshMigrationScratchPath("synthetic-history.db");
  fs.rmSync(scratchPath, { force: true });
  fs.copyFileSync(OFFICIAL_DEV_DB, scratchPath);

  const tag = `m2bmig${Date.now()}`;
  const setupClient = migrationScratchClientFor(scratchPath);
  let issueId: string;
  let enterStageId: string;
  let endStageId: string;
  let actorUserId: string;
  const enteredAtMs = Date.now() - 60_000;
  const exitedAtMs = Date.now() - 30_000;
  const closedAtMs = Date.now();
  try {
    const admin = await setupClient.user.findFirst({ where: { isActive: true } });
    if (!admin) return { ok: false, detail: "官方 dev.db 複本缺少可用的 active User，無法建立 synthetic fixture" };
    actorUserId = admin.id;

    const def = await setupClient.workflowDefinition.create({
      data: { key: `${tag}-def`, name: "Synthetic M2-A History", issueType: `${tag}-type`, createdByUserId: actorUserId },
    });
    const version = await setupClient.workflowVersion.create({
      data: { workflowDefinitionId: def.id, versionNo: 1, status: "PUBLISHED", createdByUserId: actorUserId, publishedAt: new Date(), publishedByUserId: actorUserId },
    });
    const enterStage = await setupClient.workflowStage.create({
      data: { workflowVersionId: version.id, stageKey: "in-progress", label: "進行中", stageType: "WORK", sortOrder: 1, isStart: true, isEnd: false },
    });
    const endStage = await setupClient.workflowStage.create({
      data: { workflowVersionId: version.id, stageKey: "closed", label: "結案", stageType: "CLOSURE", sortOrder: 2, isEnd: true, terminalOutcome: "COMPLETED" },
    });
    const issue = await setupClient.issue.create({
      data: { issueKey: `${tag}-ISSUE`, issueType: def.issueType, title: "Synthetic M2-A history issue", workflowStatus: "closed" },
    });
    issueId = issue.id;
    enterStageId = enterStage.id;
    endStageId = endStage.id;

    // 舊形狀 raw insert（M2-A1 時期的實際欄位：workflowStageId／reason／enteredAt，
    // 完全比照 M2-B migration.sql 頂部註解記載的舊 schema）。
    await setupClient.$executeRawUnsafe(
      `INSERT INTO "IssueWorkflowStageHistory" ("id","issueId","workflowStageId","transitionType","actorUserId","reason","enteredAt","exitedAt") VALUES (?,?,?,?,?,?,?,?)`,
      `${tag}-hist-1`, issueId, enterStageId, "ENTERED", actorUserId, null, enteredAtMs, exitedAtMs,
    );
    await setupClient.$executeRawUnsafe(
      `INSERT INTO "IssueWorkflowStageHistory" ("id","issueId","workflowStageId","transitionType","actorUserId","reason","enteredAt","exitedAt") VALUES (?,?,?,?,?,?,?,?)`,
      `${tag}-hist-2`, issueId, endStageId, "FORWARD", actorUserId, "已完成處理", closedAtMs, null,
    );
  } finally {
    await setupClient.$disconnect();
  }

  migrateDeployOn(scratchPath);

  const afterClient = migrationScratchClientFor(scratchPath);
  try {
    const rows = await afterClient.issueWorkflowStageHistory.findMany({ where: { issueId }, orderBy: { id: "asc" } });
    if (rows.length !== 2) return { ok: false, detail: `搬移後筆數應為 2，實際為 ${rows.length}` };
    const [row1, row2] = rows;

    const row1Ok =
      row1.toStageId === enterStageId &&
      row1.fromStageId === null &&
      row1.transitionId === null &&
      row1.assignedTeamIdBefore === null &&
      row1.assignedTeamIdAfter === null &&
      row1.reasonCode === null &&
      row1.terminalOutcome === null &&
      row1.executedAt.getTime() === enteredAtMs &&
      row1.exitedAt?.getTime() === exitedAtMs;

    const row2Ok =
      row2.toStageId === endStageId &&
      row2.fromStageId === null &&
      row2.transitionId === null &&
      row2.assignedTeamIdBefore === null &&
      row2.assignedTeamIdAfter === null &&
      row2.reasonCode === "已完成處理" &&
      row2.terminalOutcome === "COMPLETED" &&
      row2.executedAt.getTime() === closedAtMs &&
      row2.exitedAt === null;

    if (!row1Ok) return { ok: false, detail: `第一筆（進行中關卡）搬移後欄位不符：${JSON.stringify(row1)}` };
    if (!row2Ok) return { ok: false, detail: `第二筆（終點關卡）搬移後欄位不符：${JSON.stringify(row2)}` };
    return { ok: true };
  } finally {
    await afterClient.$disconnect();
  }
}

async function runMigrationPathTests() {
  console.log("\n=== 五、Migration 路徑驗證（Existing DB／Fresh DB／Synthetic M2-A History） ===");

  fs.mkdirSync(MIGRATION_SCRATCH_DIR, { recursive: true });

  if (!fs.existsSync(OFFICIAL_DEV_DB)) {
    skip("[MIG1] Existing DB Migration", `找不到正式 dev.db 複製來源：${OFFICIAL_DEV_DB}`);
    skip("[MIG3] Synthetic M2-A History Migration", `找不到正式 dev.db 複製來源：${OFFICIAL_DEV_DB}`);
  } else {
    await runExistingDbMigrationTest();
    await checkAsync("[MIG3] Synthetic M2-A History Migration：舊形狀歷史列搬移後欄位逐一正確（含 terminalOutcome 現場查出、新欄位明確為 null）", async () => {
      const result = await runSyntheticM2aHistoryMigrationTest();
      if (!result.ok) console.log(`    詳情：${result.detail}`);
      return result.ok;
    });
  }

  await checkAsync("[MIG2] Fresh DB Migration：全新空 DB 從 init 到 M2-B 完整套用＋seed 成功（7 位 User／19 筆 Issue／0 筆歷史紀錄）", runFreshDbMigrationTest);

  fs.rmSync(MIGRATION_SCRATCH_DIR, { recursive: true, force: true });
  console.log("    已清除 Migration 路徑驗證 scratch 目錄");
}

// ---------------------------------------------------------------------------
// 6. createIssueAction／Workflow 啟動交易原子性
//
// createIssueAction 本身（src/lib/actions.ts）因呼叫 requireCurrentUser()（需要
// next/headers 的 cookies()）而無法離開真實 request 情境直接呼叫（比照既有
// m1_5_c1_c-verify.ts／m2_a-verify.ts 對 Server Action 的既有處理慣例）。這裡
// 直接重現它內部真正的交易結構——同一個 prisma.$transaction 內先
// tx.issue.create() 再呼叫 startWorkflowForIssueSystemTx(tx, ...)——藉由讓
// 啟動步驟強制失敗，證明 Issue 建立不會單獨殘留（整個 transaction 一起回滾），
// 並以正向對照組證明兩者在成功時確實一起提交。
// ---------------------------------------------------------------------------

async function runAtomicityTests(fx: Fixtures) {
  console.log("\n=== 七、createIssueAction／Workflow 啟動交易原子性 ===");

  const actor = await createUser(fx, "AtomicActor", "Admin");

  // ---- ATM0：沒有適用 Published Workflow 時，resolveUniqueAutoStartVersionForIssueType
  // 回傳 null，createIssueAction 應完全比照今天的 legacy 路徑建立 Issue（不呼叫
  // startWorkflowForIssueSystemTx），workflowVersionId／currentWorkflowStageId 皆為 null。----
  const noWorkflowIssueType = `${RUN_TAG}-atm0-no-workflow-type`;
  await checkAsync("[ATM0] 沒有適用 Published Workflow：resolveUniqueAutoStartVersionForIssueType 回傳 null", async () => {
    const resolved = await resolveUniqueAutoStartVersionForIssueType(noWorkflowIssueType);
    return resolved === null;
  });
  await checkAsync("[ATM0b] 沒有適用 Published Workflow：legacy 路徑建立 Issue 成功，workflowVersionId／currentWorkflowStageId 皆為 null", async () => {
    const issue = await prisma.issue.create({
      data: { issueKey: `${RUN_TAG}-ATOMIC-LEGACY`, issueType: noWorkflowIssueType, title: "no applicable workflow probe", workflowStatus: "n/a" },
    });
    fx.issueIds.push(issue.id);
    return issue.workflowVersionId === null && issue.currentWorkflowStageId === null;
  });

  // ---- ATM3：同一 issueType 存在兩個「不同」WorkflowDefinition 各自有 Published 版本時，
  // 沒有 Plan 定義的唯一選擇規則，resolveUniqueAutoStartVersionForIssueType 必須 fail
  // closed 回傳 null，不得依查詢回傳順序任意挑選其中一個。----
  const ambiguousIssueType = `${RUN_TAG}-atm3-ambiguous-type`;
  await buildGenericVersion(fx, actor.id, ambiguousIssueType, "atm3-def-1");
  await buildGenericVersion(fx, actor.id, ambiguousIssueType, "atm3-def-2");
  await checkAsync("[ATM3] 存在兩個不同 Definition 皆適用同一 issueType 時 fail closed，不任意挑選", async () => {
    const resolved = await resolveUniqueAutoStartVersionForIssueType(ambiguousIssueType);
    return resolved === null;
  });
  await checkAsync("[ATM3b] fail closed 後 legacy 路徑仍可正常建立 Issue（不阻擋建單本身，只是不自動綁定）", async () => {
    const issue = await prisma.issue.create({
      data: { issueKey: `${RUN_TAG}-ATOMIC-AMBIGUOUS`, issueType: ambiguousIssueType, title: "ambiguous workflow probe", workflowStatus: "n/a" },
    });
    fx.issueIds.push(issue.id);
    return issue.workflowVersionId === null && issue.currentWorkflowStageId === null;
  });

  const rollbackIssueKey = `${RUN_TAG}-ATOMIC-ROLLBACK`;
  await checkAsync(
    "[ATM1] Workflow 啟動於同一 transaction 內失敗時，Issue 建立完整回滾（不留下孤兒 Issue）",
    async () => {
      try {
        await prisma.$transaction(async (tx) => {
          const created = await tx.issue.create({
            data: { issueKey: rollbackIssueKey, issueType: `${RUN_TAG}-atomic-type`, title: "atomicity rollback probe", workflowStatus: "n/a" },
          });
          await startWorkflowForIssueSystemTx(tx, {
            issueId: created.id,
            workflowVersionId: "does-not-exist-forces-rollback",
            actorId: actor.id,
            reasonCode: "ATOMICITY_TEST",
          });
        });
        return false; // 預期一定拋出例外，不應該走到這裡
      } catch {
        const found = await prisma.issue.findUnique({ where: { issueKey: rollbackIssueKey } });
        return found === null;
      }
    },
  );

  const atomicVersion = await buildGenericVersion(fx, actor.id, `${RUN_TAG}-atomic-ok-type`, "atomic-ok");
  const commitIssueKey = `${RUN_TAG}-ATOMIC-COMMIT`;
  await checkAsync(
    "[ATM2] 正向對照組：同一 transaction 內 Issue 建立與 Workflow 啟動皆成功時，兩者一起提交",
    async () => {
      const issue = await prisma.$transaction(async (tx) => {
        const created = await tx.issue.create({
          data: { issueKey: commitIssueKey, issueType: atomicVersion.definition.issueType, title: "atomicity commit probe", workflowStatus: "n/a" },
        });
        await startWorkflowForIssueSystemTx(tx, {
          issueId: created.id,
          workflowVersionId: atomicVersion.version.id,
          actorId: actor.id,
          reasonCode: "ATOMICITY_TEST",
        });
        return tx.issue.findUniqueOrThrow({ where: { id: created.id } });
      });
      fx.issueIds.push(issue.id);
      return issue.workflowVersionId === atomicVersion.version.id && issue.currentWorkflowStageId === atomicVersion.stages.start.id;
    },
  );
}

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------

async function cleanupFixtures(fx: Fixtures) {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["IssueWorkflowStageHistory", () => prisma.issueWorkflowStageHistory.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
    ["StageRiskCheck", () => prisma.stageRiskCheck.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
    ["ApprovalRecord", () => prisma.approvalRecord.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
    ["Comment", () => prisma.comment.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
    ["Evidence", () => prisma.evidence.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
    ["IssueFieldValue", () => prisma.issueFieldValue.deleteMany({ where: { issueId: { in: fx.issueIds } } })],
    ["UserSupervisorAssignment", () => prisma.userSupervisorAssignment.deleteMany({ where: { createdByUserId: { in: fx.userIds } } })],
    ["Issue", () => prisma.issue.deleteMany({ where: { id: { in: fx.issueIds } } })],
    ["WorkflowStageRequirement", () => prisma.workflowStageRequirement.deleteMany({ where: { workflowStage: { workflowVersion: { workflowDefinitionId: { in: fx.definitionIds } } } } })],
    ["WorkflowTransition", () => prisma.workflowTransition.deleteMany({ where: { workflowVersion: { workflowDefinitionId: { in: fx.definitionIds } } } })],
    ["WorkflowStage", () => prisma.workflowStage.deleteMany({ where: { workflowVersion: { workflowDefinitionId: { in: fx.definitionIds } } } })],
    ["WorkflowVersion", () => prisma.workflowVersion.deleteMany({ where: { workflowDefinitionId: { in: fx.definitionIds } } })],
    ["WorkflowDefinition", () => prisma.workflowDefinition.deleteMany({ where: { id: { in: fx.definitionIds } } })],
    ["AuditLog", () => prisma.auditLog.deleteMany({ where: { actorUserId: { in: fx.userIds } } })],
    ["TeamMember", () => prisma.teamMember.deleteMany({ where: { teamId: { in: fx.teamIds } } })],
    ["Team", () => prisma.team.deleteMany({ where: { id: { in: fx.teamIds } } })],
    ["UserRole", () => prisma.userRole.deleteMany({ where: { userId: { in: fx.userIds } } })],
    ["User", () => prisma.user.deleteMany({ where: { id: { in: fx.userIds } } })],
  ];
  for (const [label, fn] of steps) {
    try {
      await fn();
    } catch (e) {
      console.warn(`cleanup ${label} 失敗：`, e);
    }
  }
}

async function main() {
  console.log("=== M2-B 驗證：Issue Workflow 執行引擎 ===");

  await runStaticSourceChecks();

  console.log("\n=== 資料庫相依檢查（需 Migration 已套用；未套用時 SKIPPED，不嘗試自動套用） ===");

  let migrationApplied = false;
  try {
    await prisma.issueWorkflowStageHistory.count();
    migrationApplied = true;
  } catch {
    migrationApplied = false;
  }

  if (!migrationApplied) {
    skip("M2-B 服務層 DB 相依實測", "資料表尚未建立，等待 Migration 套用至測試資料庫後才能驗證，本輪不對任何資料庫套用 Migration");
  } else {
    const fx: Fixtures = { userIds: [], teamIds: [], issueIds: [], definitionIds: [] };
    try {
      const { hotfix, admin } = await runHotfixV1HappyPath(fx);
      await runCancelFlow(fx, hotfix, admin);
      await runGenericEngineTests(fx);
      await runAtomicityTests(fx);
    } finally {
      await cleanupFixtures(fx);
    }
  }

  await runMigrationPathTests();

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  await prisma.$disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("m2_b-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
