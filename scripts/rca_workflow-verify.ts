// RCA 根因分析與改善結案流程 targeted verify：真正透過既有服務層／DB 走完十二階段
// （承接、指派主責人、根因分析＋改善措施、技術審查含退回、完整性審查、條件式管理階層確認
// [低等級略過／高等級副部長＋部長]、改善執行、佐證提交、驗證含不通過退回、RCA 結案），
// 並確認 RCA 只能由 Incident「需要 RCA」判定觸發建立，以及多筆 RCA 全部結案後 Incident
// 才可結案。不假造資料、不繞過既有 actionability。
//   npx tsx scripts/rca_workflow-verify.ts

import "./lib/assertSafeTestDatabase";

import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildIncidentWorkflowV1 } from "./lib/buildIncidentWorkflowV1";
import { buildRcaWorkflowV1 } from "./lib/buildRcaWorkflowV1";
import { createIncidentForActor } from "../src/lib/incident-ui/incidentCreation";
import { claimIssueForTeam } from "../src/lib/workflowExecutionService";
import {
  classifyIncident,
  assignIncidentTechnicalUnit,
  techLeadClaimAndAssignExecutor,
  submitIncidentHandling,
  confirmIncidentRecovery,
  confirmIncidentRcaDecision,
  assertIncidentClosableWithoutRcaBlock,
  IncidentRcaNotClosedError,
} from "../src/lib/workflow-execution/incidentAssignmentService";
import {
  rcaTeamClaim,
  assignRcaOwner,
  submitRcaAnalysis,
  decideRcaTechnicalReview,
  decideRcaSecurityIntegrityReview,
  decideRcaManagementConfirmation,
  ensureRcaManagementConfirmationRequirements,
  submitImprovementProgress,
  submitRcaEvidence,
  decideRcaVerification,
  confirmRcaClosure,
} from "../src/lib/workflow-execution/rcaAssignmentService";
import { createRcaActionItem, updateRcaActionItemProgress, verifyRcaActionItem } from "../src/lib/workflow-execution/rcaActionItemService";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionStateError } from "../src/lib/workflow-execution/types";

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
    check(label, error instanceof ErrorType, error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error));
  }
}

