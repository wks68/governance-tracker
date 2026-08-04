// RD／QA／OP 執行人「送主管簽核」前置檢核與核准人解析 targeted verify。
//
// 對應本輪修正的兩個缺陷：
//   [1]-[3]   風險檢核死結：8 項固定檢核從未有使用者可完成的填答畫面，導致填完所有必填
//             欄位後仍被「尚無任何風險檢核紀錄」擋住。改由既有正式工單資料自動推導。
//   [4]-[13]  送簽核准人解析：核准來源必須是「本階段承接團隊的合法 active LEAD 或正式
//             ApprovalDelegation 代理人」，且送核人本人一律排除（不得自我核准）；找不到
//             其他人選時 fail closed，並顯示分關卡的友善業務訊息。
//   [14]-[17] 失敗後 rollback 完整性；成功後恰好一筆 active pending ApprovalRecord。
//   [18]      正式 dev.db 未被觸碰。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到本 worktree 的 prisma/dev.db。
//
// 執行方式：
//   touch /path/to/scratch.db && DATABASE_URL="file:/path/to/scratch.db" npx prisma migrate deploy
//   DATABASE_URL="file:/path/to/scratch.db" node_modules/.bin/tsx scripts/execution_submit_guard-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import {
  startIssueWorkflow,
  executeIssueTransition,
  claimIssueForTeam,
  assignIssueExecutor,
} from "../src/lib/workflowExecutionService";
import { decideApprovalRecord, ApprovalAuthorityMismatchError, NoEligibleApproverError } from "../src/lib/approvalService";
import { SelfApprovalError } from "../src/lib/permissions";
import { saveExecutionFieldValues, RD_FIX_FIELDS, QA_VERIFY_FIELDS, OP_DEPLOY_FIELDS } from "../src/lib/hotfix-ui/executionFields";
import { setTeamDomain } from "../src/lib/team-applicant/teamManagementService";
import { getRiskCheckTemplate } from "../src/lib/riskCheckTemplates";
import { deriveRiskChecksForStage } from "../src/lib/riskCheckDerivation";

const OFFICIAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";
const RUN_TAG = `esg-${Date.now().toString(36)}`;

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

// 回傳被攔下的錯誤，供後續斷言訊息內容；未拋出錯誤時視為失敗。
async function captureError(name: string, fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期被擋下，但實際成功）`);
    return null;
  } catch (err) {
    passCount++;
    console.log(`  PASS  ${name}`);
    return err instanceof Error ? err : new Error(String(err));
  }
}

// ---------------------------------------------------------------------------
// 共用建構
// ---------------------------------------------------------------------------

async function createUser(name: string, role: string) {
  const user = await prisma.user.create({
    data: { name: `${RUN_TAG}-${name}`, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive: true },
  });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function createTeam(name: string, domain: "RD" | "QA" | "OP", actorId: string) {
  const team = await prisma.team.create({ data: { name: `${RUN_TAG}-${name}` } });
  await setTeamDomain({ teamId: team.id, domain, actorId, reasonCode: "VERIFY" });
  return team;
}

async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD") {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
}

async function findTransition(workflowVersionId: string, fromStageId: string, actionKey: string) {
  const t = await prisma.workflowTransition.findFirst({ where: { workflowVersionId, fromStageId, actionKey } });
  if (!t) throw new Error(`找不到 Transition（actionKey=${actionKey}）`);
  return t;
}

async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  return prisma.approvalRecord.findFirst({
    where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" },
    orderBy: { revisionNo: "desc" },
  });
}

async function activePendingRecords(issueId: string) {
  return prisma.approvalRecord.findMany({ where: { issueId, recordStatus: "ACTIVE", decision: "PENDING" } });
}

interface Ctx {
  hotfix: Awaited<ReturnType<typeof buildHotfixWorkflowV1>>;
  admin: { id: string };
  pm: { id: string; name: string };
  supervisor: { id: string };
}

// 建立一張 Hotfix 工單並推進到 pendingRdTriage（第 3 關待接單）。
// 工單風險資料刻意填入正式值域，讓風險檢核推導有真實依據可用。
async function createIssueAtRdTriage(ctx: Ctx, key: string) {
  const issue = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-${key}`,
      issueType: "Hotfix",
      title: `送簽前置檢核驗證 ${key}`,
      workflowStatus: "n/a",
      reporterUserId: ctx.pm.id,
      reporter: ctx.pm.name,
      systemName: "MyDMS",
      environment: "Production",
      riskLevel: "中",
      priority: "P2",
      impactProduction: true,
    },
  });
  await startIssueWorkflow({ issueId: issue.id, workflowVersionId: ctx.hotfix.version.id, actorId: ctx.admin.id, reasonCode: "VERIFY" });
  const submitT = await findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.draft, "submit");
  await executeIssueTransition({ issueId: issue.id, transitionId: submitT.id, actorId: ctx.pm.id, reasonCode: "VERIFY" });
  const approval = await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
  await decideApprovalRecord({ approvalRecordId: approval!.id, actorUserId: ctx.supervisor.id, decision: "APPROVED" });
  const approveT = await findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.pendingBusinessApproval, "businessApprove");
  await executeIssueTransition({ issueId: issue.id, transitionId: approveT.id, actorId: ctx.pm.id, reasonCode: "VERIFY" });
  return issue;
}

