// 事件通報與 RCA 手動預覽資料冪等種子腳本。只允許對 /tmp/governance-incident-preview.db
// 這種一次性複製自 Hotfix 正式基準（hotfix-ui-preview.db）的 Preview 資料庫執行，絕不寫入
// 正式基準本身或任何受保護 DB（見 scripts/lib/assertSafeTestDatabase.ts 的保護清單）。
//
// 沿用既有正式組織既有人員（Aaron／Tommy／Rita（Preview RD）／Selena 等），只在確實找不到
// 對應角色帳號時才新增「資安推動小組」「DMS 副部長」「DMS 部長」這三個目前正式組織缺口的
// 帳號，不建立任何通用假名（張志豪／李主管等）。重跑本腳本不得產生重複團隊、人員、
// Workflow 定義或工單。
//
//   DATABASE_URL="file:/tmp/governance-incident-preview.db" npx tsx scripts/preview_incident_rca_seed.ts

import { prisma } from "../src/lib/prisma";
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
import { rcaTeamClaim, assignRcaOwner, submitRcaAnalysis, decideRcaTechnicalReview, decideRcaSecurityIntegrityReview } from "../src/lib/workflow-execution/rcaAssignmentService";
import { createRcaActionItem, updateRcaActionItemProgress } from "../src/lib/workflow-execution/rcaActionItemService";

if (process.env.DATABASE_URL !== "file:/tmp/governance-incident-preview.db") {
  throw new Error("本腳本只允許對 DATABASE_URL=file:/tmp/governance-incident-preview.db 執行，避免誤寫其他資料庫");
}

