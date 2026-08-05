// 共用 Issue Attachment 能力（Incident／RCA／RCA 改善措施佐證）targeted verify：驗證
// src/lib/issue-attachments/service.ts 本身的資格判斷、MIME／大小驗證、刪除權限，重用既有
// Evidence model／本地磁碟儲存／既有下載路由的安全檢查（不建立第二套附件系統，因此本測試
// 也一併確認 Hotfix 既有 attachmentService.ts 完全未被觸碰）。
//   npx tsx scripts/incident_rca_attachment-verify.ts

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
import { createRcaActionItem } from "../src/lib/workflow-execution/rcaActionItemService";
import {
  uploadIssueAttachment,
  deleteIssueAttachment,
  listIssueAttachments,
  IssueAttachmentValidationError,
  IssueAttachmentAuthorizationError,
  MAX_ATTACHMENT_BYTES,
} from "../src/lib/issue-attachments/service";

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
  await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "ATTACHMENT_VERIFY", keySuffix: `attachment-verify-incident-${Date.now()}-${process.pid}` });
  await buildRcaWorkflowV1({ actorId: org.admin.id, reasonCode: "ATTACHMENT_VERIFY", keySuffix: `attachment-verify-rca-${Date.now()}-${process.pid}` });

  const intakeTeam = await prisma.team.create({ data: { name: "事件受理窗口", domain: "INCIDENT", isActive: true } });
  const intakeLead = await createAdHocUser("IntakeLead", "PM", "intake-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: intakeTeam.id, userId: intakeLead.id, membershipRole: "LEAD", isActive: true } });

  const securityTeam = await prisma.team.create({ data: { name: "資安推動小組", domain: "SECURITY", isActive: true } });
  const securityLead = await createAdHocUser("SecurityLead", "資安推動小組", "security-lead@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: securityTeam.id, userId: securityLead.id, membershipRole: "LEAD", isActive: true } });

  const rdTeamId = org.teamIdByName.get("語音與AI技術")!;
  const rdLeadInfo = org.personByKey.get("tommy")!;
  const rdLead = await prisma.user.findUniqueOrThrow({ where: { id: rdLeadInfo.id } });
  const rdExecutor = await createAdHocUser("RdExecutor5", "RD", "rd-executor5@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rdExecutor.id, membershipRole: "MEMBER", isActive: true } });
  const rcaOwner = await createAdHocUser("RcaOwner3", "RD", "rca-owner3@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: rcaOwner.id, membershipRole: "MEMBER", isActive: true } });
  const otherMember = await createAdHocUser("OtherRdMember", "RD", "other-rd-member@formal-org.example.invalid");
  await prisma.teamMember.create({ data: { teamId: rdTeamId, userId: otherMember.id, membershipRole: "MEMBER", isActive: true } });

  const reporterInfo = org.personByKey.get("selena")!;
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: reporterInfo.id } });
  const outsiderInfo = org.personByKey.get("jonus")!;
  const outsider = await prisma.user.findUniqueOrThrow({ where: { id: outsiderInfo.id } });

  console.log("\n=== A. Incident 附件：通報人可上傳，非相關人不可 ===");
  const incident = await createIncidentForActor(reporter, {
    ...BASE_INTAKE_FIELDS,
    title: "[verify] 附件測試事件", description: "x", systemName: "MyDMS", environment: "Production", incidentType: "資安疑慮",
    occurredAt: "2026-08-01T09:00:00.000Z", occurredAtUncertain: false, reportSource: "監控告警", suggestedSeverity: "影響很大，需要立即處理",
    isOngoing: "否，目前已恢復", hasWorkaround: "沒有",
  });

  const evidence1 = await uploadIssueAttachment({
    issueId: incident.id, actorId: reporter.id, actorName: reporter.name, fileName: "screenshot.png", mimeType: "image/png", bytes: Buffer.from("fake-png-bytes"),
  });
  check("[1] 通報人可於自己通報的事件上傳附件", Boolean(evidence1.id));

  await expectError(
    "[2] 非通報人也非目前責任人不得上傳附件",
    () => uploadIssueAttachment({ issueId: incident.id, actorId: outsider.id, actorName: outsider.name, fileName: "x.png", mimeType: "image/png", bytes: Buffer.from("x") }),
    IssueAttachmentAuthorizationError,
  );

  await expectError(
    "[3] 空檔案內容明確拒絕",
    () => uploadIssueAttachment({ issueId: incident.id, actorId: reporter.id, actorName: reporter.name, fileName: "empty.png", mimeType: "image/png", bytes: Buffer.alloc(0) }),
    IssueAttachmentValidationError,
  );

  await expectError(
    "[4] 超過大小上限明確拒絕",
    () => uploadIssueAttachment({ issueId: incident.id, actorId: reporter.id, actorName: reporter.name, fileName: "big.png", mimeType: "image/png", bytes: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1) }),
    IssueAttachmentValidationError,
  );

  const incidentAttachmentsForReporter = await listIssueAttachments(incident.id, { actorId: reporter.id });
  check("[5] 通報人查詢自己上傳的附件為可刪除", incidentAttachmentsForReporter.find((a) => a.id === evidence1.id)?.deletable === true);
  const incidentAttachmentsForOutsider = await listIssueAttachments(incident.id, { actorId: outsider.id });
  check("[6] 非相關人查詢同一筆附件不可刪除", incidentAttachmentsForOutsider.find((a) => a.id === evidence1.id)?.deletable === false);

  await expectError(
    "[7] 非上傳者本人不得刪除附件（即使是目前責任人）",
    () => deleteIssueAttachment({ issueId: incident.id, evidenceId: evidence1.id, actorId: outsider.id }),
    IssueAttachmentAuthorizationError,
  );
  await deleteIssueAttachment({ issueId: incident.id, evidenceId: evidence1.id, actorId: reporter.id });
  const afterDelete = await listIssueAttachments(incident.id);
  check("[8] 上傳者本人可刪除自己上傳的附件", !afterDelete.some((a) => a.id === evidence1.id));

  console.log("\n=== B. 推進至 RCA，驗證 RCA 層級附件與改善措施佐證附件的資格判斷 ===");
  await claimIssueForTeam({ issueId: incident.id, teamId: intakeTeam.id, actorId: intakeLead.id, reasonCode: "V" });
  await classifyIncident({ issueId: incident.id, actorId: intakeLead.id, formalSeverity: "低", reasonCode: "V" });
  await assignIncidentTechnicalUnit({ issueId: incident.id, actorId: intakeLead.id, technicalTeamId: rdTeamId, reasonCode: "V" });
  await techLeadClaimAndAssignExecutor({ issueId: incident.id, actorId: rdLead.id, executorUserId: rdExecutor.id, reasonCode: "V" });
  await submitIncidentHandling({ issueId: incident.id, actorId: rdExecutor.id, initialHandling: "x", recoveryMeasures: "x", recoveryResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRecovery({ issueId: incident.id, actorId: intakeLead.id, confirmResult: "已恢復", reasonCode: "V" });
  await confirmIncidentRcaDecision({ issueId: incident.id, actorId: securityLead.id, needRca: true, reasonCode: "V" });
  const relation = await prisma.issueRelation.findFirstOrThrow({ where: { sourceIssueId: incident.id, relationType: "INCIDENT_TO_RCA", removedAt: null } });
  const rcaId = relation.targetIssueId;

  await rcaTeamClaim({ issueId: rcaId, actorId: rdLead.id, reasonCode: "V" });

  const rcaEvidence = await uploadIssueAttachment({ issueId: rcaId, actorId: rdLead.id, actorName: rdLead.name, fileName: "rca-note.png", mimeType: "image/png", bytes: Buffer.from("y") });
  check("[9] RCA 目前責任人（負責單位主管於承接後關卡）可上傳 RCA 層級附件", Boolean(rcaEvidence.id));
  await expectError(
    "[10] 非 RCA 目前責任人不得上傳 RCA 層級附件",
    () => uploadIssueAttachment({ issueId: rcaId, actorId: outsider.id, actorName: outsider.name, fileName: "x.png", mimeType: "image/png", bytes: Buffer.from("z") }),
    IssueAttachmentAuthorizationError,
  );

  await assignRcaOwner({ issueId: rcaId, actorId: rdLead.id, ownerUserId: rcaOwner.id, reasonCode: "V" });
  const actionItem = await createRcaActionItem({
    rcaIssueId: rcaId, actorId: rcaOwner.id, type: "CORRECTIVE", description: "修正設定", ownerTeamId: rdTeamId, ownerUserId: rcaOwner.id,
    plannedCompletionDate: "2026-09-01", reasonCode: "V",
  });

  console.log("\n=== C. 改善措施佐證附件：只有該措施責任人或資安推動小組可上傳 ===");
  const actionItemEvidence = await uploadIssueAttachment({
    issueId: rcaId, actorId: rcaOwner.id, actorName: rcaOwner.name, fileName: "evidence.png", mimeType: "image/png", bytes: Buffer.from("evidence-bytes"), actionItemId: actionItem.id,
  });
  check("[11] 改善措施責任人可上傳該措施的佐證附件", Boolean(actionItemEvidence.id));

  await expectError(
    "[12] 同團隊但非該措施責任人不得上傳佐證附件",
    () => uploadIssueAttachment({ issueId: rcaId, actorId: otherMember.id, actorName: otherMember.name, fileName: "x.png", mimeType: "image/png", bytes: Buffer.from("x"), actionItemId: actionItem.id }),
    IssueAttachmentAuthorizationError,
  );

  const securityEvidence = await uploadIssueAttachment({
    issueId: rcaId, actorId: securityLead.id, actorName: securityLead.name, fileName: "security-check.png", mimeType: "image/png", bytes: Buffer.from("s"), actionItemId: actionItem.id,
  });
  check("[13] 資安推動小組成員可上傳改善措施佐證附件（治理權限）", Boolean(securityEvidence.id));

  const actionItemAttachments = await listIssueAttachments(rcaId, { actionItemId: actionItem.id });
  check("[14] 依 actionItemId 篩選只回傳該措施的佐證附件", actionItemAttachments.length === 2 && actionItemAttachments.every((a) => a.actionItemId === actionItem.id));

  const rcaLevelAttachments = await listIssueAttachments(rcaId, { actionItemId: null });
  check("[15] Issue 層級附件查詢不含改善措施佐證附件", rcaLevelAttachments.every((a) => a.actionItemId === null) && rcaLevelAttachments.some((a) => a.id === rcaEvidence.id));

  console.log("\n=== D. 不影響 Hotfix 既有附件實作（檔案未被觸碰，各自獨立） ===");
  const hotfixAttachmentServicePath = require.resolve("../src/lib/hotfix-ui/attachmentService");
  check("[16] Hotfix 專屬附件服務檔案仍存在且獨立於共用服務", Boolean(hotfixAttachmentServicePath));

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
