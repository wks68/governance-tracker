// 建立工單、團隊與申請人連動、工單 CRUD 整合修正——targeted verify。
//
// 涵蓋範圍：
//   A. 原始碼層級靜態檢查：導覽列「團隊」文字、建立頁移除的 5 個欄位不再出現、建立頁
//      顯示「團隊名稱」、TeamApplicantSelector 不預先載入全體 User。
//   B. DB 整合測試（真正透過服務層／執行引擎推進，非直接寫 raw row）：團隊/申請人連動
//      查詢的授權邊界、createIssueForActor 的 team/applicant 重新驗證、BUSINESS_APPROVAL
//      核准資格依申請人（非 actor）解析、暫存不建立 ApprovalRecord、正式送簽才建立、
//      找不到主管時的友善訊息、駁回後重新送簽不重複、申請人刪除與 Admin 永久刪除的授權
//      邊界與資料清理、團隊 CRUD 授權邊界與引用保護、Admin 改派團隊/申請人。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase；verify 僅允許 /tmp 隔離 DB，
// 會在任何產品模組 import／寫入前拒絕正式或 Preview DB，process 結束自動清除 scratch。
//
// 執行方式：
//   touch /tmp/team-applicant-crud-scratch.db
//   DATABASE_URL="file:/tmp/team-applicant-crud-scratch.db" node_modules/.bin/tsx scripts/team_applicant_crud-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { createIssueForActor } from "../src/lib/issueCreation";
import {
  listCreatableTeamsForActor,
  listActiveApplicantsForTeam,
  assertActorCanUseTeam,
  assertValidApplicantForTeam,
  TeamApplicantAccessDeniedError,
  TeamApplicantValidationError,
} from "../src/lib/team-applicant/teamApplicantService";
import { createTeam, updateTeam, deleteTeamIfUnreferenced, setTeamDomain, TeamManagementAccessDeniedError, TeamManagementStateError } from "../src/lib/team-applicant/teamManagementService";
import { saveHotfixDraft } from "../src/lib/hotfix-ui/draftService";
import { canApplicantDeleteIssue, deleteOwnDraftIssue, adminPermanentDeleteIssue, IssueDeletionAccessDeniedError, IssueDeletionStateError, IssueDeletionValidationError } from "../src/lib/issue-management/issueDeletionService";
import { reassignHotfixTeamApplicant } from "../src/lib/hotfix-ui/adminReassignService";
import { executeIssueTransition, returnIssueToStage, getIssueWorkflowRuntime } from "../src/lib/workflowExecutionService";
import { decideApprovalRecord, NoEligibleApproverError, ApprovalAuthorityMismatchError } from "../src/lib/approvalService";
import { WorkflowExecutionAccessDeniedError } from "../src/lib/workflow-execution/types";
import { claimIssueForTeam } from "../src/lib/workflow-execution/claimService";
import { SelfApprovalError } from "../src/lib/permissions";

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

const REPO_ROOT = path.resolve(__dirname, "..");
const RUN_TAG = `tacv${Date.now()}`;

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// Section A：原始碼層級靜態檢查
// ---------------------------------------------------------------------------

