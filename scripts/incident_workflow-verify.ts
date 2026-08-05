// Incident 事件通報流程 targeted verify：真正透過既有服務層／DB 走完九階段（含補件退回、
// 技術單位退回、恢復未通過退回、非責任人不得操作、RCA 未結案不得結案），不假造資料、
// 不繞過既有 actionability。
//   npx tsx scripts/incident_workflow-verify.ts

import "./lib/assertSafeTestDatabase";

import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildIncidentWorkflowV1 } from "./lib/buildIncidentWorkflowV1";
import { buildRcaWorkflowV1 } from "./lib/buildRcaWorkflowV1";
import { createIncidentForActor, IncidentCreationValidationError } from "../src/lib/incident-ui/incidentCreation";
import { claimIssueForTeam } from "../src/lib/workflowExecutionService";
import {
  requestIncidentSupplement,
  classifyIncident,
  assignIncidentTechnicalUnit,
  techLeadClaimAndAssignExecutor,
  techLeadReturnForReassignment,
  submitIncidentHandling,
  confirmIncidentRecovery,
  confirmIncidentRcaDecision,
} from "../src/lib/workflow-execution/incidentAssignmentService";
import { confirmIncidentClosure, IncidentRcaNotClosedError } from "../src/lib/incident-ui/incidentClosureService";
import { loadIncidentPageContext, buildIncidentApprovalReviewViewData } from "../src/lib/incident-ui/pageContext";
import { evaluateCurrentIncidentActorTask } from "../src/lib/incident-ui/incidentResponsibilityService";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionStateError, WorkflowExecutionValidationError } from "../src/lib/workflow-execution/types";

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

// 本檔案驗證的是九階段 Workflow 本身，不是通報人快速通報介面（見
// incident_reporter_ux-verify.ts），因此結構化欄位一律用固定最小合法值，不逐案客製。
const BASE_INTAKE_FIELDS = {
  symptomText: "服務回應緩慢",
  impactScope: "SINGLE_USER",
  dataPermissionImpact: ["不確定"],
  operationalImpact: ["不確定"],
};