async function ensureUser(name: string, role: string, email: string) {
  const existing = await prisma.user.findFirst({ where: { name } });
  if (existing) return existing;
  const user = await prisma.user.create({ data: { name, email, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function ensureTeamWithLead(name: string, domain: string, leadUserId: string) {
  let team = await prisma.team.findFirst({ where: { name } });
  if (!team) {
    team = await prisma.team.create({ data: { name, domain, isActive: true } });
  }
  const membership = await prisma.teamMember.findFirst({ where: { teamId: team.id, userId: leadUserId } });
  if (!membership) {
    await prisma.teamMember.create({ data: { teamId: team.id, userId: leadUserId, membershipRole: "LEAD", isActive: true } });
  } else if (!membership.isActive || membership.membershipRole !== "LEAD") {
    await prisma.teamMember.update({ where: { id: membership.id }, data: { isActive: true, membershipRole: "LEAD" } });
  }
  return team;
}

async function main() {
  console.log("=== 1. 補齊正式組織缺口團隊／人員（沿用既有人員，僅新增目前缺口角色） ===");
  const aaron = await prisma.user.findFirstOrThrow({ where: { name: "Aaron" } });
  const intakeTeam = await ensureTeamWithLead("事件受理窗口", "INCIDENT", aaron.id);
  console.log("事件受理窗口 LEAD：Aaron（沿用既有品管團隊主管身分）");

  const securityLead = await ensureUser("資安小組長", "資安推動小組", "security-lead@preview.formal-org.invalid");
  const securityTeam = await ensureTeamWithLead("資安推動小組", "SECURITY", securityLead.id);
  console.log("資安推動小組 LEAD：資安小組長（正式組織目前無對應帳號，新增角色頭銜帳號）");

  const vp = await ensureUser("DMS副部長", "PM", "dms-vp@preview.formal-org.invalid");
  await ensureTeamWithLead("DMS 副部長", "MANAGEMENT_VP", vp.id);
  const director = await ensureUser("DMS部長", "PM", "dms-director@preview.formal-org.invalid");
  await ensureTeamWithLead("DMS 部長", "MANAGEMENT_DIRECTOR", director.id);
  console.log("管理階層確認角色：DMS副部長／DMS部長（正式組織目前無對應帳號，新增角色頭銜帳號）");

  console.log("\n=== 2. 發布 Incident／RCA Workflow（若尚未發布唯一正式版本） ===");
  const admin = await prisma.user.findFirstOrThrow({ where: { name: "最高權限管理員" } });
  const incidentPublished = await prisma.workflowVersion.findFirst({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Incident" } } });
  if (!incidentPublished) {
    await buildIncidentWorkflowV1({ actorId: admin.id, reasonCode: "PREVIEW_SEED", keySuffix: "preview-v1" });
    console.log("已發布 Incident Workflow v1");
  } else {
    console.log("Incident Workflow 已存在已發布版本，略過");
  }
  const rcaPublished = await prisma.workflowVersion.findFirst({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "RCA" } } });
  if (!rcaPublished) {
    await buildRcaWorkflowV1({ actorId: admin.id, reasonCode: "PREVIEW_SEED", keySuffix: "preview-v1" });
    console.log("已發布 RCA Workflow v1");
  } else {
    console.log("RCA Workflow 已存在已發布版本，略過");
  }

  console.log("\n=== 3. 建立測試 Incident（已恢復、不需要 RCA，供人工檢視完整流程歷程） ===");
  const selena = await prisma.user.findFirstOrThrow({ where: { name: "Selena" } });
  const tommy = await prisma.user.findFirstOrThrow({ where: { name: "Tommy" } });
  const rdTeam = await prisma.team.findFirstOrThrow({ where: { name: "語音與AI技術" } });
  const rita = await prisma.user.findFirstOrThrow({ where: { name: { contains: "Rita" } } });

  let closedIncident = await prisma.issue.findFirst({ where: { issueType: "Incident", title: { contains: "[Preview] 登入延遲事件（已結案）" } } });
  if (!closedIncident) {
    closedIncident = await createIncidentForActor(selena, {
      title: "[Preview] 登入延遲事件（已結案）",
      description: "多名使用者反映登入頁面回應緩慢，約 10-15 秒才能完成登入。",
      systemName: "MyDMS",
      environment: "Production",
      incidentType: "系統／功能異常",
      occurredAt: "2026-08-01T09:00:00.000Z",
      reportSource: "使用者反映",
      suggestedSeverity: "中",
      isOngoing: false,
      hasWorkaround: false,
      affectedScope: "MyDMS 登入頁面，約 20 名使用者",
      impactSummary: "登入延遲，未造成資料遺失",
    });
    await claimIssueForTeam({ issueId: closedIncident.id, teamId: intakeTeam.id, actorId: aaron.id, reasonCode: "PREVIEW_SEED" });
    await classifyIncident({ issueId: closedIncident.id, actorId: aaron.id, formalSeverity: "中", reasonCode: "PREVIEW_SEED" });
    await assignIncidentTechnicalUnit({ issueId: closedIncident.id, actorId: aaron.id, technicalTeamId: rdTeam.id, reasonCode: "PREVIEW_SEED" });
    await techLeadClaimAndAssignExecutor({ issueId: closedIncident.id, actorId: tommy.id, executorUserId: rita.id, reasonCode: "PREVIEW_SEED" });
    await submitIncidentHandling({
      issueId: closedIncident.id, actorId: rita.id, initialHandling: "重啟登入服務相關容器", recoveryMeasures: "擴充登入服務資源並優化連線池設定",
      recoveryTime: "2026-08-01T10:30:00.000Z", recoveryResult: "已恢復", evidence: "監控儀表板回應時間已恢復正常", reasonCode: "PREVIEW_SEED",
    });
    await confirmIncidentRecovery({ issueId: closedIncident.id, actorId: aaron.id, confirmResult: "已恢復", reasonCode: "PREVIEW_SEED" });
    await confirmIncidentRcaDecision({ issueId: closedIncident.id, actorId: securityLead.id, needRca: false, reason: "影響範圍有限且已於處置階段排除，不需要 RCA", reasonCode: "PREVIEW_SEED" });
    console.log(`已建立測試事件 ${closedIncident.issueKey}（不需要 RCA），等待受理窗口最後確認結案`);
  } else {
    console.log(`測試事件 ${closedIncident.issueKey} 已存在，略過`);
  }

  console.log("\n=== 4. 建立測試 Incident（高等級、需要 RCA，供人工檢視完整 RCA 流程與改善追蹤） ===");
  let rcaSourceIncident = await prisma.issue.findFirst({ where: { issueType: "Incident", title: { contains: "[Preview] 跨單位權限異常事件（需 RCA）" } } });
  let rcaIssue = null as Awaited<ReturnType<typeof prisma.issue.findFirst>>;
  if (!rcaSourceIncident) {
    rcaSourceIncident = await createIncidentForActor(selena, {
      title: "[Preview] 跨單位權限異常事件（需 RCA）",
      description: "跨單位權限設定錯誤，導致部分使用者可存取不應存取的系統模組，已影響對外服務。",
      systemName: "MyDMS",
      environment: "Production",
      incidentType: "權限問題",
      occurredAt: "2026-08-02T14:00:00.000Z",
      reportSource: "資安監控告警",
      suggestedSeverity: "高",
      isOngoing: false,
      hasWorkaround: false,
      affectedScope: "跨單位多個系統模組，涉及對外服務",
      impactSummary: "權限異常已擴大至對外服務，影響客戶可見功能",
    });
    await claimIssueForTeam({ issueId: rcaSourceIncident.id, teamId: intakeTeam.id, actorId: aaron.id, reasonCode: "PREVIEW_SEED" });
    await classifyIncident({ issueId: rcaSourceIncident.id, actorId: aaron.id, formalSeverity: "高", reasonCode: "PREVIEW_SEED" });
    await assignIncidentTechnicalUnit({ issueId: rcaSourceIncident.id, actorId: aaron.id, technicalTeamId: rdTeam.id, reasonCode: "PREVIEW_SEED" });
    await techLeadClaimAndAssignExecutor({ issueId: rcaSourceIncident.id, actorId: tommy.id, executorUserId: rita.id, reasonCode: "PREVIEW_SEED" });
    await submitIncidentHandling({
      issueId: rcaSourceIncident.id, actorId: rita.id, initialHandling: "緊急撤銷異常權限設定", recoveryMeasures: "重新套用正確權限範本並逐一覆核",
      recoveryTime: "2026-08-02T15:00:00.000Z", recoveryResult: "已恢復", evidence: "權限稽核紀錄已覆核完成", reasonCode: "PREVIEW_SEED",
    });
    await confirmIncidentRecovery({ issueId: rcaSourceIncident.id, actorId: aaron.id, confirmResult: "已恢復", reasonCode: "PREVIEW_SEED" });
    await confirmIncidentRcaDecision({ issueId: rcaSourceIncident.id, actorId: securityLead.id, needRca: true, reasonCode: "PREVIEW_SEED" });
    console.log(`已建立測試事件 ${rcaSourceIncident.issueKey}（需要 RCA），已自動建立關聯 RCA`);
  } else {
    console.log(`測試事件 ${rcaSourceIncident.issueKey} 已存在，略過`);
  }

  const relation = await prisma.issueRelation.findFirst({ where: { sourceIssueId: rcaSourceIncident.id, relationType: "INCIDENT_TO_RCA", removedAt: null } });
  if (relation) rcaIssue = await prisma.issue.findUnique({ where: { id: relation.targetIssueId } });

  if (rcaIssue && rcaIssue.workflowStatus === "pendingRcaTeamClaim") {
    console.log("\n=== 5. 推進測試 RCA 至待負責單位主管技術審查（保留多個關卡供人工測試不同身分） ===");
    await rcaTeamClaim({ issueId: rcaIssue.id, actorId: tommy.id, reasonCode: "PREVIEW_SEED" });
    await assignRcaOwner({ issueId: rcaIssue.id, actorId: tommy.id, ownerUserId: rita.id, reasonCode: "PREVIEW_SEED" });
    const item1 = await createRcaActionItem({
      rcaIssueId: rcaIssue.id, actorId: rita.id, type: "CORRECTIVE", description: "重新設計跨單位權限異動雙人審核流程",
      ownerTeamId: rdTeam.id, ownerUserId: rita.id, plannedCompletionDate: "2026-09-01", verificationMethod: "覆查權限異動紀錄與審核簽核", reasonCode: "PREVIEW_SEED",
    });
    await createRcaActionItem({
      rcaIssueId: rcaIssue.id, actorId: rita.id, type: "PREVENTIVE", description: "建立跨單位權限異動季度稽核機制",
      ownerTeamId: rdTeam.id, ownerUserId: rita.id, plannedCompletionDate: "2026-10-15", verificationMethod: "查核季度稽核報告", reasonCode: "PREVIEW_SEED",
    });
    await updateRcaActionItemProgress({ actionItemId: item1.id, actorId: rita.id, status: "IN_PROGRESS", reasonCode: "PREVIEW_SEED" });
    await submitRcaAnalysis({
      issueId: rcaIssue.id, actorId: rita.id, directCause: "權限異動未經雙人審核即生效", rootCause: "跨單位權限審核流程缺乏交叉驗證機制",
      controlFailurePoint: "權限異動審核關卡", causeType: "權限／資料處理問題", analysisMethods: ["會議檢討", "程式碼分析"],
      rcaConclusion: "跨單位權限審核流程需增加交叉驗證與雙人審核機制", actualImpact: "跨單位多個系統模組權限異常，影響對外服務可見功能",
      verificationMethod: "覆查權限異動紀錄與審核簽核流程", reasonCode: "PREVIEW_SEED",
    });
    console.log(`RCA ${rcaIssue.issueKey} 已推進至待負責單位主管技術審查，已建立 2 筆改善措施`);

    console.log("\n=== 6. 技術審查通過，推進至待資安推動小組完整性審查（停在此供人工測試資安小組長身分） ===");
    await decideRcaTechnicalReview({ issueId: rcaIssue.id, actorId: tommy.id, approved: true, comment: "根因分析完整，同意進入完整性審查", reasonCode: "PREVIEW_SEED" });
    console.log(`RCA ${rcaIssue.issueKey} 已推進至待資安推動小組完整性審查`);
  } else if (rcaIssue) {
    console.log(`測試 RCA ${rcaIssue.issueKey} 已推進過（目前關卡：${rcaIssue.workflowStatus}），略過重複推進`);
  }

  console.log("\n=== 完成 ===");
  console.log(`高等級測試 RCA：${rcaIssue?.issueKey ?? "（無）"}（停在待資安推動小組完整性審查，可用「資安小組長」帳號人工測試完整性審查與後續驗證關卡）`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
