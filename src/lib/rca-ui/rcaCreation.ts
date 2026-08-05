// RCA 建立：唯一合法入口是「Incident RCA 啟動判定＝需要 RCA」，不提供任何手動／空白 RCA
// 建立 UI 或 API（見任務規格第十三節）。呼叫端固定是
// src/lib/workflow-execution/incidentAssignmentService.ts 的 confirmIncidentRcaDecision，
// 在同一次判定內、資安推動小組核准「需要 RCA」時觸發本函式。
//
// 沿用 src/lib/incident-ui/incidentCreation.ts 既有「同一 transaction 內建立 Issue＋啟動
// Workflow＋送出第一關」模式；來源 Incident 的事件編號／名稱／等級／摘要／系統／服務／
// 實際影響／處理單位一併帶入 IssueFieldValue，並透過既有 issue-relations 服務建立正式
// INCIDENT_TO_RCA 關聯（RCA 可以是 1:N，一個 Incident 可以有多筆 RCA）。

import type { Prisma } from "@prisma/client";
import { allocateNextIssueKey } from "../issue-key-sequence";
import { resolveUniqueAutoStartVersionForIssueType, startWorkflowForIssueSystemTx } from "../workflowExecutionService";
import { executeIssueTransitionInTx } from "../workflow-execution/transitionService";
import { createIssueRelationInTx } from "../issue-relations/service";

// 直接讀取 IssueFieldValue，不依賴 incidentAssignmentService.ts（避免與該檔案的
// import 形成循環相依——本函式改由 incidentAssignmentService.ts 呼叫）。
const INCIDENT_TECHNICAL_TEAM_FIELD_KEY = "incidentTechnicalTeamId";
async function readIncidentField(tx: Prisma.TransactionClient, issueId: string, fieldKey: string): Promise<string | null> {
  const row = await tx.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId, fieldKey } } });
  return row?.fieldValue || null;
}

export class RcaCreationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RcaCreationValidationError";
  }
}

async function writeRcaField(tx: Prisma.TransactionClient, issueId: string, fieldKey: string, fieldLabel: string, fieldValue: string) {
  if (!fieldValue.trim()) return;
  await tx.issueFieldValue.create({ data: { issueId, fieldKey, fieldLabel, fieldValue: fieldValue.trim() } });
}

export const RCA_SOURCE_INCIDENT_KEY_FIELD = "rcaSourceIncidentKey";
export const RCA_SOURCE_INCIDENT_NAME_FIELD = "rcaSourceIncidentName";
export const RCA_SOURCE_INCIDENT_SEVERITY_FIELD = "rcaSourceIncidentSeverity";
export const RCA_SOURCE_INCIDENT_SUMMARY_FIELD = "rcaSourceIncidentSummary";
export const RCA_RESPONSIBLE_UNIT_FIELD = "rcaResponsibleUnitTeamId";
export const RCA_PLANNED_COMPLETION_DATE_FIELD = "rcaPlannedCompletionDate";

export interface CreateRcaFromIncidentInput {
  incidentIssueId: string;
  actorId: string;
  reasonCode: string;
  plannedCompletionDate?: string;
}

export async function createRcaFromIncidentInTx(tx: Prisma.TransactionClient, input: CreateRcaFromIncidentInput) {
  const incident = await tx.issue.findUnique({ where: { id: input.incidentIssueId } });
  if (!incident || incident.issueType !== "Incident") {
    throw new RcaCreationValidationError("找不到來源事件通報，無法建立 RCA");
  }

  const technicalTeamId = await readIncidentField(tx, incident.id, INCIDENT_TECHNICAL_TEAM_FIELD_KEY);
  if (!technicalTeamId) {
    throw new RcaCreationValidationError("來源事件尚未指派處理技術單位，無法建立 RCA");
  }

  const versionToStart = await resolveUniqueAutoStartVersionForIssueType("RCA");
  if (!versionToStart) {
    throw new RcaCreationValidationError("找不到唯一已發布的 RCA Workflow 版本，無法建立 RCA");
  }

  const issueKey = await allocateNextIssueKey(tx, "RCA");
  const created = await tx.issue.create({
    data: {
      issueKey,
      issueType: "RCA",
      title: `RCA：${incident.title}`,
      description: incident.description,
      systemName: incident.systemName,
      environment: incident.environment,
      reporter: "系統（由事件通報自動建立）",
      reporterUserId: input.actorId,
      assignedTeamId: technicalTeamId,
      riskLevel: incident.riskLevel,
      workflowStatus: "rcaCreated",
    },
  });

  await writeRcaField(tx, created.id, RCA_SOURCE_INCIDENT_KEY_FIELD, "來源事件編號", incident.issueKey);
  await writeRcaField(tx, created.id, RCA_SOURCE_INCIDENT_NAME_FIELD, "來源事件名稱", incident.title);
  if (incident.riskLevel) await writeRcaField(tx, created.id, RCA_SOURCE_INCIDENT_SEVERITY_FIELD, "來源事件等級", incident.riskLevel);
  await writeRcaField(tx, created.id, RCA_SOURCE_INCIDENT_SUMMARY_FIELD, "來源事件摘要", incident.description);
  await writeRcaField(tx, created.id, RCA_RESPONSIBLE_UNIT_FIELD, "RCA 負責單位", technicalTeamId);
  if (input.plannedCompletionDate?.trim()) {
    await writeRcaField(tx, created.id, RCA_PLANNED_COMPLETION_DATE_FIELD, "預定完成日期", input.plannedCompletionDate.trim());
  }

  await startWorkflowForIssueSystemTx(tx, {
    issueId: created.id,
    workflowVersionId: versionToStart.id,
    actorId: input.actorId,
    reasonCode: input.reasonCode || "RCA_CREATED_FROM_INCIDENT",
  });

  const stageAfterStart = await tx.issue.findUniqueOrThrow({ where: { id: created.id } });
  const forwardTransitions = await tx.workflowTransition.findMany({
    where: { workflowVersionId: versionToStart.id, fromStageId: stageAfterStart.currentWorkflowStageId!, transitionType: "FORWARD" },
  });
  if (forwardTransitions.length !== 1) {
    throw new RcaCreationValidationError("RCA 流程的送出路徑不唯一或不存在，無法自動送出待承接");
  }
  await executeIssueTransitionInTx(tx, {
    issueId: created.id,
    transitionId: forwardTransitions[0].id,
    actorId: input.actorId,
    reasonCode: input.reasonCode || "RCA_CREATED_FROM_INCIDENT",
  });

  await createIssueRelationInTx(
    input.actorId,
    { sourceIssueId: incident.id, targetIssueId: created.id, relationType: "INCIDENT_TO_RCA" },
    tx,
  );

  return tx.issue.findUniqueOrThrow({ where: { id: created.id } });
}