const RD_VALUES: Record<string, string> = {
  rdFixVersion: "release/1.2.3 @ abc1234",
  rdFixDescription: "修正報表匯出時的資料庫查詢條件錯誤",
  rdSelfTestResult: "本機與測試環境皆已重跑匯出案例，結果正確",
  rdImpactScope: "僅影響報表模組匯出功能，使用者影響輕微，無跨系統相依",
};

const QA_VALUES: Record<string, string> = {
  qaTestScope: "報表匯出主功能、既有回歸案例、資料正確性與權限行為、跨模組整合",
  qaTestEnvironment: "共用測試環境 UAT-2",
  qaTestResult: "驗證通過",
  qaDefectNotes: "",
  qaRecommendation: "可上版",
};

const OP_VALUES: Record<string, string> = {
  opDeployEnvironment: "Production",
  opDeployPlannedAt: "2026-08-01T22:00",
  opImpactDurationMode: "無",
  opAnnouncementRequired: "否",
  opServiceOperationRequired: "否",
  opExpectedImpacts: '["無明顯影響"]',
  opDeploySteps: "停止排程 → 資料庫備份 → 部署新版本 → 驗證匯出功能",
  opRollbackTrigger: "部署驗證失敗或錯誤率超過門檻",
  opRollbackPlan: "以備份還原資料庫並回退至前一版本 tag",
  opRollbackUnavailableMode: "不適用",
  opMonitoringMethod: "不適用",
  opMonitoringNotApplicableReason: "targeted test 使用隔離環境，無外部監控端點",
};

// 讓某位執行人接下 RD 關卡並填完必填欄位，回傳送核用的 Transition id。
async function prepareRdExecution(ctx: Ctx, issueId: string, teamId: string, leadId: string, executorId: string) {
  await claimIssueForTeam({ issueId, teamId, actorId: leadId, reasonCode: "VERIFY" });
  await assignIssueExecutor({ issueId, executorUserId: executorId, actorId: leadId, reasonCode: "VERIFY" });
  await saveExecutionFieldValues({ issueId, actorId: executorId, values: RD_VALUES });
  return findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.rdInProgress, "rdSubmit");
}

// ---------------------------------------------------------------------------
// A. 風險檢核死結
// ---------------------------------------------------------------------------