async function createAdHocUser(name: string, role: string, email: string) {
  const user = await prisma.user.create({ data: { name, email, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function driveIncidentToRcaDecision(opts: {
  reporter: { id: string; name: string };
  intakeTeamId: string;
  intakeLeadId: string;
  rdTeamId: string;
  rdLeadId: string;
  rdExecutorId: string;
  severity: "高" | "中" | "低";
  title: string;
}) {
  const issue = await createIncidentForActor(await prisma.user.findUniqueOrThrow({ where: { id: opts.reporter.id } }), {
    symptomText: "服務回應緩慢",
    impactScope: "SINGLE_USER",
    dataPermissionImpact: ["不確定"],
    operationalImpact: ["不確定"],
    title: opts.title,
    description: "說明",
    systemName: "MyDMS",
    environment: "Production",
    incidentType: "資安疑慮",
    occurredAt: "2026-08-01T09:00:00.000Z",
    reportSource: "監控告警",
    suggestedSeverity: "不確定，請承接窗口判斷",
    isOngoing: "否，目前已恢復",
    hasWorkaround: "沒有",
    affectedScope: "x",
    impactSummary: "x",
  });
  await claimIssueForTeam({ issueId: issue.id, teamId: opts.intakeTeamId, actorId: opts.intakeLeadId, reasonCode: "V" });
  await classifyIncident({ issueId: issue.id, actorId: opts.intakeLeadId, formalSeverity: opts.severity, reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: issue.id, actorId: opts.intakeLeadId, technicalTeamId: opts.rdTeamId, reasonCode: "V" });
  await techLeadClaimAndAssignExecutor({ issueId: issue.id, actorId: opts.rdLeadId, executorUserId: opts.rdExecutorId, reasonCode: "V" });
  await submitIncidentHandling({ issueId: issue.id, actorId: opts.rdExecutorId, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRecovery({ issueId: issue.id, actorId: opts.intakeLeadId, confirmResult: "已恢復", reasonCode: "V" });
  return issue;
}

async function main() {
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Incident" } }, data: { status: "ARCHIVED" } });
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "RCA" } }, data: { status: "ARCHIVED" } });
  await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "RCA_WORKFLOW_VERIFY", keySuffix: `incident-for-rca-verify-${Date.now()}-${process.pid}` });
  await buildRcaWorkflowV1({ actorId: org.admin.id, reasonCode: "RCA_WORKFLOW_VERIFY", keySuffix: `rca-workflow-verify-${Date.now()}-${process.pid}` });

  const intakeTeam = await prisma.team.create({ data: { name: "事件受理窗口", domain: "INCIDENT", isActive: true } });
  const intakeLead = await createAdHocUser("IntakeLead", "PM", "intake-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: intakeTeam.id, userId: intakeLead.id, membershipRole: "LEAD", isActive: true } });

  const securityTeam = await prisma.team.create({ data: { name: "資安推動小組", domain: "SECURITY", isActive: true } });
  const securityLead = await createAdHocUser("SecurityLead", "資安推動小組", "security-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: securityTeam.id, userId: securityLead.id, membershipRole: "LEAD", isActive: true } });

  const vpTeam = await prisma.team.create({ data: { name: "DMS 副部長", domain: "MANAGEMENT_VP", isActive: true } });
  const vp = await createAdHocUser("DeputyDirector", "PM", "dms-vp@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: vpTeam.id, userId: vp.id, membershipRole: "LEAD", isActive: true } });

  const directorTeam = await prisma.team.create({ data: { name: "DMS 部長", domain: "MANAGEMENT_DIRECTOR", isActive: true } });
  const director = await createAdHocUser("Director", "PM", "dms-director@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: directorTeam.id, userId: director.id, membershipRole: "LEAD", isActive: true } });

  const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
  const rdLeadInfo = org.personByKey.get("tommy")!;
  const rdLead = await prisma.user.findUniqueOrThrow({ where: { id: rdLeadInfo.id } });
  const rdExecutor = await createAdHocUser("RdExecutor2", "RD", "rd-executor2@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdExecutor.id, membershipRole: "MEMBER", isActive: true } });
  const rcaOwner = await createAdHocUser("RcaOwner", "RD", "rca-owner@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rcaOwner.id, membershipRole: "MEMBER", isActive: true } });

  const reporterInfo = org.personByKey.get("selena")!;
  const outsiderInfo = org.personByKey.get("jonus")!;
  const outsider = await prisma.user.findUniqueOrThrow({ where: { id: outsiderInfo.id } });

  console.log("\n=== A. RCA 只能由 Incident「需要 RCA」判定觸發建立 ===");
  const lowIncident = await driveIncidentToRcaDecision({
    reporter: reporterInfo, intakeTeamId: intakeTeam.id, intakeLeadId: intakeLead.id,
    rdTeamId, rdLeadId: rdLead.id, rdExecutorId: rdExecutor.id, severity: "低", title: "[verify] 低等級 RCA",
  });
  await confirmIncidentRcaDecision({ issueId: lowIncident.id, actorId: securityLead.id, needRca: true, reasonCode: "V" });
  const relations = await prisma.issueRelation.findMany({ where: { sourceIssueId: lowIncident.id, relationType: "INCIDENT_TO_RCA", removedAt: null } });
  check("[1] 判定需要 RCA 後自動建立 INCIDENT_TO_RCA 關聯", relations.length === 1);
  const rcaLow = await prisma.issue.findUniqueOrThrow({ where: { id: relations[0].targetIssueId } });
  check("[2] RCA 自動帶入來源事件的技術處理團隊", rcaLow.assignedTeamId === rdTeamId);
  check("[3] RCA 建立後自動送出至待負責單位主管承接", rcaLow.workflowStatus === "pendingRcaTeamClaim");
  check("[4] RCA 標題帶有來源事件名稱", rcaLow.title.includes("低等級 RCA"));

  console.log("\n=== B. 承接、指派主責人、根因分析（低等級：管理階層確認自動略過） ===");
  await expectError(
    "[5] 非負責單位 LEAD 不得承接 RCA",
    () => rcaTeamClaim({ issueId: rcaLow.id, actorId: outsider.id, reasonCode: "V" }),
    WorkflowExecutionAccessDeniedError,
  );
  await rcaTeamClaim({ issueId: rcaLow.id, actorId: rdLead.id, reasonCode: "V" });
  const afterTeamClaim = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[6] 承接後進入待指派 RCA 主責人", afterTeamClaim.workflowStatus === "pendingRcaOwnerAssignment");

  await assignRcaOwner({ issueId: rcaLow.id, actorId: rdLead.id, ownerUserId: rcaOwner.id, reasonCode: "V" });
  const afterOwnerAssign = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[7] 指派主責人後進入根因分析與改善計畫中", afterOwnerAssign.workflowStatus === "rcaAnalysisInProgress");

  await expectError(
    "[8] 尚未建立任何改善措施時不得送出根因分析",
    () => submitRcaAnalysis({
      issueId: rcaLow.id, actorId: rcaOwner.id, directCause: "x", rootCause: "x", controlFailurePoint: "x",
      causeType: "人為操作錯誤", analysisMethods: ["Log／監控分析"], rcaConclusion: "x", actualImpact: "x", verificationMethod: "x", reasonCode: "V",
    }),
    WorkflowExecutionStateError,
  );
  const actionItem1 = await createRcaActionItem({
    rcaIssueId: rcaLow.id, actorId: rcaOwner.id, type: "CORRECTIVE", description: "修正設定檢核流程",
    ownerTeamId: rdTeamId, ownerUserId: rcaOwner.id, plannedCompletionDate: "2026-09-01", reasonCode: "V",
  });
  check("[9] 改善措施建立成功且序號為 1", actionItem1.sequence === 1);
  await expectError(
    "[10] 非主責人不得新增改善措施",
    () => createRcaActionItem({ rcaIssueId: rcaLow.id, actorId: outsider.id, type: "PREVENTIVE", description: "x", ownerTeamId: rdTeamId, plannedCompletionDate: "2026-09-01", reasonCode: "V" }),
    WorkflowExecutionAccessDeniedError,
  );

  await submitRcaAnalysis({
    issueId: rcaLow.id, actorId: rcaOwner.id, directCause: "設定錯誤", rootCause: "檢核流程缺漏", controlFailurePoint: "上線前檢核",
    causeType: "流程／文件不足", analysisMethods: ["Log／監控分析", "設定比對"], rcaConclusion: "缺少上線前設定檢核", actualImpact: "部分使用者無法登入 30 分鐘",
    verificationMethod: "覆查上線檢核紀錄", reasonCode: "V",
  });
  const afterAnalysis = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[11] 送出根因分析後進入待負責單位主管技術審查", afterAnalysis.workflowStatus === "pendingTechnicalReview");

  console.log("\n=== C. 技術審查（含退回）、完整性審查 ===");
  await decideRcaTechnicalReview({ issueId: rcaLow.id, actorId: rdLead.id, approved: false, reasonCode: "分析深度不足，請補充" });
  const afterTechReject = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[12] 技術審查退回後回到根因分析中", afterTechReject.workflowStatus === "rcaAnalysisInProgress");
  await submitRcaAnalysis({
    issueId: rcaLow.id, actorId: rcaOwner.id, directCause: "設定錯誤（補充）", rootCause: "檢核流程缺漏（補充根因）", controlFailurePoint: "上線前檢核",
    causeType: "流程／文件不足", analysisMethods: ["Log／監控分析", "設定比對"], rcaConclusion: "缺少上線前設定檢核，已補充根因鏈", actualImpact: "部分使用者無法登入 30 分鐘",
    verificationMethod: "覆查上線檢核紀錄", reasonCode: "V",
  });
  await decideRcaTechnicalReview({ issueId: rcaLow.id, actorId: rdLead.id, approved: true, reasonCode: "V" });
  const afterTechApprove = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[13] 技術審查通過後進入待資安推動小組完整性審查", afterTechApprove.workflowStatus === "pendingSecurityIntegrityReview");

  await decideRcaSecurityIntegrityReview({ issueId: rcaLow.id, actorId: securityLead.id, approved: true, requiresDirectorEscalation: false, reasonCode: "V" });
  const afterIntegrity = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[14] 完整性審查通過後進入條件式管理階層確認", afterIntegrity.workflowStatus === "pendingManagementConfirmation");

  console.log("\n=== D. 條件式管理階層確認：低等級自動略過 ===");
  const reqLow = await ensureRcaManagementConfirmationRequirements(rcaLow.id, intakeLead.id, "V");
  check("[15] 低等級不需管理階層確認，自動前進", reqLow.required === false && reqLow.advancedAutomatically === true);
  const afterMgmtSkip = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[16] 自動前進後進入改善措施執行中", afterMgmtSkip.workflowStatus === "improvementInProgress");

  console.log("\n=== E. 改善措施執行、佐證提交、驗證（含不通過退回）、RCA 結案 ===");
  await expectError(
    "[17] 改善措施未完成前不得送出改善執行進度",
    () => submitImprovementProgress({ issueId: rcaLow.id, actorId: rcaOwner.id, reasonCode: "V" }),
    WorkflowExecutionStateError,
  );
  await updateRcaActionItemProgress({ actionItemId: actionItem1.id, actorId: rcaOwner.id, status: "COMPLETED", actualCompletionDate: "2026-08-20", evidenceSummary: "已完成設定檢核流程修正並上線", reasonCode: "V" });
  await submitImprovementProgress({ issueId: rcaLow.id, actorId: rcaOwner.id, reasonCode: "V" });
  const afterImprovement = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[18] 改善措施完成後進入待改善佐證提交", afterImprovement.workflowStatus === "pendingImprovementEvidence");

  await submitRcaEvidence({ issueId: rcaLow.id, actorId: rcaOwner.id, evidenceSummary: "檢核流程修正紀錄與上線證明連結", reasonCode: "V" });
  const afterEvidence = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[19] 送出佐證後進入待專業驗證與資安確認", afterEvidence.workflowStatus === "pendingVerificationConfirmation");

  await expectError(
    "[20] 措施尚未通過驗證時不得通過驗證與資安確認",
    () => decideRcaVerification({ issueId: rcaLow.id, actorId: securityLead.id, approved: true, reasonCode: "V" }),
    WorkflowExecutionStateError,
  );
  await verifyRcaActionItem({ actionItemId: actionItem1.id, actorId: securityLead.id, verificationStatus: "FAILED", verificationNote: "佐證截圖不完整", reasonCode: "V" });
  await decideRcaVerification({ issueId: rcaLow.id, actorId: securityLead.id, approved: false, reasonCode: "佐證不完整，請補充" });
  const afterVerifyReject = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[21] 驗證不通過退回改善執行", afterVerifyReject.workflowStatus === "improvementInProgress");

  await updateRcaActionItemProgress({ actionItemId: actionItem1.id, actorId: rcaOwner.id, status: "COMPLETED", actualCompletionDate: "2026-08-21", evidenceSummary: "已補充完整佐證截圖", reasonCode: "V" });
  await submitImprovementProgress({ issueId: rcaLow.id, actorId: rcaOwner.id, reasonCode: "V" });
  await submitRcaEvidence({ issueId: rcaLow.id, actorId: rcaOwner.id, evidenceSummary: "檢核流程修正紀錄（已補充）", reasonCode: "V" });
  await verifyRcaActionItem({ actionItemId: actionItem1.id, actorId: securityLead.id, verificationStatus: "PASSED", reasonCode: "V" });
  await decideRcaVerification({ issueId: rcaLow.id, actorId: securityLead.id, approved: true, reasonCode: "V" });
  const afterVerifyPass = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[22] 驗證通過後進入待 RCA 結案確認", afterVerifyPass.workflowStatus === "pendingRcaClosureConfirmation");

  await confirmRcaClosure({ issueId: rcaLow.id, actorId: rdLead.id, reasonCode: "V" });
  const afterRcaClosed = await prisma.issue.findUniqueOrThrow({ where: { id: rcaLow.id } });
  check("[23] RCA 結案確認後進入 rcaClosed", afterRcaClosed.workflowStatus === "rcaClosed");

  console.log("\n=== F. Incident 全部關聯 RCA 結案後才可結案 ===");
  await assertIncidentClosableWithoutRcaBlock(lowIncident.id);
  check("[24] 唯一關聯 RCA 已結案，事件不再被 RCA 阻擋結案", true);

  console.log("\n=== G. 高等級 RCA：條件式管理階層確認（副部長＋部長） ===");
  const highIncident = await driveIncidentToRcaDecision({
    reporter: reporterInfo, intakeTeamId: intakeTeam.id, intakeLeadId: intakeLead.id,
    rdTeamId, rdLeadId: rdLead.id, rdExecutorId: rdExecutor.id, severity: "高", title: "[verify] 高等級 RCA",
  });
  await confirmIncidentRcaDecision({ issueId: highIncident.id, actorId: securityLead.id, needRca: true, reasonCode: "V" });
  const relHigh = await prisma.issueRelation.findFirst({ where: { sourceIssueId: highIncident.id, relationType: "INCIDENT_TO_RCA", removedAt: null } });
  const rcaHigh = await prisma.issue.findUniqueOrThrow({ where: { id: relHigh!.targetIssueId } });

  await expectError(
    "[25] 高等級事件關聯 RCA 未結案前，事件不得結案",
    () => assertIncidentClosableWithoutRcaBlock(highIncident.id),
    IncidentRcaNotClosedError,
  );

  await rcaTeamClaim({ issueId: rcaHigh.id, actorId: rdLead.id, reasonCode: "V" });
  await assignRcaOwner({ issueId: rcaHigh.id, actorId: rdLead.id, ownerUserId: rcaOwner.id, reasonCode: "V" });
  await createRcaActionItem({ rcaIssueId: rcaHigh.id, actorId: rcaOwner.id, type: "PREVENTIVE", description: "建立每季稽核複查", ownerTeamId: rdTeamId, ownerUserId: rcaOwner.id, plannedCompletionDate: "2026-09-15", reasonCode: "V" });
  await submitRcaAnalysis({
    issueId: rcaHigh.id, actorId: rcaOwner.id, directCause: "權限設定錯誤", rootCause: "跨單位權限審核流程缺乏交叉驗證", controlFailurePoint: "權限異動審核",
    causeType: "權限／資料處理問題", analysisMethods: ["會議檢討", "程式碼分析"], rcaConclusion: "跨單位權限審核需增加交叉驗證", actualImpact: "跨單位多個系統權限異常，涉及對外服務",
    verificationMethod: "覆查權限異動紀錄", reasonCode: "V",
  });
  await decideRcaTechnicalReview({ issueId: rcaHigh.id, actorId: rdLead.id, approved: true, reasonCode: "V" });
  await decideRcaSecurityIntegrityReview({ issueId: rcaHigh.id, actorId: securityLead.id, approved: true, requiresDirectorEscalation: true, reasonCode: "V" });
  const afterHighIntegrity = await prisma.issue.findUniqueOrThrow({ where: { id: rcaHigh.id } });
  check("[26] 高等級完整性審查通過後進入條件式管理階層確認", afterHighIntegrity.workflowStatus === "pendingManagementConfirmation");

  const reqHigh = await ensureRcaManagementConfirmationRequirements(rcaHigh.id, intakeLead.id, "V");
  check("[27] 高等級需要副部長確認", reqHigh.required === true && reqHigh.vpRequired === true);
  const vpRecord = await prisma.approvalRecord.findFirst({ where: { issueId: rcaHigh.id, approvalType: "RCA_VP_CONFIRMATION", relatedStageKey: "pendingManagementConfirmation" } });
  check("[28] 已建立副部長確認核准紀錄", Boolean(vpRecord));

  await expectError(
    "[29] 非副部長不得決策副部長確認",
    () => decideRcaManagementConfirmation({ issueId: rcaHigh.id, actorId: outsider.id, approvalType: "RCA_VP_CONFIRMATION", approved: true, reasonCode: "V" }),
    Error,
  );
  await decideRcaManagementConfirmation({ issueId: rcaHigh.id, actorId: vp.id, approvalType: "RCA_VP_CONFIRMATION", approved: true, reasonCode: "V" });
  await ensureRcaManagementConfirmationRequirements(rcaHigh.id, intakeLead.id, "V");
  const directorRecord = await prisma.approvalRecord.findFirst({ where: { issueId: rcaHigh.id, approvalType: "RCA_DIRECTOR_APPROVAL", relatedStageKey: "pendingManagementConfirmation" } });
  check("[30] 副部長確認通過且符合升級條件後，建立部長核准紀錄", Boolean(directorRecord));
  const stillOnMgmt = await prisma.issue.findUniqueOrThrow({ where: { id: rcaHigh.id } });
  check("[31] 部長尚未核准前仍停留在條件式管理階層確認", stillOnMgmt.workflowStatus === "pendingManagementConfirmation");

  await decideRcaManagementConfirmation({ issueId: rcaHigh.id, actorId: director.id, approvalType: "RCA_DIRECTOR_APPROVAL", approved: true, reasonCode: "V" });
  const afterDirector = await prisma.issue.findUniqueOrThrow({ where: { id: rcaHigh.id } });
  check("[32] 部長核准後進入改善措施執行中", afterDirector.workflowStatus === "improvementInProgress");

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
