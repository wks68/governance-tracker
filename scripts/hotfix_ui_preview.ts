// Hotfix 九階段 UI Preview／Smoke 展示資料建置腳本（全面取代舊版 7 階段收斂版本）。
//
// 目的：涵蓋 9 個正式業務階段的等待狀態、主管駁回後退回案件、有／無附件案件、有風險案件，
// 並為每個角色（填單人／填單人主管／RD／RD 主管／QA／QA 主管／OP／OP 主管／Admin／
// 無關使用者）各建立一位可登入使用者。登入沿用既有 /login 頁面（列出所有已啟用使用者，
// 點擊即登入），不額外提供任何繞過授權的角色切換器。
//
// 一律透過真正的執行引擎／服務層（workflowExecutionService／approvalService／
// src/lib/hotfix-ui/* 服務層）推進案件，不直接寫 raw row（附件／風險檢核／執行欄位皆同）。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 使用方式：
//   npm run hotfix-ui:preview        # 重建 preview DB 並灌入展示資料
//   npm run dev:hotfix-ui-preview    # 啟動 dev server 指向該 DB，至 /login 選擇角色登入

import "./lib/assertSafeTestDatabase";

import { prisma } from "../src/lib/prisma";
import { decideApprovalRecord } from "../src/lib/approvalService";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import {
  startIssueWorkflow,
  executeIssueTransition,
  returnIssueToStage,
  cancelIssueWorkflow,
  submitStageRiskCheckAnswer,
  claimIssueForTeam,
  assignIssueExecutor,
} from "../src/lib/workflowExecutionService";
import { saveExecutionFieldValues } from "../src/lib/hotfix-ui/executionFields";
import { saveHotfixDraft } from "../src/lib/hotfix-ui/draftService";
import { saveClosureSummary } from "../src/lib/hotfix-ui/closureService";
import { uploadHotfixAttachment } from "../src/lib/hotfix-ui/attachmentService";
import { createIssueForActor } from "../src/lib/issueCreation";
import { setTeamDomain } from "../src/lib/team-applicant/teamManagementService";
import type { TeamDomain } from "../src/lib/constants";

const RUN_TAG = "hfui9";

async function createUser(name: string, role: string, department: string) {
  const user = await prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role, department, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}
async function createTeam(name: string) {
  return prisma.team.create({ data: { name } });
}
// RD/QA/OP 接單流程新增：建立團隊並明確設定領域分類（Team.domain），供 claimService 的
// 「合格接單團隊」判斷使用。domain 一律由這裡明確指定，不依團隊名稱猜測。
async function createTeamWithDomain(name: string, domain: TeamDomain, actorId: string) {
  const team = await createTeam(name);
  await setTeamDomain({ teamId: team.id, domain, actorId, reasonCode: "PREVIEW_CLASSIFY_TEAM" });
  return team;
}
async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD") {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
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
async function answerAllRiskChecks(issueId: string, stageKey: string, actorId: string, answer: "YES" | "NO" | "UNKNOWN") {
  const { getRiskCheckTemplate } = await import("../src/lib/riskCheckTemplates");
  const template = getRiskCheckTemplate(stageKey)!;
  for (const item of template) {
    await submitStageRiskCheckAnswer({ issueId, stageKey, checkKey: item.checkKey, answer, actorId });
  }
}

// 團隊整合修正：透過真正的 createIssueForActor（與正式建立工單頁同一條路徑）建立 Hotfix
// 草稿，用來展示「Admin 代團隊成員建立」與「申請人自己建立」兩種情境，並驗證團隊／申請人
// 伺服器端重新驗證邏輯在真實服務層可正常運作，不繞過驗證直接寫 raw row。
function buildCreateFormData(input: { title: string; description: string; teamId: string; applicantId: string; hotfixPriority?: string }): FormData {
  const fd = new FormData();
  fd.set("issueType", "Hotfix");
  fd.set("title", input.title);
  fd.set("description", input.description);
  fd.set("systemName", "MyDMS");
  fd.set("environment", "Production");
  fd.set("riskLevel", "中");
  fd.set("dueDate", "2026-08-20");
  fd.set("hotfixPriority", input.hotfixPriority ?? "HIGH");
  fd.set("teamId", input.teamId);
  fd.set("applicantId", input.applicantId);
  return fd;
}

interface Ctx {
  hotfix: Awaited<ReturnType<typeof buildHotfixWorkflowV1>>;
  admin: { id: string; name: string };
  pm: { id: string; name: string };
  supervisor: { id: string; name: string };
  rdTeam: { id: string; name: string };
  rdMember: { id: string; name: string };
  rdLead: { id: string; name: string };
  qaTeam: { id: string; name: string };
  qaMember: { id: string; name: string };
  qaLead: { id: string; name: string };
  opTeam: { id: string; name: string };
  opMember: { id: string; name: string };
  opLead: { id: string; name: string };
}