async function runRiskCheckDeadlockChecks(ctx: Ctx) {
  console.log("\n=== A. 風險檢核死結 [1]-[3] ===");

  // 兩位 LEAD 的 RD 團隊：執行人是一般成員，送簽應直接成功（不因隱藏的風險檢核紀錄失敗）。
  const lead = await createUser("rd-lead-a", "RD");
  const lead2 = await createUser("rd-lead-a2", "RD");
  const member = await createUser("rd-member-a", "RD");
  const team = await createTeam("rd-a", "RD", ctx.admin.id);
  await addMember(team.id, lead.id, "LEAD");
  await addMember(team.id, lead2.id, "LEAD");
  await addMember(team.id, member.id, "MEMBER");

  const issue = await createIssueAtRdTriage(ctx, "risk-1");
  const rdSubmit = await prepareRdExecution(ctx, issue.id, team.id, lead.id, member.id);

  const beforeRiskRows = await prisma.stageRiskCheck.count({ where: { issueId: issue.id } });
  await executeIssueTransition({ issueId: issue.id, transitionId: rdSubmit.id, actorId: member.id, reasonCode: "SUBMIT_FOR_APPROVAL" });

  const after = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  check(
    "[1] RD 必填欄位完整時，送簽不因缺少隱藏風險檢核紀錄而失敗（成功進入 pendingRdLeadApproval）",
    after.workflowStatus === "pendingRdLeadApproval",
    `實際 ${after.workflowStatus}`,
  );

  const rows = await prisma.stageRiskCheck.findMany({ where: { issueId: issue.id, stageKey: "pendingRdLeadApproval" } });
  const template = getRiskCheckTemplate("pendingRdLeadApproval")!;
  const allAnswered = rows.length === template.length && rows.every((r) => r.answer === "YES" || r.answer === "NO");
  check(
    "[2] 既有風險資料於送簽 transaction 內自動形成完整的送核前置檢核結果（8 項皆有答案、無 null／UNKNOWN）",
    beforeRiskRows === 0 && allAnswered,
    `送簽前 ${beforeRiskRows} 筆、送簽後 ${rows.length} 筆`,
  );

  // 已從建立工單頁移除的三個「是否」欄位不得回到 RD／QA／OP 執行頁欄位定義。
  const removedKeys = ["needRiskException", "impactProduction", "needRca"];
  const reintroduced = [...RD_FIX_FIELDS, ...QA_VERIFY_FIELDS, ...OP_DEPLOY_FIELDS].filter((f) =>
    removedKeys.some((k) => f.key.toLowerCase().includes(k.toLowerCase())),
  );
  check("[3] 不重新要求 RD／QA／OP 填寫已移除的「是否需風險例外／影響正式環境／是否需 RCA」", reintroduced.length === 0, reintroduced.map((f) => f.key).join("、"));

  // 推導函式本身：模板每一項都要有結果，且永不產生 null／UNKNOWN。
  const derivedAllStages = ["pendingRdLeadApproval", "pendingQaLeadApproval", "pendingDeploymentApproval"].every((stageKey) => {
    const derived = deriveRiskChecksForStage(stageKey, {
      riskLevel: "高",
      environment: "Production",
      impactProduction: true,
      needRca: false,
      needRiskException: false,
      fieldValues: {},
    });
    const tpl = getRiskCheckTemplate(stageKey)!;
    return derived.length === tpl.length && derived.every((d) => d.answer === "YES" || d.answer === "NO");
  });
  check("[3b] RD／QA／OP 三個關卡的推導結果均涵蓋完整模板，且永不產生 UNKNOWN（不把死結往主管核准關卡推）", derivedAllStages);

  return { memberIssueId: issue.id, lead, lead2, member, team };
}

// ---------------------------------------------------------------------------
// B. 核准人解析與防自我核准
// ---------------------------------------------------------------------------

