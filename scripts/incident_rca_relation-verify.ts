// Incident／RCA 治理關聯（INCIDENT_TO_RCA）targeted verify：驗證 src/lib/issue-relations
// 既有通用服務層本身的關聯語意（方向、唯一性、1:N、解除、查詢方向判斷），與
// rca_workflow-verify.ts 已涵蓋的「RCA 只能由 Incident 需要 RCA 判定觸發建立」互補，
// 不重複測同一件事。
//   npx tsx scripts/incident_rca_relation-verify.ts

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
import {
  createIssueRelationBetweenIssuesForActor,
  getDirectIssueRelationsForActor,
  getRelatedIssuesByTypeForActor,
  removeIssueRelationForActor,
  IssueRelationConflictError,
  IssueRelationValidationError,
} from "../src/lib/issue-relations/service";

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
  await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "RELATION_VERIFY", keySuffix: `relation-verify-incident-${Date.now()}-${process.pid}` });
  await buildRcaWorkflowV1({ actorId: org.admin.id, reasonCode: "RELATION_VERIFY", keySuffix: `relation-verify-rca-${Date.now()}-${process.pid}` });

  const intakeTeam = await prisma.team.create({ data: { name: "事件受理窗口", domain: "INCIDENT", isActive: true } });
  const intakeLead = await createAdHocUser("IntakeLead", "PM", "intake-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: intakeTeam.id, userId: intakeLead.id, membershipRole: "LEAD", isActive: true } });

  const securityTeam = await prisma.team.create({ data: { name: "資安推動小組", domain: "SECURITY", isActive: true } });
  const securityLead = await createAdHocUser("SecurityLead", "資安推動小組", "security-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: securityTeam.id, userId: securityLead.id, membershipRole: "LEAD", isActive: true } });

  const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
  const rdLeadInfo = org.personByKey.get("tommy")!;
  const rdLead = await prisma.user.findUniqueOrThrow({ where: { id: rdLeadInfo.id } });
  const rdExecutor = await createAdHocUser("RdExecutor3", "RD", "rd-executor3@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdExecutor.id, membershipRole: "MEMBER", isActive: true } });

  const reporterInfo = org.personByKey.get("selena")!;
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: reporterInfo.id } });

  console.log("\n=== A. 建立一筆 Incident 並判定需要 RCA（自動建立第一筆關聯 RCA） ===");
  const incident = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 關聯測試事件", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "資安疑慮",
    occurredAt: "2026-08-01T09:00:00.000Z", occurredAtUncertain: false, reportSource: "監控告警", suggestedSeverity: "影響很大，需要立即處理",
    isOngoing: "否，目前已恢復", hasWorkaround: "沒有",
  });
  await claimIssueForTeam({ issueId: incident.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  await classifyIncident({ issueId: incident.id, actorId: intakeLead.id, formalSeverity: "高", reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: incident.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  await techLeadClaimAndAssignExecutor({ issueId: incident.id, actorId: rdLead.id, executorUserId: rdExecutor.id, reasonCode: "V" });
  await submitIncidentHandling({ issueId: incident.id, actorId: rdExecutor.id, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRecovery({ issueId: incident.id, actorId: intakeLead.id, confirmResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRcaDecision({ issueId: incident.id, actorId: securityLead.id, needRca: true, reasonCode: "V" });

  const relationsAfterFirst = await getDirectIssueRelationsForActor(intakeLead.id, incident.id);
  check("[1] 自動建立的關聯方向正確（Incident 為來源）", relationsAfterFirst.length === 1 && relationsAfterFirst[0].sourceIssueId === incident.id);
  check("[2] 關聯類型為 INCIDENT_TO_RCA", relationsAfterFirst[0]?.relationType === "INCIDENT_TO_RCA");
  const firstRca = relationsAfterFirst[0].targetIssue;
  check("[2b] 目標為 RCA 類型工單", firstRca.issueType === "RCA");

  console.log("\n=== B. 手動建立第二筆獨立 RCA 並人工關聯到同一個 Incident（驗證 1:N） ===");
  const secondRcaIncident = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 第二個來源事件（借用建立第二筆 RCA）", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "資安疑慮",
    occurredAt: "2026-08-01T09:00:00.000Z", occurredAtUncertain: false, reportSource: "監控告警", suggestedSeverity: "影響很大，需要立即處理",
    isOngoing: "否，目前已恢復", hasWorkaround: "沒有",
  });
  await claimIssueForTeam({ issueId: secondRcaIncident.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  await classifyIncident({ issueId: secondRcaIncident.id, actorId: intakeLead.id, formalSeverity: "高", reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: secondRcaIncident.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  await techLeadClaimAndAssignExecutor({ issueId: secondRcaIncident.id, actorId: rdLead.id, executorUserId: rdExecutor.id, reasonCode: "V" });
  await submitIncidentHandling({ issueId: secondRcaIncident.id, actorId: rdExecutor.id, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRecovery({ issueId: secondRcaIncident.id, actorId: intakeLead.id, confirmResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRcaDecision({ issueId: secondRcaIncident.id, actorId: securityLead.id, needRca: true, reasonCode: "V" });
  const secondRelation = (await getDirectIssueRelationsForActor(intakeLead.id, secondRcaIncident.id))[0];
  const secondRca = secondRelation.targetIssue;

  await createIssueRelationBetweenIssuesForActor(intakeLead.id, incident.id, secondRca.id);
  const relationsAfterSecond = await getDirectIssueRelationsForActor(intakeLead.id, incident.id);
  check("[3] 同一 Incident 現在有 2 筆有效 INCIDENT_TO_RCA 關聯（1:N）", relationsAfterSecond.filter((r) => r.relationType === "INCIDENT_TO_RCA").length === 2);

  console.log("\n=== C. 重複建立相同關聯應被拒絕（唯一性） ===");
  await expectError(
    "[4] 對已存在的有效關聯重複建立，明確拒絕",
    () => createIssueRelationBetweenIssuesForActor(intakeLead.id, incident.id, firstRca.id),
    IssueRelationConflictError,
  );

  console.log("\n=== D. 關聯不可指向自己 ===");
  await expectError(
    "[5] Incident 關聯自己，明確拒絕",
    () => createIssueRelationBetweenIssuesForActor(intakeLead.id, incident.id, incident.id),
    IssueRelationValidationError,
  );

  console.log("\n=== E. 依關聯類型查詢方向正確 ===");
  const rcaSideRelations = await getRelatedIssuesByTypeForActor(intakeLead.id, firstRca.id, "INCIDENT_TO_RCA");
  check("[6] 從 RCA 那一端查詢，方向判斷為 INCOMING", rcaSideRelations.length === 1 && rcaSideRelations[0].direction === "INCOMING");
  check("[6b] 從 RCA 那一端查詢，對方工單是來源 Incident", rcaSideRelations[0].issue.id === incident.id);

  console.log("\n=== F. 解除關聯 ===");
  const toRemove = relationsAfterSecond.find((r) => r.targetIssue.id === secondRca.id)!;
  await removeIssueRelationForActor(intakeLead.id, { relationId: toRemove.id, removalReason: "測試解除關聯" });
  const relationsAfterRemoval = await getDirectIssueRelationsForActor(intakeLead.id, incident.id);
  check("[7] 解除後有效關聯數回到 1 筆", relationsAfterRemoval.filter((r) => r.relationType === "INCIDENT_TO_RCA").length === 1);
  const relationsIncludingRemoved = await getDirectIssueRelationsForActor(intakeLead.id, incident.id, { includeRemoved: true });
  check("[8] 含已解除關聯查詢仍看得到歷史紀錄（removedAt 有值）", relationsIncludingRemoved.some((r) => r.id === toRemove.id && r.removedAt !== null));

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