async function createHotfixIssue(key: string, title: string, description: string, ctx: Ctx, teamId?: string) {
  const issue = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-${key}`,
      issueType: "Hotfix",
      title,
      description,
      systemName: "MyDMS",
      environment: "Production",
      riskLevel: "中",
      workflowStatus: "n/a",
      reporterUserId: ctx.pm.id,
      reporter: ctx.pm.name,
      assignedTeamId: teamId ?? null,
    },
  });
  await startIssueWorkflow({ issueId: issue.id, workflowVersionId: ctx.hotfix.version.id, actorId: ctx.admin.id, reasonCode: "PREVIEW_START" });
  return issue;
}

// 依序推進到指定 step（每個 step 之後所處的關卡列於右側註解），與 hotfix_ui-verify.ts
// 的整合測試路徑一致，但這裡改用真正的九階段執行欄位鍵值。
function buildSteps(ctx: Ctx, issue: { id: string }) {
  const { hotfix, pm, supervisor, rdTeam, rdMember, rdLead, qaTeam, qaMember, qaLead, opTeam, opMember, opLead } = ctx;
  const s = hotfix.stageIds;
  return [
    async () => {
      // 0: draft -> pendingBusinessApproval
      await saveHotfixDraft({ issueId: issue.id, actorId: pm.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-08-15" } });
      const t = await findTransition(hotfix.version.id, s.draft, "submit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW_SUBMIT" });
    },
    async () => {
      // 1: pendingBusinessApproval -> pendingRdTriage
      const approval = await findActiveApproval(issue.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: supervisor.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingBusinessApproval, "businessApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 2: pendingRdTriage -> pendingRdClaim -> rdInProgress（RD Lead 接單＋指派執行人）
      await claimIssueForTeam({ issueId: issue.id, teamId: rdTeam.id, actorId: rdLead.id, reasonCode: "PREVIEW_RD_CLAIM" });
      await assignIssueExecutor({ issueId: issue.id, executorUserId: rdMember.id, actorId: rdLead.id, reasonCode: "PREVIEW_RD_ASSIGN" });
    },
    async () => {
      // 3: rdInProgress -> pendingRdLeadApproval
      await saveExecutionFieldValues({
        issueId: issue.id,
        actorId: rdMember.id,
        values: { rdFixVersion: "release/hotfix-v1.2.3", rdFixDescription: "修正登入頁驗證碼顯示異常，調整前端快取邏輯", rdSelfTestResult: "已於本機與 UAT 環境自測通過，驗證碼可正常顯示與刷新", rdImpactScope: "僅影響登入頁前端顯示，無資料庫變更，嚴重程度：低" },
      });
      await answerAllRiskChecks(issue.id, "pendingRdLeadApproval", rdMember.id, "NO");
      const t = await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: rdMember.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 4: pendingRdLeadApproval -> pendingQaTriage
      const approval = await findActiveApproval(issue.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: rdLead.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: rdLead.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 5: pendingQaTriage -> pendingQaClaim -> qaInProgress（QA Lead 接單＋指派執行人）
      await claimIssueForTeam({ issueId: issue.id, teamId: qaTeam.id, actorId: qaLead.id, reasonCode: "PREVIEW_QA_CLAIM" });
      await assignIssueExecutor({ issueId: issue.id, executorUserId: qaMember.id, actorId: qaLead.id, reasonCode: "PREVIEW_QA_ASSIGN" });
    },
    async () => {
      // 6: qaInProgress -> pendingQaLeadApproval
      await saveExecutionFieldValues({
        issueId: issue.id,
        actorId: qaMember.id,
        values: { qaTestScope: "登入頁全功能迴歸測試", qaTestEnvironment: "UAT", qaTestResult: "驗證通過", qaDefectNotes: "無", qaRecommendation: "可上版" },
      });
      await answerAllRiskChecks(issue.id, "pendingQaLeadApproval", qaMember.id, "NO");
      const t = await findTransition(hotfix.version.id, s.qaInProgress, "qaSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: qaMember.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 7: pendingQaLeadApproval -> pendingOpTriage
      const approval = await findActiveApproval(issue.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: qaLead.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingQaLeadApproval, "qaLeadApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: qaLead.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 8: pendingOpTriage -> pendingOpClaim -> opPreparing（OP Lead 接單＋指派執行人）
      await claimIssueForTeam({ issueId: issue.id, teamId: opTeam.id, actorId: opLead.id, reasonCode: "PREVIEW_OP_CLAIM" });
      await assignIssueExecutor({ issueId: issue.id, executorUserId: opMember.id, actorId: opLead.id, reasonCode: "PREVIEW_OP_ASSIGN" });
    },
    async () => {
      // 9: opPreparing -> pendingDeploymentApproval（既有 WorkflowStageRequirement 要求此關卡
      // 至少一筆佐證資料／附件，這裡以真正的附件上傳滿足，不直接寫 raw Evidence row）
      await saveExecutionFieldValues({
        issueId: issue.id,
        actorId: opMember.id,
        values: {
          opDeployEnvironment: "Production",
          opDeployPlannedAt: "2026-08-05T02:00",
          opDeploySteps: "1. 通知相關單位停機 2. 部署新版程式 3. 執行驗證腳本 4. 恢復對外服務",
          opRollbackPlan: "若驗證失敗，5 分鐘內還原前一版本並重啟服務",
          opMonitoringChecklist: "監控錯誤率、回應時間、登入成功率 30 分鐘",
        },
      });
      await answerAllRiskChecks(issue.id, "pendingDeploymentApproval", opMember.id, "NO");
      await uploadHotfixAttachment({ issueId: issue.id, actorId: opMember.id, actorName: opMember.name, fileName: "pre-deploy-checklist.txt", mimeType: "text/plain", bytes: Buffer.from("部署前檢查清單：備份完成、回復方案確認、監控告警已設定。") });
      const t = await findTransition(hotfix.version.id, s.opPreparing, "opSubmit");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: opMember.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 10: pendingDeploymentApproval -> opDeploying
      const approval = await findActiveApproval(issue.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
      await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: opLead.id, decision: "APPROVED" });
      const t = await findTransition(hotfix.version.id, s.pendingDeploymentApproval, "opLeadApprove");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: opLead.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 11: opDeploying -> opCompleted
      await saveExecutionFieldValues({ issueId: issue.id, actorId: opMember.id, values: { opDeployResult: "成功", opProdConfirmResult: "確認無誤" } });
      const t = await findTransition(hotfix.version.id, s.opDeploying, "opDeployComplete");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: opMember.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 12: opCompleted -> pendingReporterConfirmation
      const t = await findTransition(hotfix.version.id, s.opCompleted, "reporterConfirmOpen");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 13: pendingReporterConfirmation -> reporterConfirming
      const t = await findTransition(hotfix.version.id, s.pendingReporterConfirmation, "reporterClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
    async () => {
      // 14: reporterConfirming -> closed
      await saveClosureSummary({ issueId: issue.id, actorId: pm.id, summary: "已確認正式環境功能正常，問題已解決。", followUpNotes: "持續觀察 3 天，無異常即結案歸檔。" });
      const t = await findTransition(hotfix.version.id, s.reporterConfirming, "reporterClose");
      await executeIssueTransition({ issueId: issue.id, transitionId: t.id, actorId: pm.id, reasonCode: "PREVIEW" });
    },
  ];
}

async function advanceTo(ctx: Ctx, issue: { id: string }, targetStepIndex: number) {
  const steps = buildSteps(ctx, issue);
  for (let i = 0; i <= targetStepIndex; i++) {
    await steps[i]();
  }
}

async function main() {
  console.log("=== 建立 Hotfix 九階段 UI Preview／Smoke 展示資料 ===");

  console.log("[1/3] 建立角色帳號、團隊，並發布 Hotfix v1 流程...");
  const admin = await createUser("Admin", "Admin", "資訊處");
  const pm = await createUser("填單人", "PM", "業務處");
  const supervisor = await createUser("填單人主管", "DMS主管", "業務處");
  await prisma.userSupervisorAssignment.create({
    data: { userId: pm.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });

  const rdTeam = await createTeamWithDomain("RD 維運團隊", "RD", admin.id);
  const rdMember = await createUser("RD執行人", "RD", "研發處");
  const rdLead = await createUser("RD主管", "RD", "研發處");
  await addMember(rdTeam.id, rdMember.id, "MEMBER");
  await addMember(rdTeam.id, rdLead.id, "LEAD");
  const rdInactive = await createUser("RD離職人員", "RD", "研發處");
  await prisma.teamMember.create({ data: { teamId: rdTeam.id, userId: rdInactive.id, membershipRole: "MEMBER", isActive: false } });

  const qaTeam = await createTeamWithDomain("QA 驗證團隊", "QA", admin.id);
  const qaMember = await createUser("QA執行人", "QA", "品保處");
  const qaLead = await createUser("QA主管", "QA", "品保處");
  await addMember(qaTeam.id, qaMember.id, "MEMBER");
  await addMember(qaTeam.id, qaLead.id, "LEAD");
  const qaInactive = await createUser("QA離職人員", "QA", "品保處");
  await prisma.teamMember.create({ data: { teamId: qaTeam.id, userId: qaInactive.id, membershipRole: "MEMBER", isActive: false } });

  const opTeam = await createTeamWithDomain("OP 部署團隊", "OP", admin.id);
  const opMember = await createUser("OP執行人", "OP", "維運處");
  const opLead = await createUser("OP主管", "OP", "維運處");
  await addMember(opTeam.id, opMember.id, "MEMBER");
  await addMember(opTeam.id, opLead.id, "LEAD");
  const opInactive = await createUser("OP離職人員", "OP", "維運處");
  await prisma.teamMember.create({ data: { teamId: opTeam.id, userId: opInactive.id, membershipRole: "MEMBER", isActive: false } });

  // PM 團隊：申請人（填單人）與其主管所屬團隊，供「建立工單」頁團隊/申請人連動示範使用。
  const pmTeam = await createTeamWithDomain("PM 團隊", "BUSINESS", admin.id);
  await addMember(pmTeam.id, pm.id, "MEMBER");
  await addMember(pmTeam.id, supervisor.id, "LEAD");
  const pmInactive = await createUser("PM離職人員", "PM", "業務處");
  await prisma.teamMember.create({ data: { teamId: pmTeam.id, userId: pmInactive.id, membershipRole: "MEMBER", isActive: false } });

  // 無主管設定示範帳號：屬 PM 團隊 active 成員，但刻意不建立 UserSupervisorAssignment，
  // 用來示範「所選申請人尚未設定直屬主管...」友善失敗訊息。
  const noSupervisorUser = await createUser("無主管設定人員", "PM", "業務處");
  await addMember(pmTeam.id, noSupervisorUser.id, "MEMBER");

  // 空白（無任何引用）團隊：示範 Admin 永久刪除團隊。
  const emptyTeam = await createTeam("測試用空團隊（可永久刪除）");

  const outsider = await createUser("無關使用者", "PM", "其他處");

  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "PREVIEW_BUILD_HOTFIX_V1", keySuffix: RUN_TAG });
  const ctx: Ctx = { hotfix, admin, pm, supervisor, rdTeam, rdMember, rdLead, qaTeam, qaMember, qaLead, opTeam, opMember, opLead };

  console.log("[2/3] 建立展示用 Hotfix 案件（涵蓋 9 階段等待狀態＋退回／附件／風險情境）...");

  const stage1 = await createHotfixIssue("STAGE1-CREATE", "登入頁驗證碼顯示異常", "使用者反映登入頁驗證碼圖片有時無法正確顯示，需重新整理多次才會出現。", ctx);
  // 停在 draft（尚未送出）

  const stage2 = await createHotfixIssue("STAGE2-REQ-APPROVAL", "付款金額計算錯誤", "特定折扣券組合下，結帳金額計算結果與預期不符，多收取約 5 元。", ctx);
  await advanceTo(ctx, stage2, 0); // 待申請人直屬主管簽核

  const stage3 = await createHotfixIssue("STAGE3-RD-FIX", "報表匯出格式錯誤", "月結報表匯出 Excel 時，部分欄位格式跑版，數字被誤判為文字。", ctx);
  await advanceTo(ctx, stage3, 2); // RD修正與自測

  const stage4 = await createHotfixIssue("STAGE4-RD-APPROVAL", "會員點數異動未同步", "會員點數在異動後，前台顯示與後台資料不一致，需等待數分鐘才同步。", ctx);
  await advanceTo(ctx, stage4, 3); // 待 RD 主管簽核

  const stage5 = await createHotfixIssue("STAGE5-QA-VERIFY", "推播通知延遲逾時", "行銷推播通知偶發延遲超過 10 分鐘才送達，影響活動時效性。", ctx);
  await advanceTo(ctx, stage5, 5); // QA驗證

  const stage6 = await createHotfixIssue("STAGE6-QA-APPROVAL", "客服工單自動轉派失敗", "客服工單於特定條件下無法自動轉派至對應處理小組，需人工介入。", ctx);
  await advanceTo(ctx, stage6, 6); // 待 QA 主管簽核

  const stage7 = await createHotfixIssue("STAGE7-OP-DEPLOY", "庫存扣減出現負值", "高併發下單情境下，庫存扣減偶發出現負值，需緊急修正並上版。", ctx);
  await advanceTo(ctx, stage7, 8); // OP上版

  const stage8 = await createHotfixIssue("STAGE8-OP-APPROVAL", "客戶資料匯出權限異常", "部分無權限帳號可匯出客戶資料清單，屬安全性緊急修正案件。", ctx);
  await advanceTo(ctx, stage8, 9); // 待 OP 主管簽核

  const stage9 = await createHotfixIssue("STAGE9-CLOSE", "第三方金流介接逾時", "第三方金流回調偶發逾時，導致訂單狀態未即時更新，需觀察後結案。", ctx);
  await advanceTo(ctx, stage9, 12); // 待填單人確認結案

  const closedCase = await createHotfixIssue("CLOSED", "首頁圖片載入逾時", "首頁輪播圖片載入時間偏長，影響首屏體驗，已修正並完成結案。", ctx);
  await advanceTo(ctx, closedCase, 14); // 已結案（唯讀）

  const cancelledCase = await createHotfixIssue("CANCELLED", "誤植的緊急需求", "此需求為誤植，確認不需處理。", ctx);
  {
    const cancelT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "cancelDraft");
    await cancelIssueWorkflow({ issueId: cancelledCase.id, transitionId: cancelT.id, actorId: admin.id, reasonCode: "PREVIEW_CANCEL" });
  }

  const returnedCase = await createHotfixIssue("RETURNED", "訂單編號重複產生", "極少數情況下訂單編號重複產生，需 RD 重新檢查序號產生邏輯。", ctx);
  await advanceTo(ctx, returnedCase, 3); // 先到待 RD 主管簽核
  {
    const approval = await findActiveApproval(returnedCase.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: rdLead.id, decision: "REJECTED", decisionComment: "請補充序號產生邏輯的完整自測紀錄與影響範圍說明" });
    const rejectT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingRdLeadApproval, "rdLeadReject");
    await returnIssueToStage({ issueId: returnedCase.id, transitionId: rejectT.id, actorId: rdLead.id, reasonCode: "請補充序號產生邏輯的完整自測紀錄與影響範圍說明" });
  }
  // 結束時停在 rdInProgress，歷程上有一筆主管駁回紀錄——「主管駁回後退回案件」展示案例。

  const withAttachment = await createHotfixIssue("WITH-ATTACHMENT", "系統通知信件亂碼", "部分系統通知信件內容出現亂碼，懷疑編碼設定錯誤。", ctx);
  await advanceTo(ctx, withAttachment, 2); // RD修正與自測
  await uploadHotfixAttachment({
    issueId: withAttachment.id,
    actorId: rdMember.id,
    actorName: rdMember.name,
    fileName: "encoding-fix-note.txt",
    mimeType: "text/plain",
    bytes: Buffer.from("修正說明：將 SMTP 寄信編碼由 Big5 統一改為 UTF-8，並補上 Content-Type 標頭。"),
  });
  // 「有附件案件」展示案例（同時 stage3 也是「無附件」案例的自然對照，因為多數案例本就未上傳附件）。

  const riskCase = await createHotfixIssue("RISK-YES", "客戶個資查詢介面異常", "客戶個資查詢介面在特定條件下可能回傳非本人資料，屬高風險案件。", ctx);
  await advanceTo(ctx, riskCase, 2); // RD修正與自測
  await saveExecutionFieldValues({
    issueId: riskCase.id,
    actorId: rdMember.id,
    values: { rdFixVersion: "hotfix/customer-data-leak-v1", rdFixDescription: "修正查詢條件組裝邏輯，避免跨客戶資料外洩", rdSelfTestResult: "已自測多組客戶帳號交叉驗證，確認僅回傳本人資料", rdImpactScope: "涉及客戶個資查詢模組，嚴重程度：高" },
  });
  {
    const { getRiskCheckTemplate } = await import("../src/lib/riskCheckTemplates");
    const template = getRiskCheckTemplate("pendingRdLeadApproval")!;
    for (const item of template) {
      const answer = item.checkKey === "involvesSensitiveOrPersonalData" ? "YES" : "NO";
      await submitStageRiskCheckAnswer({ issueId: riskCase.id, stageKey: "pendingRdLeadApproval", checkKey: item.checkKey, answer, detail: answer === "YES" ? "涉及客戶個資查詢，需資安複核後才可送核" : undefined, actorId: rdMember.id });
    }
  }
  // 停在 rdInProgress，尚未送出，風險確認已填答且其中一項為「是（有風險）」——「有風險案件」展示案例。

  console.log("[2b/3] 建立團隊／申請人整合示範案件（真實 createIssueForActor 路徑）...");

  // 情境 1：Admin 代 PM 團隊成員（填單人）建立的草稿——applicant／actor 分別保存的示範案例。
  const adminCreatedDraft = await createIssueForActor(
    admin,
    buildCreateFormData({ title: "[Hotfix][MyDMS][Admin代建] 訂閱通知重複發送", description: "Admin 代填單人建立，示範 applicant 與實際建立者分開保存。", teamId: pmTeam.id, applicantId: pm.id }),
  );

  // 情境 2：申請人自己建立的草稿。
  const selfCreatedDraft = await createIssueForActor(
    pm,
    buildCreateFormData({ title: "[Hotfix][MyDMS][自建] 訂單匯出檔名亂碼", description: "申請人本人登入並自行建立。", teamId: pmTeam.id, applicantId: pm.id }),
  );

  // 情境 3：被申請人主管駁回、退回第 1 關的工單——申請人可修改後重新送簽，暫存不會產生第二筆
  // active pending ApprovalRecord。
  const rejectedToStage1 = await createIssueForActor(
    pm,
    buildCreateFormData({ title: "[Hotfix][MyDMS][待補件] 匯款帳號驗證失敗", description: "初次送簽資訊不足，將由主管駁回退回第 1 關。", teamId: pmTeam.id, applicantId: pm.id }),
  );
  {
    await saveHotfixDraft({ issueId: rejectedToStage1.id, actorId: pm.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-08-18" } });
    const submitT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
    await executeIssueTransition({ issueId: rejectedToStage1.id, transitionId: submitT.id, actorId: pm.id, reasonCode: "PREVIEW_SUBMIT" });
    const approval = await findActiveApproval(rejectedToStage1.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    await decideApprovalRecord({ approvalRecordId: approval.id, actorUserId: supervisor.id, decision: "REJECTED", decisionComment: "請補充問題重現步驟與影響範圍" });
    const rejectT = await findTransition(hotfix.version.id, hotfix.stageIds.pendingBusinessApproval, "businessReject");
    await returnIssueToStage({ issueId: rejectedToStage1.id, transitionId: rejectT.id, actorId: supervisor.id, reasonCode: "請補充問題重現步驟與影響範圍" });
  }
  // 結束時回到 draft，歷程上有一筆申請人主管駁回紀錄——「被駁回後回第 1 關」展示案例，申請人
  // 可於此重新暫存／送簽，也符合申請人可刪除的條件。

  // 情境 4：有附件的草稿（尚未送出）。
  const draftWithAttachment = await createIssueForActor(
    pm,
    buildCreateFormData({ title: "[Hotfix][MyDMS][有附件草稿] 對帳單合計金額誤差", description: "草稿階段已上傳佐證附件，尚未送出。", teamId: pmTeam.id, applicantId: pm.id }),
  );
  await uploadHotfixAttachment({
    issueId: draftWithAttachment.id,
    actorId: pm.id,
    actorName: pm.name,
    fileName: "reconciliation-screenshot-note.txt",
    mimeType: "text/plain",
    bytes: Buffer.from("附件說明：對帳單合計金額誤差案例的截圖描述與初步排查紀錄。"),
  });

  // 情境 5：申請人尚未設定直屬主管，送簽會顯示友善失敗訊息（不暴露 ApprovalRecord／Prisma 技術訊息）。
  const noSupervisorDraft = await createIssueForActor(
    noSupervisorUser,
    buildCreateFormData({ title: "[Hotfix][MyDMS][無主管示範] 定期報表寄送失敗", description: "示範申請人尚未設定直屬主管時，送簽的友善失敗訊息。", teamId: pmTeam.id, applicantId: noSupervisorUser.id }),
  );

  console.log("[3/4] 建立 RD／QA／OP 接單／指派示範情境（新版 claimService／assignmentService，見 claim-actions.ts）...");

  // ---- RD 領域：IAD／AAD 兩個可競爭接單的 RD 團隊 ----
  const iadTeam = await createTeamWithDomain("IAD", "RD", admin.id);
  const iadLead = await createUser("IAD主管", "RD", "研發處");
  const iadMemberA = await createUser("IAD工程師A", "RD", "研發處");
  const iadMemberB = await createUser("IAD工程師B", "RD", "研發處");
  await addMember(iadTeam.id, iadLead.id, "LEAD");
  await addMember(iadTeam.id, iadMemberA.id, "MEMBER");
  await addMember(iadTeam.id, iadMemberB.id, "MEMBER");

  const aadTeam = await createTeamWithDomain("AAD", "RD", admin.id);
  const aadLead = await createUser("AAD主管", "RD", "研發處");
  const aadMemberA = await createUser("AAD工程師A", "RD", "研發處");
  const aadMemberB = await createUser("AAD工程師B", "RD", "研發處");
  await addMember(aadTeam.id, aadLead.id, "LEAD");
  await addMember(aadTeam.id, aadMemberA.id, "MEMBER");
  await addMember(aadTeam.id, aadMemberB.id, "MEMBER");
  // HOTFIX-0033 根因修正：AAD 原本只作為「接單／指派」示範團隊使用，其成員從未被當作
  // createIssueForActor 的申請人，因此從未建立 UserSupervisorAssignment。但「團隊」下拉選單
  // 對任一 active 成員一視同仁（見 teamApplicantService.ts），使用者以 AAD工程師A 建立並送出
  // Hotfix 是完全合法的路徑，卻因缺少直屬主管指派導致 BUSINESS_APPROVAL 資格解析為空、
  // fail closed。此處補上 AAD工程師A 的正式直屬主管指派（AAD主管，與其團隊 LEAD 身分一致，
  // 全 DB 中唯一一筆，不產生第二位候選人），使該示範路徑可正常送到第 2 關。
  await prisma.userSupervisorAssignment.create({
    data: {
      userId: aadMemberA.id,
      supervisorUserId: aadLead.id,
      validFrom: new Date(Date.now() - 86_400_000),
      isPrimary: true,
      isActive: true,
      createdByUserId: admin.id,
    },
  });

  // HOTFIX-0033 重建示範案例：團隊 AAD、申請人 AAD工程師A，走真正的 createIssueForActor +
  // submit transition 路徑送出，停在 pendingBusinessApproval（不預先決策），供 AAD主管登入
  // 驗證第 2 關「同意／駁回」畫面。
  const aadSupervisorDemo = await createIssueForActor(
    aadMemberA,
    buildCreateFormData({ title: "[Hotfix][MyDMS][AAD示範] Hotfix試開單", description: "示範 AAD 團隊申請人送簽至 AAD主管，驗證直屬主管解析。", teamId: aadTeam.id, applicantId: aadMemberA.id }),
  );
  await saveHotfixDraft({ issueId: aadSupervisorDemo.id, actorId: aadMemberA.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-08-20" } });
  {
    const submitT = await findTransition(hotfix.version.id, hotfix.stageIds.draft, "submit");
    await executeIssueTransition({ issueId: aadSupervisorDemo.id, transitionId: submitT.id, actorId: aadMemberA.id, reasonCode: "PREVIEW_SUBMIT" });
  }

  // 一張等待 RD 團隊接單工單（IAD、AAD 皆可見「待接單」，皆可按下接單）。
  const rdClaimPending = await createHotfixIssue("RD-CLAIM-PENDING", "會員等級升級通知未發送", "會員消費達等級門檻後，升級通知信件未如預期發送。", ctx);
  await advanceTo(ctx, rdClaimPending, 1); // pendingBusinessApproval -> pendingRdTriage

  // 一張已由 IAD 承接、AAD 只能看到承接狀態的工單。
  const rdClaimedByIad = await createHotfixIssue("RD-CLAIMED-BY-IAD", "商品搜尋權重排序異常", "商品搜尋結果排序權重計算錯誤，熱門商品未優先顯示。", ctx);
  await advanceTo(ctx, rdClaimedByIad, 1);
  await claimIssueForTeam({ issueId: rdClaimedByIad.id, teamId: iadTeam.id, actorId: iadLead.id, reasonCode: "PREVIEW_IAD_CLAIM" });

  // 一張 IAD 已接單、待指派工單。
  const rdPendingAssign = await createHotfixIssue("RD-PENDING-ASSIGN", "優惠券核銷次數未歸零", "跨月後優惠券核銷次數未依規則歸零，導致部分使用者無法再次使用。", ctx);
  await advanceTo(ctx, rdPendingAssign, 1);
  await claimIssueForTeam({ issueId: rdPendingAssign.id, teamId: iadTeam.id, actorId: iadLead.id, reasonCode: "PREVIEW_IAD_CLAIM" });

  // 一張 IAD 成員處理中工單（IAD 主管已指派 IAD工程師A）。
  const rdInProgressIad = await createHotfixIssue("RD-IN-PROGRESS-IAD", "運費試算未計入偏遠地區加成", "特定偏遠地區訂單運費試算未加計偏遠加成費用。", ctx);
  await advanceTo(ctx, rdInProgressIad, 1);
  await claimIssueForTeam({ issueId: rdInProgressIad.id, teamId: iadTeam.id, actorId: iadLead.id, reasonCode: "PREVIEW_IAD_CLAIM" });
  await assignIssueExecutor({ issueId: rdInProgressIad.id, executorUserId: iadMemberA.id, actorId: iadLead.id, reasonCode: "PREVIEW_IAD_ASSIGN" });

  // 一張待 IAD 主管核准工單。
  const rdPendingLeadApproval = await createHotfixIssue("RD-PENDING-LEAD-APPROVAL", "訂單匯出報表缺漏欄位", "訂單匯出 CSV 報表偶發缺漏付款方式欄位。", ctx);
  await advanceTo(ctx, rdPendingLeadApproval, 1);
  await claimIssueForTeam({ issueId: rdPendingLeadApproval.id, teamId: iadTeam.id, actorId: iadLead.id, reasonCode: "PREVIEW_IAD_CLAIM" });
  await assignIssueExecutor({ issueId: rdPendingLeadApproval.id, executorUserId: iadMemberA.id, actorId: iadLead.id, reasonCode: "PREVIEW_IAD_ASSIGN" });
  await saveExecutionFieldValues({
    issueId: rdPendingLeadApproval.id,
    actorId: iadMemberA.id,
    values: { rdFixVersion: "release/iad-hotfix-1", rdFixDescription: "修正 CSV 欄位組裝順序", rdSelfTestResult: "已自測匯出 100 筆訂單皆完整", rdImpactScope: "僅影響匯出報表功能，嚴重程度：低" },
  });
  await answerAllRiskChecks(rdPendingLeadApproval.id, "pendingRdLeadApproval", iadMemberA.id, "NO");
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.rdInProgress, "rdSubmit");
    await executeIssueTransition({ issueId: rdPendingLeadApproval.id, transitionId: t.id, actorId: iadMemberA.id, reasonCode: "PREVIEW" });
  }

  // ---- QA 領域：兩個可競爭接單的 QA 團隊 ----
  const qaTeam1 = await createTeamWithDomain("QA第一驗證組", "QA", admin.id);
  const qaTeam1Lead = await createUser("QA第一組主管", "QA", "品保處");
  const qaTeam1MemberA = await createUser("QA第一組成員A", "QA", "品保處");
  const qaTeam1MemberB = await createUser("QA第一組成員B", "QA", "品保處");
  await addMember(qaTeam1.id, qaTeam1Lead.id, "LEAD");
  await addMember(qaTeam1.id, qaTeam1MemberA.id, "MEMBER");
  await addMember(qaTeam1.id, qaTeam1MemberB.id, "MEMBER");

  const qaTeam2 = await createTeamWithDomain("QA第二驗證組", "QA", admin.id);
  const qaTeam2Lead = await createUser("QA第二組主管", "QA", "品保處");
  await addMember(qaTeam2.id, qaTeam2Lead.id, "LEAD");
  await addMember(qaTeam2.id, (await createUser("QA第二組成員A", "QA", "品保處")).id, "MEMBER");

  async function advanceToQaTriage(issue: { id: string }) {
    await advanceTo(ctx, issue, 4); // ... -> pendingRdLeadApproval 已核准（用既有 rdTeam/rdLead/rdMember）-> pendingQaTriage
  }

  const qaClaimPending = await createHotfixIssue("QA-CLAIM-PENDING", "會員生日禮券未自動發放", "會員生日當月禮券未依規則自動發放。", ctx);
  await advanceToQaTriage(qaClaimPending); // 停在 pendingQaTriage（兩個 QA 團隊皆可見待接單）

  const qaPendingAssign = await createHotfixIssue("QA-PENDING-ASSIGN", "客服評分表單送出失敗", "客服結束對話後評分表單偶發送出失敗。", ctx);
  await advanceToQaTriage(qaPendingAssign);
  await claimIssueForTeam({ issueId: qaPendingAssign.id, teamId: qaTeam1.id, actorId: qaTeam1Lead.id, reasonCode: "PREVIEW_QA1_CLAIM" });

  const qaInProgressCase = await createHotfixIssue("QA-IN-PROGRESS", "活動頁面倒數計時器顯示錯誤", "活動頁面倒數計時器在跨時區情境下顯示錯誤時間。", ctx);
  await advanceToQaTriage(qaInProgressCase);
  await claimIssueForTeam({ issueId: qaInProgressCase.id, teamId: qaTeam1.id, actorId: qaTeam1Lead.id, reasonCode: "PREVIEW_QA1_CLAIM" });
  await assignIssueExecutor({ issueId: qaInProgressCase.id, executorUserId: qaTeam1MemberA.id, actorId: qaTeam1Lead.id, reasonCode: "PREVIEW_QA1_ASSIGN" });

  const qaPendingLeadApproval = await createHotfixIssue("QA-PENDING-LEAD-APPROVAL", "會員條款彈窗重複顯示", "已同意會員條款的使用者仍偶發看到條款彈窗。", ctx);
  await advanceToQaTriage(qaPendingLeadApproval);
  await claimIssueForTeam({ issueId: qaPendingLeadApproval.id, teamId: qaTeam1.id, actorId: qaTeam1Lead.id, reasonCode: "PREVIEW_QA1_CLAIM" });
  await assignIssueExecutor({ issueId: qaPendingLeadApproval.id, executorUserId: qaTeam1MemberA.id, actorId: qaTeam1Lead.id, reasonCode: "PREVIEW_QA1_ASSIGN" });
  await saveExecutionFieldValues({
    issueId: qaPendingLeadApproval.id,
    actorId: qaTeam1MemberA.id,
    values: { qaTestScope: "會員條款彈窗迴歸測試", qaTestEnvironment: "UAT", qaTestResult: "驗證通過", qaDefectNotes: "無", qaRecommendation: "可上版" },
  });
  await answerAllRiskChecks(qaPendingLeadApproval.id, "pendingQaLeadApproval", qaTeam1MemberA.id, "NO");
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.qaInProgress, "qaSubmit");
    await executeIssueTransition({ issueId: qaPendingLeadApproval.id, transitionId: t.id, actorId: qaTeam1MemberA.id, reasonCode: "PREVIEW" });
  }

  // ---- OP 領域：兩個可競爭接單的 OP 團隊 ----
  const opTeam1 = await createTeamWithDomain("OP第一上版組", "OP", admin.id);
  const opTeam1Lead = await createUser("OP第一組主管", "OP", "維運處");
  const opTeam1MemberA = await createUser("OP第一組成員A", "OP", "維運處");
  await addMember(opTeam1.id, opTeam1Lead.id, "LEAD");
  await addMember(opTeam1.id, opTeam1MemberA.id, "MEMBER");

  const opTeam2 = await createTeamWithDomain("OP第二上版組", "OP", admin.id);
  const opTeam2Lead = await createUser("OP第二組主管", "OP", "維運處");
  await addMember(opTeam2.id, opTeam2Lead.id, "LEAD");
  await addMember(opTeam2.id, (await createUser("OP第二組成員A", "OP", "維運處")).id, "MEMBER");

  async function advanceToOpTriage(issue: { id: string }) {
    await advanceTo(ctx, issue, 7); // ... -> pendingQaLeadApproval 已核准（用既有 qaTeam/qaLead/qaMember）-> pendingOpTriage
  }

  const opClaimPending = await createHotfixIssue("OP-CLAIM-PENDING", "夜間批次任務執行時間過長", "夜間批次任務執行時間偶發超過維護窗口。", ctx);
  await advanceToOpTriage(opClaimPending); // 停在 pendingOpTriage（兩個 OP 團隊皆可見待接單）

  const opPendingAssign = await createHotfixIssue("OP-PENDING-ASSIGN", "備援機房切換演練異常", "備援機房切換演練時偶發連線逾時。", ctx);
  await advanceToOpTriage(opPendingAssign);
  await claimIssueForTeam({ issueId: opPendingAssign.id, teamId: opTeam1.id, actorId: opTeam1Lead.id, reasonCode: "PREVIEW_OP1_CLAIM" });

  const opInProgressCase = await createHotfixIssue("OP-IN-PROGRESS", "CDN 快取未依規則清除", "上版後 CDN 快取未依規則清除，使用者仍看到舊版本內容。", ctx);
  await advanceToOpTriage(opInProgressCase);
  await claimIssueForTeam({ issueId: opInProgressCase.id, teamId: opTeam1.id, actorId: opTeam1Lead.id, reasonCode: "PREVIEW_OP1_CLAIM" });
  await assignIssueExecutor({ issueId: opInProgressCase.id, executorUserId: opTeam1MemberA.id, actorId: opTeam1Lead.id, reasonCode: "PREVIEW_OP1_ASSIGN" });

  const opPendingLeadApproval = await createHotfixIssue("OP-PENDING-LEAD-APPROVAL", "上版排程通知信未寄送", "上版排程通知信偶發未寄送給相關關係人。", ctx);
  await advanceToOpTriage(opPendingLeadApproval);
  await claimIssueForTeam({ issueId: opPendingLeadApproval.id, teamId: opTeam1.id, actorId: opTeam1Lead.id, reasonCode: "PREVIEW_OP1_CLAIM" });
  await assignIssueExecutor({ issueId: opPendingLeadApproval.id, executorUserId: opTeam1MemberA.id, actorId: opTeam1Lead.id, reasonCode: "PREVIEW_OP1_ASSIGN" });
  await saveExecutionFieldValues({
    issueId: opPendingLeadApproval.id,
    actorId: opTeam1MemberA.id,
    values: {
      opDeployEnvironment: "Production",
      opDeployPlannedAt: "2026-08-10T02:00",
      opDeploySteps: "1. 停用排程通知 2. 部署修正 3. 手動觸發一次測試通知 4. 恢復排程",
      opRollbackPlan: "還原排程設定並重新啟用舊版通知邏輯",
      opMonitoringChecklist: "監控排程通知寄送成功率 24 小時",
    },
  });
  await answerAllRiskChecks(opPendingLeadApproval.id, "pendingDeploymentApproval", opTeam1MemberA.id, "NO");
  await uploadHotfixAttachment({ issueId: opPendingLeadApproval.id, actorId: opTeam1MemberA.id, actorName: opTeam1MemberA.name, fileName: "op-precheck.txt", mimeType: "text/plain", bytes: Buffer.from("上版前檢查：排程通知設定已備份。") });
  {
    const t = await findTransition(hotfix.version.id, hotfix.stageIds.opPreparing, "opSubmit");
    await executeIssueTransition({ issueId: opPendingLeadApproval.id, transitionId: t.id, actorId: opTeam1MemberA.id, reasonCode: "PREVIEW" });
  }

  // ---- 結案：一張待原申請人確認結案工單（沿用既有 stage9 情境即可，見上方 stage9） ----

  console.log("[4/4] 完成。");
  console.log("\n=== 各階段展示工單編號 ===");
  console.log(`  1 Hotfix建立工單（草稿，尚未送出）：${stage1.issueKey}`);
  console.log(`  2 申請人直屬主管簽核：${stage2.issueKey}`);
  console.log(`  3 RD修正與自測：${stage3.issueKey}`);
  console.log(`  4 RD主管簽核：${stage4.issueKey}`);
  console.log(`  5 QA驗證：${stage5.issueKey}`);
  console.log(`  6 QA主管簽核：${stage6.issueKey}`);
  console.log(`  7 OP上版：${stage7.issueKey}`);
  console.log(`  8 OP主管簽核：${stage8.issueKey}`);
  console.log(`  9 結案（待填單人確認）：${stage9.issueKey}`);
  console.log(`  已結案（唯讀）：${closedCase.issueKey}`);
  console.log(`  已取消：${cancelledCase.issueKey}`);
  console.log(`  主管駁回後退回案件（現停 RD修正與自測）：${returnedCase.issueKey}`);
  console.log(`  有附件案件（現停 RD修正與自測）：${withAttachment.issueKey}`);
  console.log(`  無附件案件（例如）：${stage3.issueKey}`);
  console.log(`  有風險案件（現停 RD修正與自測，待送出）：${riskCase.issueKey}`);
  console.log("\n=== 團隊／申請人整合示範案件（真實 createIssueForActor 路徑）===");
  console.log(`  Admin 代團隊成員建立的草稿：${adminCreatedDraft.issueKey}`);
  console.log(`  申請人自己建立的草稿：${selfCreatedDraft.issueKey}`);
  console.log(`  被駁回後回第 1 關（可刪除）：${rejectedToStage1.issueKey}`);
  console.log(`  有附件草稿：${draftWithAttachment.issueKey}`);
  console.log(`  無主管設定（送簽會友善失敗）：${noSupervisorDraft.issueKey}（請以「無主管設定人員」登入後於 Hotfix 建立工單頁按下「建立工單」）`);
  console.log(`  AAD 團隊申請人送簽示範（HOTFIX-0033 根因修正驗證）：${aadSupervisorDemo.issueKey}，已停在第 2 關「申請人直屬主管簽核」，請以「${aadLead.name}」登入查看 /issues/${aadSupervisorDemo.id}/hotfix/approval/requester`);
  console.log("\n=== 團隊（PM／RD／QA／OP 各團隊皆有 2 位 active 成員＋1 位已停用成員；「無關使用者」不屬於任何團隊）===");
  console.log(`  ${pmTeam.name}／${rdTeam.name}／${qaTeam.name}／${opTeam.name}`);
  console.log(`  ${emptyTeam.name}：空白無引用，可示範 Admin 永久刪除團隊（無法示範「停用團隊」——目前資料模型 Team 無 isActive 欄位，詳見最終報告）`);
  console.log("\n=== 可登入角色帳號（於 /login 頁面點選登入，無繞過授權的角色切換器）===");
  console.log(`  Admin：${admin.name}`);
  console.log(`  填單人：${pm.name}`);
  console.log(`  填單人主管：${supervisor.name}`);
  console.log(`  RD 執行人：${rdMember.name}／RD 主管：${rdLead.name}`);
  console.log(`  QA 執行人：${qaMember.name}／QA 主管：${qaLead.name}`);
  console.log(`  OP 執行人：${opMember.name}／OP 主管：${opLead.name}`);
  console.log(`  無主管設定人員：${noSupervisorUser.name}（PM 團隊成員，但未設定直屬主管）`);
  console.log(`  無關使用者：${outsider.name}`);

  console.log("\n=== RD／QA／OP 接單／指派團隊（Team.domain 已明確分類，見 setTeamDomain）===");
  console.log(`  RD 領域：${iadTeam.name}（Lead：${iadLead.name}，成員：${iadMemberA.name}／${iadMemberB.name}）／${aadTeam.name}（Lead：${aadLead.name}，成員：${aadMemberA.name}／${aadMemberB.name}）`);
  console.log(`  QA 領域：${qaTeam1.name}（Lead：${qaTeam1Lead.name}）／${qaTeam2.name}（Lead：${qaTeam2Lead.name}）`);
  console.log(`  OP 領域：${opTeam1.name}（Lead：${opTeam1Lead.name}）／${opTeam2.name}（Lead：${opTeam2Lead.name}）`);

  console.log("\n=== RD 接單／指派示範工單（預期按鈕；以對應帳號登入後開啟工單即可看到）===");
  console.log(`  待 RD 團隊接單：${rdClaimPending.issueKey}（以 ${iadLead.name} 或 ${aadLead.name} 登入 → 看到「接單」按鈕；其他 RD 人員唯讀）`);
  console.log(`  已由 IAD 承接，AAD 只能看到承接狀態：${rdClaimedByIad.issueKey}（以 ${aadLead.name} 登入 → 顯示「已由 IAD 團隊承接」，無接單按鈕）`);
  console.log(`  IAD 待指派：${rdPendingAssign.issueKey}（以 ${iadLead.name} 登入 → 看到「指派成員」下拉選單，僅列 IAD active 成員）`);
  console.log(`  IAD 成員處理中：${rdInProgressIad.issueKey}（以 ${iadMemberA.name} 登入 → 看到「進入處理」表單；${iadMemberB.name} 登入 → 唯讀）`);
  console.log(`  待 IAD 主管核准：${rdPendingLeadApproval.issueKey}（以 ${iadLead.name} 登入 → 看到「審核」按鈕；${aadLead.name} 登入 → 無審核資格）`);

  console.log("\n=== QA 接單／指派示範工單 ===");
  console.log(`  待 QA 團隊接單：${qaClaimPending.issueKey}（以 ${qaTeam1Lead.name} 或 ${qaTeam2Lead.name} 登入 → 看到「接單」按鈕）`);
  console.log(`  QA 第一組待指派：${qaPendingAssign.issueKey}（以 ${qaTeam1Lead.name} 登入 → 看到「指派成員」）`);
  console.log(`  QA 驗證中：${qaInProgressCase.issueKey}（以 ${qaTeam1MemberA.name} 登入 → 看到「進入處理」表單）`);
  console.log(`  待 QA 主管核准：${qaPendingLeadApproval.issueKey}（以 ${qaTeam1Lead.name} 登入 → 看到「審核」按鈕）`);

  console.log("\n=== OP 接單／指派示範工單 ===");
  console.log(`  待 OP 團隊接單：${opClaimPending.issueKey}（以 ${opTeam1Lead.name} 或 ${opTeam2Lead.name} 登入 → 看到「接單」按鈕）`);
  console.log(`  OP 第一組待指派：${opPendingAssign.issueKey}（以 ${opTeam1Lead.name} 登入 → 看到「指派成員」）`);
  console.log(`  OP 上版準備中：${opInProgressCase.issueKey}（以 ${opTeam1MemberA.name} 登入 → 看到「進入處理」表單）`);
  console.log(`  待 OP 主管核准：${opPendingLeadApproval.issueKey}（以 ${opTeam1Lead.name} 登入 → 看到「審核」按鈕）`);

  console.log("\n=== 結案（待原申請人確認）===");
  console.log(`  ${stage9.issueKey}（以 ${pm.name} 登入 → 工單清單看到「待申請人確認結案」，按下「確認結案」）`);
}

main()
  .catch((err) => {
    console.error("建立 Hotfix 九階段 UI Preview 展示資料時發生錯誤：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