async function runApproverResolutionChecks(ctx: Ctx, prev: Awaited<ReturnType<typeof runRiskCheckDeadlockChecks>>) {
  console.log("\n=== B. 核准人解析與防自我核准 [4]-[13] ===");

  // [4] 一般 RD 執行人可送交同團隊主管核准（沿用 A 的工單）。
  const record = await findActiveApproval(prev.memberIssueId, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
  check("[4] 一般 RD 執行人送簽後，已建立 RD 主管核准紀錄", !!record && record.decision === "PENDING");
  check(
    "[4b] 承接團隊有兩位合法主管時不任選其一（expectedApproverUserId 留白，兩位皆可核准）",
    record?.expectedApproverUserId === null,
    `實際 ${record?.expectedApproverUserId}`,
  );
  check("[4c] 核准責任目標為本階段承接團隊，非申請人主管", record?.approverTeamId === prev.team.id);

  // [5][8] 正式指派模型要求 executor 是 MEMBER、指派者是 LEAD，兩種 membership
  // 不能硬塞給同一列。以「指派後唯一 LEAD 失效」重現沒有合法核准人的實際狀態。
  const soloLead = await createUser("rd-solo-lead", "RD");
  const soloMember = await createUser("rd-solo-member", "RD");
  const soloTeam = await createTeam("rd-solo", "RD", ctx.admin.id);
  await addMember(soloTeam.id, soloLead.id, "LEAD");
  await addMember(soloTeam.id, soloMember.id, "MEMBER");

  const soloIssue = await createIssueAtRdTriage(ctx, "solo-1");
  const soloSubmit = await prepareRdExecution(ctx, soloIssue.id, soloTeam.id, soloLead.id, soloMember.id);
  await prisma.teamMember.updateMany({
    where: { teamId: soloTeam.id, userId: soloLead.id },
    data: { isActive: false },
  });

  const beforeIssue = await prisma.issue.findUniqueOrThrow({ where: { id: soloIssue.id } });
  const beforeApprovalCount = await prisma.approvalRecord.count({ where: { issueId: soloIssue.id } });

  const soloErr = await captureError("[5] 指派後承接團隊沒有 active RD 主管或代理人時，送簽被擋下", () =>
    executeIssueTransition({ issueId: soloIssue.id, transitionId: soloSubmit.id, actorId: soloMember.id, reasonCode: "SUBMIT_FOR_APPROVAL" }),
  );

  check("[8] 沒有其他主管或代理人時 fail closed，且為專用的 NoEligibleApproverError", soloErr instanceof NoEligibleApproverError);

  const msg = soloErr?.message ?? "";
  check("[9] 錯誤訊息明確提到「團隊」與「核准治理設定」兩個可實際完成設定的入口", msg.includes("團隊") && msg.includes("核准治理設定"), msg);
  check(
    "[10] 錯誤訊息不顯示內部 stageKey",
    !msg.includes("stageKey") && !msg.includes("pendingRdLeadApproval") && !msg.includes("pendingQaLeadApproval") && !msg.includes("pendingDeploymentApproval"),
    msg,
  );
  check("[11] 錯誤訊息不誤稱為「未設定直屬主管」（本關缺的是承接團隊主管／代理人）", !msg.includes("直屬主管"), msg);
  check(
    "[11b] 錯誤訊息不含技術例外類別、資料表名稱或 guard 名稱",
    !msg.includes("ApprovalRecord") && !msg.includes("Error") && !msg.includes("Prisma") && !msg.includes("驗證失敗"),
    msg,
  );
  check("[11c] RD 關卡訊息明確指出缺少的是 RD 主管", msg.includes("RD 主管"), msg);

  // [14]-[16] 失敗後：工單停在原關卡、已填內容保留、不留半成品 ApprovalRecord。
  const afterIssue = await prisma.issue.findUniqueOrThrow({ where: { id: soloIssue.id } });
  check("[14] 送簽失敗後工單仍停留在原執行關卡（rdInProgress）", afterIssue.workflowStatus === beforeIssue.workflowStatus && afterIssue.workflowStatus === "rdInProgress", afterIssue.workflowStatus);
  check("[14b] 送簽失敗後 currentWorkflowStageId 未被改動", afterIssue.currentWorkflowStageId === beforeIssue.currentWorkflowStageId);

  const keptValues = await prisma.issueFieldValue.findMany({ where: { issueId: soloIssue.id, fieldKey: { in: Object.keys(RD_VALUES) } } });
  const allKept = Object.entries(RD_VALUES).every(([k, v]) => keptValues.find((r) => r.fieldKey === k)?.fieldValue === v);
  check("[15] 送簽失敗後已填 RD 內容完整保留", allKept && keptValues.length === Object.keys(RD_VALUES).length);

  const afterApprovalCount = await prisma.approvalRecord.count({ where: { issueId: soloIssue.id } });
  check("[16] 送簽失敗後不產生任何 ApprovalRecord（完整 rollback）", afterApprovalCount === beforeApprovalCount, `${beforeApprovalCount}→${afterApprovalCount}`);

  const orphanRisk = await prisma.stageRiskCheck.count({ where: { issueId: soloIssue.id, stageKey: "pendingRdLeadApproval" } });
  check("[16b] 送簽失敗後不留下半成品風險檢核紀錄（與 ApprovalRecord 同一 transaction 一起 rollback）", orphanRisk === 0, `實際 ${orphanRisk} 筆`);

  // [6] 重新啟用正式主管後可送簽；executor 本人仍不是核准人。
  await prisma.teamMember.updateMany({
    where: { teamId: soloTeam.id, userId: soloLead.id },
    data: { isActive: true },
  });
  await executeIssueTransition({ issueId: soloIssue.id, transitionId: soloSubmit.id, actorId: soloMember.id, reasonCode: "SUBMIT_FOR_APPROVAL" });
  const soloRecord = await findActiveApproval(soloIssue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
  check(
    "[6] active RD 主管恢復後，expectedApprover 為該主管且絕不是 MEMBER 執行人",
    soloRecord?.expectedApproverUserId === soloLead.id && soloRecord?.expectedApproverUserId !== soloMember.id,
    `實際 ${soloRecord?.expectedApproverUserId}`,
  );
  const selfApprovalErr = await captureError("[6b] 送核 MEMBER 本人不得核准自己的 RD 送簽", () =>
    decideApprovalRecord({ approvalRecordId: soloRecord!.id, actorUserId: soloMember.id, decision: "APPROVED" }),
  );
  check(
    "[6c] 自我核准由 Service 層拒絕，不依賴 UI 隱藏按鈕",
    selfApprovalErr instanceof SelfApprovalError || selfApprovalErr instanceof ApprovalAuthorityMismatchError,
  );
  check("[17] 送簽成功後恰好一筆 active pending ApprovalRecord", (await activePendingRecords(soloIssue.id)).length === 1);

  // [7] 正式 ApprovalDelegation 代理人可核准；executor 仍維持正式 MEMBER 身分。
  const delegLead = await createUser("rd-deleg-lead", "RD");
  const delegMember = await createUser("rd-deleg-member", "RD");
  const delegate = await createUser("rd-delegate", "RD");
  const delegTeam = await createTeam("rd-deleg", "RD", ctx.admin.id);
  await addMember(delegTeam.id, delegLead.id, "LEAD");
  await addMember(delegTeam.id, delegMember.id, "MEMBER");
  await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: delegLead.id,
      delegateUserId: delegate.id,
      teamId: delegTeam.id,
      approvalType: "RD_LEAD_APPROVAL",
      validFrom: new Date(Date.now() - 86_400_000),
      validUntil: new Date(Date.now() + 86_400_000),
      isActive: true,
      createdByUserId: ctx.admin.id,
    },
  });

  const delegIssue = await createIssueAtRdTriage(ctx, "deleg-1");
  const delegSubmit = await prepareRdExecution(ctx, delegIssue.id, delegTeam.id, delegLead.id, delegMember.id);
  await executeIssueTransition({ issueId: delegIssue.id, transitionId: delegSubmit.id, actorId: delegMember.id, reasonCode: "SUBMIT_FOR_APPROVAL" });

  const delegRecord = await findActiveApproval(delegIssue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
  check(
    "[7a] 正式主管與代理人皆合法時不任選其一（expectedApproverUserId 留白）",
    delegRecord?.expectedApproverUserId === null,
    `實際 ${delegRecord?.expectedApproverUserId}`,
  );
  const decided = await decideApprovalRecord({ approvalRecordId: delegRecord!.id, actorUserId: delegate.id, decision: "APPROVED" });
  check("[7b] 代理人可實際完成核准，且核准途徑記錄為 DELEGATE", decided.decision === "APPROVED" && decided.approvalAuthorityType === "DELEGATE");

  return { soloIssueId: soloIssue.id };
}