async function createAdHocUser(name: string, role: string, email: string) {
  const user = await prisma.user.create({ data: { name, email, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function main() {
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Incident" } }, data: { status: "ARCHIVED" } });
  const built = await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "INCIDENT_WORKFLOW_VERIFY", keySuffix: `incident-workflow-verify-${Date.now()}-${process.pid}` });
  // RCA 判定「需要 RCA」時會透過 rca-ui/rcaCreation.ts 觸發真正的 RCA 建立，因此本測試也需要
  // 一份已發布的 RCA Workflow 版本，否則 confirmIncidentRcaDecision(needRca: true) 會因找不到
  // 唯一已發布的 RCA Workflow 版本而拒絕——這不是本測試要驗證的情境，故先行建置。
  await buildRcaWorkflowV1({ actorId: org.admin.id, reasonCode: "INCIDENT_WORKFLOW_VERIFY", keySuffix: `rca-workflow-for-incident-verify-${Date.now()}-${process.pid}` });

  // ---- Ad hoc 團隊：事件受理窗口（INCIDENT）、資安推動小組（SECURITY）；技術處理單位沿用既有 RD 團隊並補一位成員 ----
  const intakeTeam = await prisma.team.create({ data: { name: "事件受理窗口", domain: "INCIDENT", isActive: true } });
  const intakeLead = await createAdHocUser("IntakeLead", "PM", "intake-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: intakeTeam.id, userId: intakeLead.id, membershipRole: "LEAD", isActive: true } });

  const securityTeam = await prisma.team.create({ data: { name: "資安推動小組", domain: "SECURITY", isActive: true } });
  const securityLead = await createAdHocUser("SecurityLead", "資安推動小組", "security-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: securityTeam.id, userId: securityLead.id, membershipRole: "LEAD", isActive: true } });

  const rdTeamId = org.teamIdByName.get("語音與AI技術")!; // RD-domain team from fixture, lead-only
  const rdLead = org.personByKey.get("tommy")!;
  const rdLeadUser = await prisma.user.findUniqueOrThrow({ where: { id: rdLead.id } });
  const rdExecutor = await createAdHocUser("RdExecutor", "RD", "rd-executor@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdExecutor.id, membershipRole: "MEMBER", isActive: true } });

  const reporterInfo = org.personByKey.get("selena")!;
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: reporterInfo.id } });
  const outsiderInfo = org.personByKey.get("jonus")!;
  const outsider = await prisma.user.findUniqueOrThrow({ where: { id: outsiderInfo.id } });

  console.log("\n=== A. 建立事件並自動送出待承接 ===");
  const issue = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 事件通報流程",
    description: "服務回應緩慢",
    systemName: "MyDMS",
    environment: "Production",
    incidentType: "服務中斷",
    occurredAt: "2026-08-01T09:00:00.000Z",
    reportSource: "監控告警",
    suggestedSeverity: "有影響，但仍可部分作業",
    isOngoing: "是，現在仍持續",
    hasWorkaround: "沒有",
    affectedScope: "MyDMS 全體使用者",
    impactSummary: "登入延遲",
  });
  check("[1] 正式通報人是 Selena", issue.reporterUserId === reporter.id && issue.reporter === "Selena");
  check("[2] 建立後自動進入待承接關卡", issue.workflowStatus === "pendingIntake");
  check("[3] Runtime 已建立", Boolean(issue.workflowVersionId && issue.currentWorkflowStageId));

  await expectError(
    "[4] 建立時缺少必填欄位（事件名稱）明確拒絕，不寫入半成品",
    () => createIncidentForActor(reporter, {
      ...BASE_INTAKE_FIELDS,
      title: "", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "其他", incidentTypeOtherNote: "其他說明",
      occurredAt: "2026-08-01T09:00:00.000Z", reportSource: "電話", suggestedSeverity: "影響較小", isOngoing: "否，目前已恢復", hasWorkaround: "沒有", affectedScope: "x", impactSummary: "x",
    }),
    IncidentCreationValidationError,
  );

  console.log("\n=== B. 承接與補件 ===");
  await expectError(
    "[5] 非事件受理窗口 LEAD 不得承接",
    () => claimIssueForTeam({ issueId: issue.id, teamId: intakeTeam.id, actorId: outsider.id, reasonCode: "V" }),
    WorkflowExecutionAccessDeniedError,
  );

  // 用第二筆事件驗證「退回補件」，避免影響主線流程的 issue。
  const supplementCase = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 補件退回案例", description: "描述不足", systemName: "MyDMS", environment: "Production", incidentType: "其他", incidentTypeOtherNote: "其他說明",
    occurredAt: "2026-08-01T09:00:00.000Z", reportSource: "電話", suggestedSeverity: "影響較小", isOngoing: "否，目前已恢復", hasWorkaround: "沒有", affectedScope: "x", impactSummary: "x",
  });
  await requestIncidentSupplement({ issueId: supplementCase.id, actorId: intakeLead.id, reasonCode: "資料不足，請補充受影響範圍" });
  const afterSupplement = await prisma.issue.findUniqueOrThrow({ where: { id: supplementCase.id } });
  check("[6] 退回補件後回到通報人（reported）", afterSupplement.workflowStatus === "reported");
  check("[6b] 退回補件未指派受理團隊", afterSupplement.assignedTeamId === null);

  const claimResult = await claimIssueForTeam({ issueId: issue.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  check("[7] 事件受理窗口承接後進入影響確認與分級", claimResult.issue.workflowStatus === "pendingClassification");
  check("[7b] assignedTeamId 為事件受理窗口", claimResult.issue.assignedTeamId === intakeTeam.id);

  console.log("\n=== C. 影響確認與分級 ===");
  // 第二階段起，通報人只提供「初步影響感受」（與正式等級不同值域，不可比較），因此分級
  // 關卡不再有「建議等級與正式等級不同須填調整原因」的強制檢查（見
  // incidentAssignmentService.ts classifyIncident 說明）；改驗證缺少必填 formalSeverity 本身
  // 仍會被拒絕。
  await expectError(
    "[8] 正式事件等級不在高／中／低值域，明確拒絕",
    () => classifyIncident({ issueId: issue.id, actorId: intakeLead.id, formalSeverity: "非法值", reasonCode: "V" }),
    WorkflowExecutionValidationError,
  );
  await classifyIncident({ issueId: issue.id, actorId: intakeLead.id, formalSeverity: "高", reasonCode: "V" });
  const afterClassify = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  check("[9] 完成分級後進入待指派處理單位", afterClassify.workflowStatus === "pendingUnitAssignment");
  check("[9b] 正式事件等級已寫入 Issue.riskLevel", afterClassify.riskLevel === "高");

  console.log("\n=== D. 指派處理單位、技術主管接單與指派 ===");
  await assignIncidentTechnicalUnit({ issueId: issue.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  const afterUnitAssign = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  check("[10] 指派技術單位後進入待技術主管接單與指派", afterUnitAssign.workflowStatus === "pendingTechLeadClaim");
  check("[10b] Issue.assignedTeamId 仍是事件受理窗口（未被技術單位覆蓋）", afterUnitAssign.assignedTeamId === intakeTeam.id);

  await expectError(
    "[11] 非技術單位 LEAD 不得接單指派",
    () => techLeadClaimAndAssignExecutor({ issueId: issue.id, actorId: outsider.id, executorUserId: rdExecutor.id, reasonCode: "V" }),
    WorkflowExecutionAccessDeniedError,
  );
  await techLeadClaimAndAssignExecutor({ issueId: issue.id, actorId: rdLeadUser.id, executorUserId: rdExecutor.id, reasonCode: "V" });
  const afterTechClaim = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  check("[12] 技術主管接單指派後進入初步處置與服務恢復", afterTechClaim.workflowStatus === "inHandling");

  // 用第三筆事件驗證「技術單位無法承接，退回重新指派」路徑。
  const returnCase = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 技術單位退回案例", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "其他", incidentTypeOtherNote: "其他說明",
    occurredAt: "2026-08-01T09:00:00.000Z", reportSource: "電話", suggestedSeverity: "影響較小", isOngoing: "否，目前已恢復", hasWorkaround: "沒有", affectedScope: "x", impactSummary: "x",
  });
  await claimIssueForTeam({ issueId: returnCase.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  await classifyIncident({ issueId: returnCase.id, actorId: intakeLead.id, formalSeverity: "低", reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: returnCase.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  await techLeadReturnForReassignment({ issueId: returnCase.id, actorId: rdLeadUser.id, reasonCode: "此單位目前無法承接" });
  const afterTechReturn = await prisma.issue.findUniqueOrThrow({ where: { id: returnCase.id } });
  check("[13] 技術單位無法承接，退回重新指派", afterTechReturn.workflowStatus === "pendingUnitAssignment");

  console.log("\n=== E. 初步處置與服務恢復、恢復結果確認 ===");
  await expectError(
    "[14] 非指派執行人不得送出初步處置",
    () => submitIncidentHandling({ issueId: issue.id, actorId: rdLeadUser.id, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "已恢復", reasonCode: "V" }),
    WorkflowExecutionAccessDeniedError,
  );
  await submitIncidentHandling({
    issueId: issue.id, actorId: rdExecutor.id, initialHandling: "重啟服務", recoveryMeasures: "擴充資源", recoveryTime: "2026-08-01T10:00:00.000Z",
    recoveryResult: "已恢復", evidence: "https://example.invalid/log", reasonCode: "V",
  });
  const afterHandling = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  check("[15] 送出處置後進入待恢復結果確認", afterHandling.workflowStatus === "pendingRecoveryConfirmation");

  // 用第四筆事件驗證「恢復結果未通過，退回處理」路徑。
  const rejectCase = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 恢復未通過案例", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "其他", incidentTypeOtherNote: "其他說明",
    occurredAt: "2026-08-01T09:00:00.000Z", reportSource: "電話", suggestedSeverity: "影響較小", isOngoing: "否，目前已恢復", hasWorkaround: "沒有", affectedScope: "x", impactSummary: "x",
  });
  await claimIssueForTeam({ issueId: rejectCase.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  await classifyIncident({ issueId: rejectCase.id, actorId: intakeLead.id, formalSeverity: "低", reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: rejectCase.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  await techLeadClaimAndAssignExecutor({ issueId: rejectCase.id, actorId: rdLeadUser.id, executorUserId: rdExecutor.id, reasonCode: "V" });
  await submitIncidentHandling({ issueId: rejectCase.id, actorId: rdExecutor.id, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "尚未恢復", reasonCode: "V" });
  await confirmIncidentRecovery({ issueId: rejectCase.id, actorId: intakeLead.id, confirmResult: "尚未恢復", reasonCode: "仍未恢復，請繼續處理" });
  const afterRecoveryReject = await prisma.issue.findUniqueOrThrow({ where: { id: rejectCase.id } });
  check("[16] 恢復結果未通過，退回處理人", afterRecoveryReject.workflowStatus === "inHandling");
  check("[17] 服務恢復不等同事件結案（未通過仍在流程中，非 closed）", afterRecoveryReject.workflowStatus !== "closed");

  await confirmIncidentRecovery({ issueId: issue.id, actorId: intakeLead.id, confirmResult: "已恢復", reasonCode: "V" });
  const afterRecoveryConfirm = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  check("[18] 恢復結果確認通過後進入 RCA 啟動判定", afterRecoveryConfirm.workflowStatus === "pendingRcaDecision");
  check("[18b] 服務恢復不等同事件結案", afterRecoveryConfirm.workflowStatus !== "closed");

  console.log("\n=== F. RCA 啟動判定與事件結案 ===");
  // 第二階段：RCA 啟動判定改走正式 ApprovalRecord（見
  // src/lib/workflow-execution/incidentAssignmentService.ts 的 confirmIncidentRcaDecision），
  // 「未填原因」的輸入驗證改由本函式自己直接丟出 WorkflowExecutionStateError（不再是
  // 第一階段暫行實作的 WorkflowExecutionValidationError）；「非資安推動小組不得決策」則完全
  // 交給 decideApprovalRecord 既有信任邊界判斷——用 outsider（既非送核人也非資安推動小組）
  // 驗證，避免與「送核人不得自行核准」（SelfApprovalError）混淆成不同的拒絕原因。
  await expectError(
    "[19] 判定不需要 RCA 卻未填原因，明確拒絕",
    () => confirmIncidentRcaDecision({ issueId: issue.id, actorId: securityLead.id, needRca: false, reasonCode: "V" }),
    WorkflowExecutionStateError,
  );
  await expectError(
    "[20] 非資安推動小組不得完成 RCA 啟動判定",
    () => confirmIncidentRcaDecision({ issueId: issue.id, actorId: outsider.id, needRca: false, reason: "x", reasonCode: "V" }),
    Error,
  );
  await confirmIncidentRcaDecision({ issueId: issue.id, actorId: securityLead.id, needRca: false, reason: "影響範圍有限，已於初步處置排除", reasonCode: "V" });
  const afterRcaDecision = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  check("[21] RCA 啟動判定後進入待事件結案確認", afterRcaDecision.workflowStatus === "pendingClosureConfirmation");

  const ctxIntake = await loadIncidentPageContext(issue.id, intakeLead);
  const review = await buildIncidentApprovalReviewViewData(ctxIntake);
  check("[22] 事件結案確認的核准人姓名正確來自正式責任資料（IntakeLead）", review?.expectedApproverLabel === "IntakeLead" || review?.expectedApproverLabel === "事件受理團隊的主管（LEAD）");
  check("[23] 受理窗口 LEAD 為責任人，isResponsible 為 true", review?.isResponsible === true);

  const ctxOutsider = await loadIncidentPageContext(issue.id, outsider);
  const reviewOutsider = await buildIncidentApprovalReviewViewData(ctxOutsider);
  check("[24] 非受理窗口成員 isResponsible 為 false，無法確認結案", reviewOutsider?.isResponsible === false);

  await confirmIncidentClosure({ issueId: issue.id, approvalRecordId: review!.approvalRecordId, actorId: intakeLead.id });
  const afterClosure = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
  check("[25] 不需 RCA 時事件正確結案", afterClosure.workflowStatus === "closed");

  console.log("\n=== G. 需要 RCA 時，RCA 未結案不得關閉事件 ===");
  const rcaCase = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 需要 RCA 案例", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "資安疑慮",
    occurredAt: "2026-08-01T09:00:00.000Z", reportSource: "監控告警", suggestedSeverity: "影響很大，需要立即處理", isOngoing: "否，目前已恢復", hasWorkaround: "沒有", affectedScope: "x", impactSummary: "x",
  });
  await claimIssueForTeam({ issueId: rcaCase.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  await classifyIncident({ issueId: rcaCase.id, actorId: intakeLead.id, formalSeverity: "高", reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: rcaCase.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  await techLeadClaimAndAssignExecutor({ issueId: rcaCase.id, actorId: rdLeadUser.id, executorUserId: rdExecutor.id, reasonCode: "V" });
  await submitIncidentHandling({ issueId: rcaCase.id, actorId: rdExecutor.id, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRecovery({ issueId: rcaCase.id, actorId: intakeLead.id, confirmResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRcaDecision({ issueId: rcaCase.id, actorId: securityLead.id, needRca: true, reasonCode: "V" });
  const ctxRca = await loadIncidentPageContext(rcaCase.id, intakeLead);
  const reviewRca = await buildIncidentApprovalReviewViewData(ctxRca);
  await expectError(
    "[26] 判定需要 RCA 時，RCA 未結案不得確認事件結案",
    () => confirmIncidentClosure({ issueId: rcaCase.id, approvalRecordId: reviewRca!.approvalRecordId, actorId: intakeLead.id }),
    IncidentRcaNotClosedError,
  );
  const afterRcaBlock = await prisma.issue.findUniqueOrThrow({ where: { id: rcaCase.id } });
  check("[27] 阻擋後事件仍停在待事件結案確認，未被誤結案", afterRcaBlock.workflowStatus === "pendingClosureConfirmation");

  console.log("\n=== H. 責任解析（evaluateCurrentIncidentActorTask） ===");
  const taskIntake = await evaluateCurrentIncidentActorTask(rcaCase.id, intakeLead.id);
  check("[28] 待事件結案確認關卡，受理窗口 LEAD 的 action 為 APPROVE", taskIntake?.action === "APPROVE" && taskIntake.isMineToApprove === true);
  const taskOutsider = await evaluateCurrentIncidentActorTask(rcaCase.id, outsider.id);
  check("[29] 非受理窗口成員的 action 為 VIEW_ONLY", taskOutsider?.action === "VIEW_ONLY");

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