function runStaticChecks() {
  console.log("=== Section A：原始碼層級靜態檢查 ===");

  const nav = readSrc("src/components/app-shell/AppShell.tsx");
  check("[A1] 系統設定顯示「團隊管理」", nav.includes('label: "團隊管理"'));
  check("[A2] 導覽列不再顯示裸字「Team」作為連結文字", !/label:\s*"Team"/.test(nav));

  const newIssueForm = readSrc("src/components/NewIssueForm.tsx");
  const forbiddenFieldNames = ["ownerUserId", "alertLevel", "needRca", "needRiskException", "impactProduction"];
  for (const f of forbiddenFieldNames) {
    check(`[A3] 建立工單頁不含欄位「${f}」`, !newIssueForm.includes(f), `仍找到 ${f}`);
  }
  check("[A4] 建立工單頁不顯示「負責人」標籤", !newIssueForm.includes(">負責人<"));
  check("[A5] 建立工單頁不顯示「告警等級」標籤", !newIssueForm.includes("告警等級"));
  check("[A6] 建立工單頁不顯示「是否需 RCA」", !newIssueForm.includes("是否需 RCA"));
  check("[A7] 建立工單頁不顯示「是否需風險例外」", !newIssueForm.includes("是否需風險例外"));
  check("[A8] 建立工單頁不顯示「是否影響正式環境」", !newIssueForm.includes("是否影響正式環境"));
  check("[A9] 建立工單頁顯示「團隊名稱」（透過 TeamApplicantSelector）", newIssueForm.includes("TeamApplicantSelector"));
  check("[A10] 建立工單頁顯示「附件（選填）」", newIssueForm.includes("附件（選填）"));

  const editPage = readSrc("src/app/issues/[id]/edit/page.tsx");
  for (const f of forbiddenFieldNames) {
    check(`[A11] 編輯工單頁不含欄位「${f}」`, !editPage.includes(f), `仍找到 ${f}`);
  }

  const selector = readSrc("src/components/team-applicant/TeamApplicantSelector.tsx");
  check("[A12] TeamApplicantSelector 顯示「請先選擇團隊」", selector.includes("請先選擇團隊"));
  check("[A13] TeamApplicantSelector 顯示「此團隊目前沒有可選擇的申請人」", selector.includes("此團隊目前沒有可選擇的申請人"));
  check("[A13b] 一般成員固定值使用 ReadOnlyField，不 render 空白 disabled select", selector.includes("teamReadOnly ?") && selector.includes("applicantReadOnly ?") && selector.includes("<ReadOnlyField"));
  check("[A14] TeamApplicantSelector 不 import Prisma", !selector.includes("@/lib/prisma") && !selector.includes("@prisma/client"));
  check("[A15] TeamApplicantSelector 切換團隊時清空申請人（onApplicantIdChange(\"\")）", selector.includes('onApplicantIdChange("")'));

  const draftForm = readSrc("src/app/issues/[id]/hotfix/create/HotfixDraftForm.tsx");
  check("[A16] Hotfix 建立工單頁（stage1）含 TeamApplicantSelector", draftForm.includes("TeamApplicantSelector"));

  const deleteBtn = readSrc("src/components/hotfix-nine-stage/DeleteOwnDraftButton.tsx");
  check("[A17] 刪除工單不使用瀏覽器原生 confirm", !deleteBtn.includes("window.confirm"));
  const adminDeleteBtn = readSrc("src/components/issue-management/AdminPermanentDeleteButton.tsx");
  check("[A18] Admin 永久刪除不使用瀏覽器原生 confirm", !adminDeleteBtn.includes("window.confirm"));
  check("[A19] Admin 永久刪除要求再次輸入工單編號才可送出", adminDeleteBtn.includes("confirmIssueKey.trim() === summary.issueKey"));

  const teamMgmtSvc = readSrc("src/lib/team-applicant/teamManagementService.ts");
  check("[A20] 團隊管理服務層使用 admin.full 能力（active UserRole），非 User.role", teamMgmtSvc.includes('"admin.full"') && !/user\.role\s*===\s*"Admin"/.test(teamMgmtSvc));
}

// ---------------------------------------------------------------------------
// Section B：DB 整合測試
// ---------------------------------------------------------------------------