// ---------------------------------------------------------------------------
// C. QA／OP 共用同一套規則
// ---------------------------------------------------------------------------

// QA／OP 關卡的「指派後沒有 active 主管」情境：必須與 RD 完全相同地 fail closed，
// 訊息只在「RD／QA／OP 主管」這個字樣上不同，其餘規則不得各自實作一套。
async function runQaOpChecks(ctx: Ctx) {
  console.log("\n=== C. QA／OP 共用相同防自我核准規則 [12]-[13] ===");

  // 先把一張工單推到 QA 執行關卡：RD 端用有兩位主管的團隊，確保 RD 送簽與核准都能通過。
  const rdLead = await createUser("c-rd-lead", "RD");
  const rdLead2 = await createUser("c-rd-lead2", "RD");
  const rdMember = await createUser("c-rd-member", "RD");
  const rdTeam = await createTeam("c-rd", "RD", ctx.admin.id);
  await addMember(rdTeam.id, rdLead.id, "LEAD");
  await addMember(rdTeam.id, rdLead2.id, "LEAD");
  await addMember(rdTeam.id, rdMember.id, "MEMBER");

  const qaSoloLead = await createUser("c-qa-lead", "QA");
  const qaMember = await createUser("c-qa-member", "QA");
  const qaTeam = await createTeam("c-qa", "QA", ctx.admin.id);
  await addMember(qaTeam.id, qaSoloLead.id, "LEAD");
  await addMember(qaTeam.id, qaMember.id, "MEMBER");

  const opSoloLead = await createUser("c-op-lead", "OP");
  const opMember = await createUser("c-op-member", "OP");
  const opTeam = await createTeam("c-op", "OP", ctx.admin.id);
  await addMember(opTeam.id, opSoloLead.id, "LEAD");
  await addMember(opTeam.id, opMember.id, "MEMBER");

  const issue = await createIssueAtRdTriage(ctx, "qaop-1");
  const rdSubmit = await prepareRdExecution(ctx, issue.id, rdTeam.id, rdLead.id, rdMember.id);
  await executeIssueTransition({ issueId: issue.id, transitionId: rdSubmit.id, actorId: rdMember.id, reasonCode: "SUBMIT_FOR_APPROVAL" });
  const rdRecord = await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
  await decideApprovalRecord({ approvalRecordId: rdRecord!.id, actorUserId: rdLead.id, decision: "APPROVED" });
  const rdApproveT = await findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.pendingRdLeadApproval, "rdLeadApprove");
  await executeIssueTransition({ issueId: issue.id, transitionId: rdApproveT.id, actorId: rdLead.id, reasonCode: "VERIFY" });

  // QA：由主管完成指派後，唯一主管失效。
  await claimIssueForTeam({ issueId: issue.id, teamId: qaTeam.id, actorId: qaSoloLead.id, reasonCode: "VERIFY" });
  await assignIssueExecutor({ issueId: issue.id, executorUserId: qaMember.id, actorId: qaSoloLead.id, reasonCode: "VERIFY" });
  await saveExecutionFieldValues({ issueId: issue.id, actorId: qaMember.id, values: QA_VALUES });
  await prisma.teamMember.updateMany({ where: { teamId: qaTeam.id, userId: qaSoloLead.id }, data: { isActive: false } });
  const qaSubmit = await findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.qaInProgress, "qaSubmit");

  const qaErr = await captureError("[12] QA 團隊沒有 active 主管或代理人時，同樣 fail closed", () =>
    executeIssueTransition({ issueId: issue.id, transitionId: qaSubmit.id, actorId: qaMember.id, reasonCode: "SUBMIT_FOR_APPROVAL" }),
  );
  const qaMsg = qaErr?.message ?? "";
  check("[12b] QA 關卡顯示 QA 專屬的友善訊息，且不含 stageKey", qaMsg.includes("QA 主管") && qaMsg.includes("核准治理設定") && !qaMsg.includes("stageKey"), qaMsg);
  check("[12c] QA 送簽失敗後工單仍停在 qaInProgress", (await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).workflowStatus === "qaInProgress");

  // 補上第二位 QA 主管後即可通過，繼續推進到 OP 關卡
  const qaLead2 = await createUser("c-qa-lead2", "QA");
  await addMember(qaTeam.id, qaLead2.id, "LEAD");
  await executeIssueTransition({ issueId: issue.id, transitionId: qaSubmit.id, actorId: qaMember.id, reasonCode: "SUBMIT_FOR_APPROVAL" });
  const qaRecord = await findActiveApproval(issue.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
  check("[12d] 補上 active QA 主管後，expectedApprover 為主管而非 MEMBER 執行人", qaRecord?.expectedApproverUserId === qaLead2.id && qaRecord?.expectedApproverUserId !== qaMember.id);
  await decideApprovalRecord({ approvalRecordId: qaRecord!.id, actorUserId: qaLead2.id, decision: "APPROVED" });
  const qaApproveT = await findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.pendingQaLeadApproval, "qaLeadApprove");
  await executeIssueTransition({ issueId: issue.id, transitionId: qaApproveT.id, actorId: qaLead2.id, reasonCode: "VERIFY" });

  // OP：由主管完成指派後，唯一主管失效。
  await claimIssueForTeam({ issueId: issue.id, teamId: opTeam.id, actorId: opSoloLead.id, reasonCode: "VERIFY" });
  await assignIssueExecutor({ issueId: issue.id, executorUserId: opMember.id, actorId: opSoloLead.id, reasonCode: "VERIFY" });
  await saveExecutionFieldValues({ issueId: issue.id, actorId: opMember.id, values: OP_VALUES });
  await prisma.teamMember.updateMany({ where: { teamId: opTeam.id, userId: opSoloLead.id }, data: { isActive: false } });
  // opPreparing 另有既有的 REQUIRE_EVIDENCE 關卡需求（見 buildHotfixWorkflowV1），與本輪修正
  // 無關；先滿足它，才能確定後續攔截確實來自核准人解析而非佐證資料不足。
  await prisma.evidence.create({ data: { issueId: issue.id, type: "文件", title: `${RUN_TAG}-op-evidence`, url: "https://example.invalid/op-plan" } });
  const opSubmit = await findTransition(ctx.hotfix.version.id, ctx.hotfix.stageIds.opPreparing, "opSubmit");

  const opErr = await captureError("[13] OP 團隊沒有 active 主管或代理人時，同樣 fail closed", () =>
    executeIssueTransition({ issueId: issue.id, transitionId: opSubmit.id, actorId: opMember.id, reasonCode: "SUBMIT_FOR_APPROVAL" }),
  );
  const opMsg = opErr?.message ?? "";
  check("[13b] OP 關卡顯示 OP 專屬的友善訊息，且不含 stageKey", opMsg.includes("OP 主管") && opMsg.includes("核准治理設定") && !opMsg.includes("stageKey"), opMsg);

  const opKept = await prisma.issueFieldValue.findMany({ where: { issueId: issue.id, fieldKey: { in: Object.keys(OP_VALUES) } } });
  check("[13c] OP 送簽失敗後已填上版計畫完整保留", Object.entries(OP_VALUES).every(([k, v]) => opKept.find((r) => r.fieldKey === k)?.fieldValue === v));

  const opLead2 = await createUser("c-op-lead2", "OP");
  await addMember(opTeam.id, opLead2.id, "LEAD");
  await executeIssueTransition({ issueId: issue.id, transitionId: opSubmit.id, actorId: opMember.id, reasonCode: "SUBMIT_FOR_APPROVAL" });
  const opRecord = await findActiveApproval(issue.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
  check("[13d] 補上 active OP 主管後可正常送簽，expectedApprover 為主管而非 MEMBER 執行人", opRecord?.expectedApproverUserId === opLead2.id && opRecord?.expectedApproverUserId !== opMember.id);
  check("[17b] OP 送簽成功後同樣恰好一筆 active pending ApprovalRecord", (await activePendingRecords(issue.id)).length === 1);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("=== RD／QA／OP 送主管簽核前置檢核與核准人解析驗證 ===");

  const beforeHash = fs.existsSync(OFFICIAL_DEV_DB) ? crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex") : null;

  const admin = await createUser("admin", "Admin");
  const pm = await createUser("pm", "PM");
  const supervisor = await createUser("supervisor", "DMS主管");
  await prisma.userSupervisorAssignment.create({
    data: { userId: pm.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true , createdByUserId: admin.id },
  });

  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "VERIFY", keySuffix: RUN_TAG });
  const ctx: Ctx = { hotfix, admin, pm, supervisor };

  const prev = await runRiskCheckDeadlockChecks(ctx);
  await runApproverResolutionChecks(ctx, prev);
  await runQaOpChecks(ctx);

  console.log("\n=== D. 正式 dev.db 未被觸碰 [18] ===");
  const afterHash = fs.existsSync(OFFICIAL_DEV_DB) ? crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex") : null;
  check("[18] 正式 dev.db 前後 sha256 完全一致（或兩次皆不存在）", beforeHash === afterHash, `${beforeHash?.slice(0, 12)} → ${afterHash?.slice(0, 12)}`);

  console.log(`\n=== 結果：PASS ${passCount} / FAIL ${failCount} ===`);
  if (failCount > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
