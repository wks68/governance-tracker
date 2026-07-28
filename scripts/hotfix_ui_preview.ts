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
import { startIssueWorkflow, executeIssueTransition, returnIssueToStage, cancelIssueWorkflow, setIssueAssignedTeamAtTriage, submitStageRiskCheckAnswer } from "../src/lib/workflowExecutionService";
import { saveExecutionFieldValues } from "../src/lib/hotfix-ui/executionFields";
import { saveHotfixDraft } from "../src/lib/hotfix-ui/draftService";
import { saveClosureSummary } from "../src/lib/hotfix-ui/closureService";
import { uploadHotfixAttachment } from "../src/lib/hotfix-ui/attachmentService";

const RUN_TAG = "hfui9";

async function createUser(name: string, role: string, department: string) {
  const user = await prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role, department, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}
async function createTeam(name: string) {
  return prisma.team.create({ data: { name } });
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

async function createHotfixIssue(key: string, title: string, description: string, ctx: Ctx) {
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
      // 2: pendingRdTriage -> pendingRdClaim -> rdInProgress
      await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: rdTeam.id, actorId: supervisor.id, reasonCode: "PREVIEW_ASSIGN_RD" });
      const assignT = await findTransition(hotfix.version.id, s.pendingRdTriage, "rdAssign");
      await executeIssueTransition({ issueId: issue.id, transitionId: assignT.id, actorId: supervisor.id, reasonCode: "PREVIEW" });
      const claimT = await findTransition(hotfix.version.id, s.pendingRdClaim, "rdClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: claimT.id, actorId: rdMember.id, reasonCode: "PREVIEW" });
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
      // 5: pendingQaTriage -> pendingQaClaim -> qaInProgress
      await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: qaTeam.id, actorId: supervisor.id, reasonCode: "PREVIEW_ASSIGN_QA" });
      const assignT = await findTransition(hotfix.version.id, s.pendingQaTriage, "qaAssign");
      await executeIssueTransition({ issueId: issue.id, transitionId: assignT.id, actorId: supervisor.id, reasonCode: "PREVIEW" });
      const claimT = await findTransition(hotfix.version.id, s.pendingQaClaim, "qaClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: claimT.id, actorId: qaMember.id, reasonCode: "PREVIEW" });
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
      // 8: pendingOpTriage -> pendingOpClaim -> opPreparing
      await setIssueAssignedTeamAtTriage({ issueId: issue.id, teamId: opTeam.id, actorId: supervisor.id, reasonCode: "PREVIEW_ASSIGN_OP" });
      const assignT = await findTransition(hotfix.version.id, s.pendingOpTriage, "opAssign");
      await executeIssueTransition({ issueId: issue.id, transitionId: assignT.id, actorId: supervisor.id, reasonCode: "PREVIEW" });
      const claimT = await findTransition(hotfix.version.id, s.pendingOpClaim, "opClaim");
      await executeIssueTransition({ issueId: issue.id, transitionId: claimT.id, actorId: opMember.id, reasonCode: "PREVIEW" });
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

  const rdTeam = await createTeam("RD 維運團隊");
  const rdMember = await createUser("RD執行人", "RD", "研發處");
  const rdLead = await createUser("RD主管", "RD", "研發處");
  await addMember(rdTeam.id, rdMember.id, "MEMBER");
  await addMember(rdTeam.id, rdLead.id, "LEAD");

  const qaTeam = await createTeam("QA 驗證團隊");
  const qaMember = await createUser("QA執行人", "QA", "品保處");
  const qaLead = await createUser("QA主管", "QA", "品保處");
  await addMember(qaTeam.id, qaMember.id, "MEMBER");
  await addMember(qaTeam.id, qaLead.id, "LEAD");

  const opTeam = await createTeam("OP 部署團隊");
  const opMember = await createUser("OP執行人", "OP", "維運處");
  const opLead = await createUser("OP主管", "OP", "維運處");
  await addMember(opTeam.id, opMember.id, "MEMBER");
  await addMember(opTeam.id, opLead.id, "LEAD");

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

  console.log("[3/3] 完成。");
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
  console.log("\n=== 可登入角色帳號（於 /login 頁面點選登入，無繞過授權的角色切換器）===");
  console.log(`  Admin：${admin.name}`);
  console.log(`  填單人：${pm.name}`);
  console.log(`  填單人主管：${supervisor.name}`);
  console.log(`  RD 執行人：${rdMember.name}／RD 主管：${rdLead.name}`);
  console.log(`  QA 執行人：${qaMember.name}／QA 主管：${qaLead.name}`);
  console.log(`  OP 執行人：${opMember.name}／OP 主管：${opLead.name}`);
  console.log(`  無關使用者：${outsider.name}`);
}

main()
  .catch((err) => {
    console.error("建立 Hotfix 九階段 UI Preview 展示資料時發生錯誤：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
