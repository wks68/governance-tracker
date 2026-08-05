// Incident／RCA 責任解析與待辦通知 targeted verify：驗證
// src/lib/rca-ui/rcaResponsibilityService.ts（evaluateCurrentRcaActorTask）本身，以及
// src/lib/workflow-execution/actionabilityService.ts／notificationService.ts 是否正確把
// RCA 納入 Bell／我的待辦（本輪擴充前 SUPPORTED_ISSUE_TYPES 只有 Hotfix／Incident，不含
// RCA，需要驗證這個回歸修正）。
//   npx tsx scripts/incident_rca_responsibility-verify.ts

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
} from "../src/lib/workflow-execution/incidentAssignmentService";
import { rcaTeamClaim, assignRcaOwner } from "../src/lib/workflow-execution/rcaAssignmentService";
import { evaluateCurrentRcaActorTask } from "../src/lib/rca-ui/rcaResponsibilityService";
import { resolveIssueTasksForActor, listActionableTasksForActor } from "../src/lib/workflow-execution/actionabilityService";
import { listWorkflowTaskNotificationsForActor } from "../src/lib/workflow-execution/notificationService";

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

async function createAdHocUser(name: string, role: string, email: string) {
  const user = await prisma.user.create({ data: { name, email, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

const BASE_INTAKE_FIELDS = {
  symptomText: "服務回應緩慢",
  impactScope: "SINGLE_USER",
  dataPermissionImpact: ["不確定"],
  operationalImpact: ["不確定"],
};

async function main() {
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Incident" } }, data: { status: "ARCHIVED" } });
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "RCA" } }, data: { status: "ARCHIVED" } });
  await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "RESPONSIBILITY_VERIFY", keySuffix: `resp-verify-incident-${Date.now()}-${process.pid}` });
  await buildRcaWorkflowV1({ actorId: org.admin.id, reasonCode: "RESPONSIBILITY_VERIFY", keySuffix: `resp-verify-rca-${Date.now()}-${process.pid}` });

  const intakeTeam = await prisma.team.create({ data: { name: "事件受理窗口", domain: "INCIDENT", isActive: true } });
  const intakeLead = await createAdHocUser("IntakeLead", "PM", "intake-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: intakeTeam.id, userId: intakeLead.id, membershipRole: "LEAD", isActive: true } });

  const securityTeam = await prisma.team.create({ data: { name: "資安推動小組", domain: "SECURITY", isActive: true } });
  const securityLead = await createAdHocUser("SecurityLead", "資安推動小組", "security-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: securityTeam.id, userId: securityLead.id, membershipRole: "LEAD", isActive: true } });

  const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
  const rdLeadInfo = org.personByKey.get("tommy")!;
  const rdLead = await prisma.user.findUniqueOrThrow({ where: { id: rdLeadInfo.id } });
  const rdExecutor = await createAdHocUser("RdExecutor4", "RD", "rd-executor4@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdExecutor.id, membershipRole: "MEMBER", isActive: true } });
  const rcaOwner = await createAdHocUser("RcaOwner2", "RD", "rca-owner2@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rcaOwner.id, membershipRole: "MEMBER", isActive: true } });

  const reporterInfo = org.personByKey.get("selena")!;
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: reporterInfo.id } });
  const outsiderInfo = org.personByKey.get("jonus")!;
  const outsider = await prisma.user.findUniqueOrThrow({ where: { id: outsiderInfo.id } });

  console.log("\n=== A. 建立 Incident 並判定需要 RCA ===");
  const incident = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 責任解析測試事件", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "資安疑慮",
    occurredAt: "2026-08-01T09:00:00.000Z", occurredAtUncertain: false, reportSource: "監控告警", suggestedSeverity: "影響很大，需要立即處理",
    isOngoing: "否，目前已恢復", hasWorkaround: "沒有",
  });
  await claimIssueForTeam({ issueId: incident.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  await classifyIncident({ issueId: incident.id, actorId: intakeLead.id, formalSeverity: "低", reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: incident.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  await techLeadClaimAndAssignExecutor({ issueId: incident.id, actorId: rdLead.id, executorUserId: rdExecutor.id, reasonCode: "V" });
  await submitIncidentHandling({ issueId: incident.id, actorId: rdExecutor.id, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRecovery({ issueId: incident.id, actorId: intakeLead.id, confirmResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRcaDecision({ issueId: incident.id, actorId: securityLead.id, needRca: true, reasonCode: "V" });

  const relation = await prisma.issueRelation.findFirstOrThrow({ where: { sourceIssueId: incident.id, relationType: "INCIDENT_TO_RCA", removedAt: null } });
  const rca = await prisma.issue.findUniqueOrThrow({ where: { id: relation.targetIssueId } });

  console.log("\n=== B. evaluateCurrentRcaActorTask：待負責單位主管承接 ===");
  const taskAtClaim = await evaluateCurrentRcaActorTask(rca.id, rdLead.id);
  check("[1] 負責單位 LEAD 於承接關卡 action 為 CLAIM", taskAtClaim?.action === "CLAIM" && taskAtClaim.isMineToClaim === true);
  const outsiderAtClaim = await evaluateCurrentRcaActorTask(rca.id, outsider.id);
  check("[2] 非負責單位成員於承接關卡 action 為 VIEW_ONLY", outsiderAtClaim?.action === "VIEW_ONLY");

  await rcaTeamClaim({ issueId: rca.id, actorId: rdLead.id, reasonCode: "V" });

  console.log("\n=== C. evaluateCurrentRcaActorTask：待指派 RCA 主責人 ===");
  const taskAtAssignment = await evaluateCurrentRcaActorTask(rca.id, rdLead.id);
  check("[3] 負責單位 LEAD 於指派主責人關卡 action 為 ENTER_WORK", taskAtAssignment?.action === "ENTER_WORK");

  await assignRcaOwner({ issueId: rca.id, actorId: rdLead.id, ownerUserId: rcaOwner.id, reasonCode: "V" });

  console.log("\n=== D. evaluateCurrentRcaActorTask：根因分析中（責任人是主責人本人，非整個團隊） ===");
  const taskOwner = await evaluateCurrentRcaActorTask(rca.id, rcaOwner.id);
  check("[4] RCA 主責人於分析關卡 action 為 ENTER_WORK", taskOwner?.action === "ENTER_WORK");
  const taskOtherMember = await evaluateCurrentRcaActorTask(rca.id, rdExecutor.id);
  check("[5] 同團隊但非主責人的成員於分析關卡 action 為 VIEW_ONLY", taskOtherMember?.action === "VIEW_ONLY");

  console.log("\n=== E. Bell／我的待辦：RCA 現在會被 listActionableTasksForActor 納入（回歸修正驗證） ===");
  const actionableForOwner = await listActionableTasksForActor(rcaOwner.id);
  const rcaTask = actionableForOwner.find((t) => t.issueId === rca.id);
  check("[6] listActionableTasksForActor 現在包含 RCA 待辦", Boolean(rcaTask));
  check("[6b] 待辦的 issueType 正確標示為 RCA", rcaTask?.issueType === "RCA");

  const resolvedTasks = await resolveIssueTasksForActor(rcaOwner.id, [
    { id: rca.id, issueKey: rca.issueKey, title: rca.title, issueType: rca.issueType, workflowVersionId: rca.workflowVersionId, currentWorkflowStageId: rca.currentWorkflowStageId, stageEnteredAt: rca.stageEnteredAt },
  ]);
  check("[7] resolveIssueTasksForActor 對 RCA 回傳的 summary.action 為 ENTER_WORK", resolvedTasks.get(rca.id)?.summary.action === "ENTER_WORK");

  console.log("\n=== F. Bell 通知型別：RCA 使用 RCA_ACTION_REQUIRED／RCA_APPROVAL_REQUIRED，不是 Hotfix 型別 ===");
  const notifications = await listWorkflowTaskNotificationsForActor(rcaOwner.id);
  const rcaNotification = notifications.find((n) => n.issueId === rca.id);
  check("[8] RCA 待辦通知型別為 RCA_ACTION_REQUIRED（非 HOTFIX_*）", rcaNotification?.notificationType === "RCA_ACTION_REQUIRED");
  check("[8b] 通知標題不是 Hotfix 用語", rcaNotification?.notificationTitle === "新的 RCA 待辦");

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