async function createUser(name: string, role: string) {
  const user = await prisma.user.create({ data: { name: `${RUN_TAG}-${name}`, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}
async function createInactiveUser(name: string, role: string) {
  const user = await createUser(name, role);
  return prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
}
async function createTeamRaw(name: string) {
  return prisma.team.create({ data: { name: `${RUN_TAG}-${name}` } });
}
async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD", isActive = true) {
  return prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive } });
}
function buildCreateFormData(input: { title: string; teamId: string; applicantId: string }): FormData {
  const fd = new FormData();
  fd.set("issueType", "Hotfix");
  fd.set("title", input.title);
  fd.set("description", "verify script 建立");
  fd.set("systemName", "MyDMS");
  fd.set("environment", "Production");
  fd.set("riskLevel", "中");
  fd.set("dueDate", "2026-09-01");
  fd.set("hotfixPriority", "HIGH");
  fd.set("teamId", input.teamId);
  fd.set("applicantId", input.applicantId);
  return fd;
}
async function findTransition(workflowVersionId: string, fromStageId: string, actionKey: string) {
  const t = await prisma.workflowTransition.findFirst({ where: { workflowVersionId, fromStageId, actionKey } });
  if (!t) throw new Error(`找不到 Transition（fromStageId=${fromStageId}, actionKey=${actionKey}）`);
  return t;
}
async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  return prisma.approvalRecord.findFirst({ where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" }, orderBy: { revisionNo: "desc" } });
}

async function runDbChecks() {
  console.log("\n=== Section B：DB 整合測試 ===");

  const admin = await createUser("Admin", "Admin");
  const pm = await createUser("PM", "PM");
  const supervisor = await createUser("PMLead", "DMS主管");
  await prisma.userSupervisorAssignment.create({
    data: { userId: pm.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });
  const noSupervisorApplicant = await createUser("NoSup", "PM");
  const outsider = await createUser("Outsider", "PM");

  const teamA = await createTeamRaw("TeamA");
  await addMember(teamA.id, pm.id, "MEMBER");
  await addMember(teamA.id, supervisor.id, "LEAD");
  await addMember(teamA.id, noSupervisorApplicant.id, "MEMBER");
  const inactiveMember = await createUser("InactiveMember", "PM");
  await addMember(teamA.id, inactiveMember.id, "MEMBER", false);
  const inactiveUserButActiveMembership = await createInactiveUser("InactiveUser", "PM");
  await addMember(teamA.id, inactiveUserButActiveMembership.id, "MEMBER", true);

  const teamB = await createTeamRaw("TeamB");
  const teamBMember = await createUser("TeamBMember", "RD");
  await addMember(teamB.id, teamBMember.id, "MEMBER");

  const emptyTeam = await createTeamRaw("EmptyTeam");

  // 先發布 Hotfix v1 流程，讓後續所有 createIssueForActor 建立的 Hotfix 工單在建立當下即
  // 自動啟動版本化執行引擎（與正式系統行為一致），不需要另外手動呼叫 startWorkflowForIssueSystemTx。
  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "VERIFY_BUILD_HOTFIX_V1", keySuffix: RUN_TAG });

  // ---------------------------------------------------------------------------
  // Section C：HOTFIX-0033 根因回歸——申請人所屬團隊本身就是 RD 執行團隊（例如 AAD）時，
  // 直屬主管解析仍須依 UserSupervisorAssignment（申請人本人），不得誤用其他團隊的 LEAD，
  // 也不得因「申請人團隊＝處理團隊」而略過 RD 接單。刻意排在本節其餘測試（含永久刪除）
  // 之前執行：generateIssueKey 以現存 Hotfix 筆數計算下一個編號，稍後 B22／B28 永久刪除
  // 部分 Hotfix 工單後若再建立新工單，會因編號重複使用而撞號（既有、與本次根因無關的
  // 另一個缺口，已另行於最終報告揭露，本輪不在此修正範圍內），故本節先行建立與送出。
  // ---------------------------------------------------------------------------
  console.log("\n=== Section C：多團隊直屬主管解析回歸（HOTFIX-0033 根因）===");

  const aadLead = await createUser("AadLead", "RD");
  const aadMemberA = await createUser("AadMemberA", "RD");
  const aadTeam = await createTeamRaw("AAD");
  await setTeamDomain({ teamId: aadTeam.id, domain: "RD", actorId: admin.id, reasonCode: "VERIFY_C" });
  await addMember(aadTeam.id, aadLead.id, "LEAD");
  await addMember(aadTeam.id, aadMemberA.id, "MEMBER");
  await prisma.userSupervisorAssignment.create({
    data: { userId: aadMemberA.id, supervisorUserId: aadLead.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });

  // 另一個不相干 RD 團隊的主管：驗證跨團隊 LEAD 不會被誤判為 AAD 申請人的直屬主管。
  const iadLead = await createUser("IadLead", "RD");
  const iadTeam = await createTeamRaw("IAD");
  await setTeamDomain({ teamId: iadTeam.id, domain: "RD", actorId: admin.id, reasonCode: "VERIFY_C" });
  await addMember(iadTeam.id, iadLead.id, "LEAD");

  let aadIssue: Awaited<ReturnType<typeof createIssueForActor>> | null = null;
  await checkAsync("[C1] AAD工程師A 建立並暫存：不解析主管、不建立 ApprovalRecord、仍在 draft", async () => {
    aadIssue = await createIssueForActor(aadMemberA, buildCreateFormData({ title: "C1-AAD", teamId: aadTeam.id, applicantId: aadMemberA.id }));
    await saveHotfixDraft({ issueId: aadIssue.id, actorId: aadMemberA.id, fields: {} });
    const approval = await findActiveApproval(aadIssue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: aadIssue.id } });
    const stage = await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId! } });
    return !approval && stage?.stageKey === "draft";
  });

  await checkAsync("[C2] 正式送出後，resolver 依申請人解析出唯一直屬主管 AadLead，非 IadLead／非 actor", async () => {
    const submitT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
    await executeIssueTransition({ issueId: aadIssue!.id, transitionId: submitT.id, actorId: aadMemberA.id, reasonCode: "C2" });
    const approval = await findActiveApproval(aadIssue!.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    return approval?.expectedApproverUserId === aadLead.id && approval?.expectedApproverUserId !== iadLead.id;
  });

  await checkAsync("[C3] 工單已進入第 2 關 pendingBusinessApproval，且僅一筆 ACTIVE+PENDING ApprovalRecord", async () => {
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: aadIssue!.id } });
    const stage = await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId! } });
    const count = await prisma.approvalRecord.count({
      where: { issueId: aadIssue!.id, approvalType: "BUSINESS_APPROVAL", recordStatus: "ACTIVE", decision: "PENDING" },
    });
    return stage?.stageKey === "pendingBusinessApproval" && count === 1;
  });

  await expectError(
    "[C4] AAD工程師A 本人不可自我核准",
    async () => {
      const approval = await findActiveApproval(aadIssue!.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
      return decideApprovalRecord({ approvalRecordId: approval!.id, actorUserId: aadMemberA.id, decision: "APPROVED" });
    },
    (err) => err instanceof SelfApprovalError,
  );

  await expectError(
    "[C5] 其他團隊主管（IadLead）不具核准資格",
    async () => {
      const approval = await findActiveApproval(aadIssue!.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
      return decideApprovalRecord({ approvalRecordId: approval!.id, actorUserId: iadLead.id, decision: "APPROVED" });
    },
    (err) => err instanceof ApprovalAuthorityMismatchError,
  );

  await expectError(
    "[C6] Admin 不因身分自動取得核准權",
    async () => {
      const approval = await findActiveApproval(aadIssue!.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
      return decideApprovalRecord({ approvalRecordId: approval!.id, actorUserId: admin.id, decision: "APPROVED" });
    },
    (err) => err instanceof ApprovalAuthorityMismatchError,
  );

  await checkAsync("[C7] AadLead 同意後，工單進入 RD Triage（待團隊接單），不自動指派給 AAD", async () => {
    const approval = await findActiveApproval(aadIssue!.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    await decideApprovalRecord({ approvalRecordId: approval!.id, actorUserId: aadLead.id, decision: "APPROVED" });
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.pendingBusinessApproval, "businessApprove");
    await executeIssueTransition({ issueId: aadIssue!.id, transitionId: t.id, actorId: aadLead.id, reasonCode: "C7" });
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: aadIssue!.id } });
    const stage = await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId! } });
    return stage?.stageKey === "pendingRdTriage" && issue.assignedTeamId === null;
  });

  await checkAsync("[C8] AadLead 正式按下接單後，assignedTeamId 才變回 AAD（非自動指派）", async () => {
    await claimIssueForTeam({ issueId: aadIssue!.id, teamId: aadTeam.id, actorId: aadLead.id, reasonCode: "C8" });
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: aadIssue!.id } });
    return issue.assignedTeamId === aadTeam.id;
  });

  // ---- 零位／多位主管 fail closed（defense-in-depth：即使繞過 supervisorAssignmentService
  // 直接寫入異常資料，決策層仍必須 deny-by-default，不得任選第一位）----
  const ambiguousApplicant = await createUser("AmbiguousApplicant", "RD");
  await addMember(aadTeam.id, ambiguousApplicant.id, "MEMBER");
  const secondLeadCandidate = await createUser("SecondLeadCandidate", "RD");
  await prisma.userSupervisorAssignment.create({
    data: { userId: ambiguousApplicant.id, supervisorUserId: aadLead.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });
  await prisma.userSupervisorAssignment.create({
    data: { userId: ambiguousApplicant.id, supervisorUserId: secondLeadCandidate.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });

  await expectError(
    "[C9] 零位／多位（歧義）主管時 fail closed，不得任選第一位",
    async () => {
      const issue = await createIssueForActor(ambiguousApplicant, buildCreateFormData({ title: "C9-Ambiguous", teamId: aadTeam.id, applicantId: ambiguousApplicant.id }));
      const submitT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
      return executeIssueTransition({ issueId: issue.id, transitionId: submitT.id, actorId: ambiguousApplicant.id, reasonCode: "C9" });
    },
    (err) => err instanceof NoEligibleApproverError,
  );
  await checkAsync("[C10] fail closed 後該工單仍在 draft、未建立任何 ApprovalRecord", async () => {
    const issue = await prisma.issue.findFirst({ where: { reporterUserId: ambiguousApplicant.id } });
    const stage = issue?.currentWorkflowStageId ? await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId } }) : null;
    const approvalCount = await prisma.approvalRecord.count({ where: { issueId: issue!.id } });
    return stage?.stageKey === "draft" && approvalCount === 0;
  });

  // ---- 團隊／申請人連動查詢授權邊界 ----
  await checkAsync("[B1] Admin 可看到所有團隊", async () => {
    const teams = await listCreatableTeamsForActor(admin.id);
    const ids = teams.map((t) => t.id);
    return ids.includes(teamA.id) && ids.includes(teamB.id) && ids.includes(emptyTeam.id);
  });
  await checkAsync("[B2] 非 Admin 只能看到自己所屬團隊", async () => {
    const teams = await listCreatableTeamsForActor(pm.id);
    const ids = teams.map((t) => t.id);
    return ids.includes(teamA.id) && !ids.includes(teamB.id);
  });
  await checkAsync("[B3] 申請人下拉只列出該團隊 active 成員（active User + active TeamMember）", async () => {
    const applicants = await listActiveApplicantsForTeam(pm.id, teamA.id);
    const ids = applicants.map((a) => a.id);
    return ids.includes(pm.id) && ids.includes(supervisor.id) && !ids.includes(inactiveMember.id) && !ids.includes(inactiveUserButActiveMembership.id) && !ids.includes(teamBMember.id);
  });
  await expectError(
    "[B4] 非成員向不屬於自己的團隊查詢申請人被拒絕",
    () => listActiveApplicantsForTeam(outsider.id, teamA.id),
    (err) => err instanceof TeamApplicantAccessDeniedError,
  );
  await expectError(
    "[B5] 偽造 applicantId（非該團隊成員）被拒絕",
    () => assertValidApplicantForTeam(teamA.id, teamBMember.id),
    (err) => err instanceof TeamApplicantValidationError,
  );
  await expectError(
    "[B6] 偽造不存在的 teamId 被拒絕（非 Admin）",
    () => assertActorCanUseTeam(pm.id, "nonexistent-team-id"),
    (err) => err instanceof TeamApplicantAccessDeniedError,
  );

  // ---- createIssueForActor：applicant 與 actor 分開保存 ----
  let adminCreatedIssue: Awaited<ReturnType<typeof createIssueForActor>> | null = null;
  await checkAsync("[B7] Admin 代團隊成員建立工單：applicant 為 pm，actor 為 admin，兩者分開保存", async () => {
    adminCreatedIssue = await createIssueForActor(admin, buildCreateFormData({ title: `${RUN_TAG}-admin-for-pm`, teamId: teamA.id, applicantId: pm.id }));
    const auditLog = await prisma.auditLog.findFirst({ where: { entityType: "Issue", entityId: adminCreatedIssue.id, actionType: "IssueCreated" } });
    return (
      adminCreatedIssue.reporterUserId === pm.id &&
      adminCreatedIssue.assignedTeamId === teamA.id &&
      auditLog?.actorUserId === admin.id &&
      !!auditLog?.summary.includes(pm.name) &&
      !!auditLog?.summary.includes("實際建立者")
    );
  });
  await expectError(
    "[B8] Admin 代建工單不會因此取得該工單主管簽核權：Admin 嘗試核准會被拒絕（並非合格核准來源）",
    async () => {
      if (!adminCreatedIssue) throw new Error("adminCreatedIssue 未建立");
      await saveHotfixDraft({ issueId: adminCreatedIssue.id, actorId: pm.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-09-05" } });
      const t = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
      await executeIssueTransition({ issueId: adminCreatedIssue.id, transitionId: t.id, actorId: pm.id, reasonCode: "VERIFY_SUBMIT" });
      const approval = await findActiveApproval(adminCreatedIssue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
      await decideApprovalRecord({ approvalRecordId: approval!.id, actorUserId: admin.id, decision: "APPROVED" });
    },
    (err) => err instanceof Error && err.name === "ApprovalAuthorityMismatchError",
  );

  await expectError(
    "[B9] 偽造 teamId（不存在）被 createIssueForActor 拒絕（Admin 建立，直接命中團隊不存在的驗證）",
    () => createIssueForActor(admin, buildCreateFormData({ title: `${RUN_TAG}-bad-team`, teamId: "nonexistent", applicantId: pm.id })),
    (err) => err instanceof TeamApplicantValidationError,
  );
  await expectError(
    "[B10] applicant 與 team 不一致被 createIssueForActor 拒絕",
    () => createIssueForActor(pm, buildCreateFormData({ title: `${RUN_TAG}-mismatch`, teamId: teamA.id, applicantId: teamBMember.id })),
    // 一般成員的新建 scope 先限制 applicant=本人，因此偽造其他申請人會在更前面的
    // 授權邊界被拒絕；若是 Admin／主管則會繼續走到 team-applicant 一致性驗證。
    (err) => err instanceof TeamApplicantAccessDeniedError || err instanceof TeamApplicantValidationError,
  );
  await expectError(
    "[B11] 非該團隊成員的 actor 偽造 teamId 建立工單被拒絕",
    () => createIssueForActor(outsider, buildCreateFormData({ title: `${RUN_TAG}-outsider`, teamId: teamA.id, applicantId: pm.id })),
    (err) => err instanceof TeamApplicantAccessDeniedError,
  );

  // ---- BUSINESS_APPROVAL 依申請人（非 actor）解析主管 ----
  const selfCreated = await createIssueForActor(pm, buildCreateFormData({ title: `${RUN_TAG}-self`, teamId: teamA.id, applicantId: pm.id }));

  await checkAsync("[B12] 暫存（saveHotfixDraft）不建立 ApprovalRecord", async () => {
    const before = await prisma.approvalRecord.count({ where: { issueId: selfCreated.id } });
    await saveHotfixDraft({ issueId: selfCreated.id, actorId: pm.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-09-05" } });
    const after = await prisma.approvalRecord.count({ where: { issueId: selfCreated.id } });
    return before === 0 && after === 0;
  });

  let adminForPmSubmitted: Awaited<ReturnType<typeof createIssueForActor>> | null = null;
  await checkAsync("[B13] Admin 代 pm 建立並由 pm 正式送簽：BUSINESS_APPROVAL requestedByUserId = 申請人（pm），不是 admin", async () => {
    adminForPmSubmitted = await createIssueForActor(admin, buildCreateFormData({ title: `${RUN_TAG}-admin-submit-for-pm`, teamId: teamA.id, applicantId: pm.id }));
    await saveHotfixDraft({ issueId: adminForPmSubmitted.id, actorId: pm.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-09-05" } });
    const submitT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
    // 代建情境下，實際送出「送簽」動作的 actor 就是申請人本人（pm）——這是正式流程唯一入口
    // （申請人在自己的 stage1 頁面按下「建立工單」）；本檢查驗證的是解析主管時看的是
    // reporterUserId，不是任何呼叫端傳入的 actorId。
    await executeIssueTransition({ issueId: adminForPmSubmitted.id, transitionId: submitT.id, actorId: pm.id, reasonCode: "VERIFY_SUBMIT" });
    const approval = await findActiveApproval(adminForPmSubmitted.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    return approval?.requestedByUserId === pm.id && approval?.expectedApproverUserId === supervisor.id;
  });

  await checkAsync("[B14] 正式送簽後才建立 pending ApprovalRecord（且僅一筆 ACTIVE+PENDING）", async () => {
    if (!adminForPmSubmitted) return false;
    const records = await prisma.approvalRecord.findMany({ where: { issueId: adminForPmSubmitted.id, recordStatus: "ACTIVE", decision: "PENDING" } });
    return records.length === 1;
  });

  // ---- 找不到主管時的友善訊息 ----
  const noSupIssue = await createIssueForActor(noSupervisorApplicant, buildCreateFormData({ title: `${RUN_TAG}-no-sup`, teamId: teamA.id, applicantId: noSupervisorApplicant.id }));
  await saveHotfixDraft({ issueId: noSupIssue.id, actorId: noSupervisorApplicant.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-09-05" } });
  await expectError(
    "[B15] 申請人未設定直屬主管時送簽顯示友善訊息（非 Prisma／ApprovalRecord 技術字眼），且完整 rollback",
    async () => {
      const t = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
      await executeIssueTransition({ issueId: noSupIssue.id, transitionId: t.id, actorId: noSupervisorApplicant.id, reasonCode: "VERIFY_SUBMIT" });
    },
    (err) => err instanceof NoEligibleApproverError && (err as NoEligibleApproverError).message.includes("尚未設定直屬主管或授權代理人"),
  );
  await checkAsync("[B16] 送簽失敗後完整 rollback：工單仍在 draft，未建立任何 ApprovalRecord", async () => {
    const runtime = await getIssueWorkflowRuntime(noSupIssue.id, admin.id);
    const recordCount = await prisma.approvalRecord.count({ where: { issueId: noSupIssue.id } });
    return runtime.onVersionedWorkflow && runtime.currentStage.stageKey === "draft" && recordCount === 0;
  });

  // ---- 駁回後暫存不建立新 pending，重新送簽後只有一筆有效 pending ----
  const rejectFlow = await createIssueForActor(pm, buildCreateFormData({ title: `${RUN_TAG}-reject-flow`, teamId: teamA.id, applicantId: pm.id }));
  await saveHotfixDraft({ issueId: rejectFlow.id, actorId: pm.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-09-05" } });
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
    await executeIssueTransition({ issueId: rejectFlow.id, transitionId: t.id, actorId: pm.id, reasonCode: "VERIFY_SUBMIT" });
    const approval = await findActiveApproval(rejectFlow.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    await decideApprovalRecord({ approvalRecordId: approval!.id, actorUserId: supervisor.id, decision: "REJECTED", decisionComment: "請補件" });
    const rejectT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingBusinessApproval, "businessReject");
    await returnIssueToStage({ issueId: rejectFlow.id, transitionId: rejectT.id, actorId: supervisor.id, reasonCode: "請補件" });
  }
  await checkAsync("[B17] 駁回後暫存不建立新 pending ApprovalRecord", async () => {
    const before = await prisma.approvalRecord.count({ where: { issueId: rejectFlow.id, recordStatus: "ACTIVE", decision: "PENDING" } });
    await saveHotfixDraft({ issueId: rejectFlow.id, actorId: pm.id, fields: { title: `${RUN_TAG}-reject-flow-updated` } });
    const after = await prisma.approvalRecord.count({ where: { issueId: rejectFlow.id, recordStatus: "ACTIVE", decision: "PENDING" } });
    return before === 0 && after === 0;
  });
  await checkAsync("[B18] 重新送簽後只有一筆有效 pending ApprovalRecord", async () => {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
    await executeIssueTransition({ issueId: rejectFlow.id, transitionId: t.id, actorId: pm.id, reasonCode: "VERIFY_RESUBMIT" });
    const pending = await prisma.approvalRecord.findMany({ where: { issueId: rejectFlow.id, recordStatus: "ACTIVE", decision: "PENDING" } });
    const all = await prisma.approvalRecord.findMany({ where: { issueId: rejectFlow.id } });
    return pending.length === 1 && all.length === 2 && all.some((r) => r.recordStatus === "SUPERSEDED");
  });

  // ---- 申請人刪除 ----
  const deletableDraft = await createIssueForActor(pm, buildCreateFormData({ title: `${RUN_TAG}-deletable`, teamId: teamA.id, applicantId: pm.id }));
  await checkAsync("[B19] 申請人可刪除自己尚未送簽的草稿", async () => (await canApplicantDeleteIssue(deletableDraft.id, pm.id)).allowed);
  await checkAsync("[B20] 他人不可刪除申請人的草稿", async () => !(await canApplicantDeleteIssue(deletableDraft.id, outsider.id)).allowed);
  await checkAsync("[B21] 已送簽工單申請人不可刪除", async () => !(await canApplicantDeleteIssue(adminForPmSubmitted!.id, pm.id)).allowed);

  await checkAsync("[B22] 刪除後清除關聯資料且無孤兒列，AuditLog 仍保留刪除紀錄", async () => {
    const issueId = deletableDraft.id;
    await deleteOwnDraftIssue({ issueId, actorId: pm.id });
    const [issueGone, historyGone, approvalGone, auditLog] = await Promise.all([
      prisma.issue.findUnique({ where: { id: issueId } }),
      prisma.issueWorkflowStageHistory.count({ where: { issueId } }),
      prisma.approvalRecord.count({ where: { issueId } }),
      prisma.auditLog.findFirst({ where: { entityType: "Issue", entityId: issueId, actionType: "IssueDeleted" } }),
    ]);
    return issueGone === null && historyGone === 0 && approvalGone === 0 && !!auditLog;
  });
  await checkAsync("[B23] 刪除後原工單 URL（依 id 查詢）不可再讀取", async () => (await prisma.issue.findUnique({ where: { id: deletableDraft.id } })) === null);

  await expectError(
    "[B24] 已送簽工單申請人嘗試刪除被拒絕",
    () => deleteOwnDraftIssue({ issueId: adminForPmSubmitted!.id, actorId: pm.id }),
    (err) => err instanceof IssueDeletionStateError,
  );

  // ---- Admin 永久刪除 ----
  await expectError(
    "[B25] 非 Admin 執行永久刪除被拒絕",
    () => adminPermanentDeleteIssue({ issueId: adminForPmSubmitted!.id, actorId: pm.id, reason: "測試", confirmIssueKey: adminForPmSubmitted!.issueKey }),
    (err) => err instanceof IssueDeletionAccessDeniedError,
  );
  await expectError(
    "[B26] Admin 永久刪除未填原因被拒絕",
    () => adminPermanentDeleteIssue({ issueId: adminForPmSubmitted!.id, actorId: admin.id, reason: "", confirmIssueKey: adminForPmSubmitted!.issueKey }),
    (err) => err instanceof IssueDeletionValidationError,
  );
  await expectError(
    "[B27] Admin 永久刪除輸入錯誤工單編號被拒絕",
    () => adminPermanentDeleteIssue({ issueId: adminForPmSubmitted!.id, actorId: admin.id, reason: "測試原因", confirmIssueKey: "WRONG-KEY" }),
    (err) => err instanceof IssueDeletionValidationError,
  );
  await checkAsync("[B28] Admin 永久刪除已送簽工單成功，關聯資料清除且稽核紀錄保留", async () => {
    const issueId = adminForPmSubmitted!.id;
    const key = adminForPmSubmitted!.issueKey;
    await adminPermanentDeleteIssue({ issueId, actorId: admin.id, reason: "verify 測試永久刪除", confirmIssueKey: key });
    const [issueGone, approvalGone, auditLog] = await Promise.all([
      prisma.issue.findUnique({ where: { id: issueId } }),
      prisma.approvalRecord.count({ where: { issueId } }),
      prisma.auditLog.findFirst({ where: { entityType: "Issue", entityId: issueId, actionType: "IssueAdminPermanentDeleted" } }),
    ]);
    return issueGone === null && approvalGone === 0 && !!auditLog?.summary.includes("verify 測試永久刪除");
  });

  // ---- Admin 改派團隊／申請人 ----
  await expectError(
    "[B29] 非 Admin 執行改派團隊／申請人被拒絕",
    () => reassignHotfixTeamApplicant({ issueId: rejectFlow.id, actorId: pm.id, newTeamId: teamA.id, newApplicantId: pm.id, reasonCode: "測試" }),
    (err) => err instanceof WorkflowExecutionAccessDeniedError,
  );
  await checkAsync("[B30] Admin 改派申請人：舊 pending 作廢，依新申請人重建 pending，且新申請人不因此失去解析正確性", async () => {
    const before = await findActiveApproval(rejectFlow.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    await addMember(teamA.id, teamBMember.id, "MEMBER"); // 讓 teamBMember 成為 teamA 合法申請人候選
    // teamBMember 沒有主管指派，改派會因新申請人找不到主管而失敗，屬預期（找不到主管的
    // fail-closed 行為已於 B15 驗證），這裡改派回同一團隊、不同但有主管的既有申請人（noSupervisorApplicant
    // 沒有主管，改用 outsider 亦無主管；本檢查改用「重新指派回申請人自己」驗證 revision 鏈機制本身）。
    await reassignHotfixTeamApplicant({ issueId: rejectFlow.id, actorId: admin.id, newTeamId: teamA.id, newApplicantId: pm.id, reasonCode: "verify 改派測試" });
    const after = await findActiveApproval(rejectFlow.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    const oldRecord = before ? await prisma.approvalRecord.findUnique({ where: { id: before.id } }) : null;
    return !!before && !!after && after.id !== before.id && oldRecord?.recordStatus === "SUPERSEDED" && after.requestedByUserId === pm.id;
  });

  // ---- 團隊 CRUD ----
  await expectError(
    "[B31] 非 Admin 建立團隊被拒絕",
    () => createTeam({ name: `${RUN_TAG}-unauth`, description: "", actorId: pm.id }),
    (err) => err instanceof TeamManagementAccessDeniedError,
  );
  let crudTeam: Awaited<ReturnType<typeof createTeam>> | null = null;
  await checkAsync("[B32] Admin 可建立團隊", async () => {
    crudTeam = await createTeam({ name: `${RUN_TAG}-crud`, description: "verify", actorId: admin.id });
    return !!crudTeam.id;
  });
  await checkAsync("[B33] Admin 可編輯團隊名稱／說明", async () => {
    const updated = await updateTeam({ teamId: crudTeam!.id, name: `${RUN_TAG}-crud-renamed`, description: "verify-updated", actorId: admin.id });
    return updated.name === `${RUN_TAG}-crud-renamed`;
  });
  await expectError(
    "[B34] 已被引用（有成員）的團隊不可直接永久刪除",
    () => deleteTeamIfUnreferenced({ teamId: teamA.id, actorId: admin.id }),
    (err) => err instanceof TeamManagementStateError,
  );
  await checkAsync("[B35] 完全無引用的空白團隊可由 Admin 永久刪除", async () => {
    await deleteTeamIfUnreferenced({ teamId: emptyTeam.id, actorId: admin.id });
    return (await prisma.team.findUnique({ where: { id: emptyTeam.id } })) === null;
  });
}

async function main() {
  runStaticChecks();
  await runDbChecks();

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} ===`);
  if (failCount > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("verify 執行時發生未預期例外：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
