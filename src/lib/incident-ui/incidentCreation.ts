// Incident 事件通報流程：建立事件（F01）＋自動送出待承接，比照
// src/lib/issueCreation.ts 既有「同一 transaction 內建立＋啟動 Workflow＋送出第一關」模式，
// 但刻意精簡（不含 Hotfix 特有的富文字／附件／治理關聯欄位處理），只服務 Incident 自己的
// 資料需求。共用的底層原語（allocateNextIssueKey／resolveUniqueAutoStartVersionForIssueType／
// startWorkflowForIssueSystemTx／executeIssueTransitionInTx）完全相同，不建立第二套流程引擎。

import { prisma } from "../prisma";
import type { Prisma, User } from "@prisma/client";
import { allocateNextIssueKey } from "../issue-key-sequence";
import { resolveUniqueAutoStartVersionForIssueType, startWorkflowForIssueSystemTx, executeIssueTransitionInTx } from "../workflowExecutionService";
import { ENVIRONMENTS, SYSTEM_NAME_OPTIONS, RISK_LEVELS } from "../constants";

export class IncidentCreationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentCreationValidationError";
  }
}

const INCIDENT_TYPES = ["系統／功能異常", "服務中斷", "資安事件", "權限問題", "資料問題", "Hotfix", "部署／上線", "稽核缺失", "其他"];

export interface CreateIncidentInput {
  title: string;
  description: string;
  systemName: string;
  environment: string;
  incidentType: string;
  occurredAt: string; // ISO
  reportSource: string;
  suggestedSeverity: string;
  isOngoing: boolean;
  hasWorkaround: boolean;
  affectedScope: string;
  impactSummary: string;
}

function required(value: string, label: string, issues: string[]) {
  if (!value.trim()) issues.push(`${label}不得為空`);
}

async function writeField(tx: Prisma.TransactionClient, issueId: string, fieldKey: string, fieldLabel: string, fieldValue: string) {
  if (!fieldValue.trim()) return;
  await tx.issueFieldValue.create({ data: { issueId, fieldKey, fieldLabel, fieldValue: fieldValue.trim() } });
}

export async function createIncidentForActor(actor: User, input: CreateIncidentInput) {
  if (!actor.isActive) throw new IncidentCreationValidationError("帳號已停用，無法建立事件通報");

  const issues: string[] = [];
  required(input.title, "事件名稱", issues);
  required(input.description, "事件摘要", issues);
  if (!SYSTEM_NAME_OPTIONS.includes(input.systemName as (typeof SYSTEM_NAME_OPTIONS)[number])) issues.push("系統名稱必須是既有值域之一");
  if (!ENVIRONMENTS.includes(input.environment)) issues.push("環境必須是既有值域之一");
  if (!INCIDENT_TYPES.includes(input.incidentType)) issues.push("事件類型必須是既有值域之一");
  if (!RISK_LEVELS.includes(input.suggestedSeverity)) issues.push("建議事件等級必須是高／中／低");
  required(input.occurredAt, "事件發生時間", issues);
  required(input.reportSource, "通報來源", issues);
  if (issues.length > 0) throw new IncidentCreationValidationError(issues.join("；"));

  const versionToStart = await resolveUniqueAutoStartVersionForIssueType("Incident");
  if (!versionToStart) {
    throw new IncidentCreationValidationError("找不到唯一已發布的 Incident Workflow 版本，無法建立事件");
  }

  return prisma.$transaction(async (tx) => {
    const issueKey = await allocateNextIssueKey(tx, "Incident");
    const created = await tx.issue.create({
      data: {
        issueKey,
        issueType: "Incident",
        title: input.title.trim(),
        description: input.description.trim(),
        systemName: input.systemName,
        environment: input.environment,
        reporter: actor.name,
        reporterUserId: actor.id,
        workflowStatus: "reported",
      },
    });

    await writeField(tx, created.id, "incidentType", "事件類型", input.incidentType);
    await writeField(tx, created.id, "incidentOccurredAt", "事件發生時間", input.occurredAt);
    await writeField(tx, created.id, "incidentReportSource", "通報來源", input.reportSource);
    await writeField(tx, created.id, "incidentSuggestedSeverity", "建議事件等級", input.suggestedSeverity);
    await writeField(tx, created.id, "incidentIsOngoing", "問題是否仍持續", input.isOngoing ? "是" : "否");
    await writeField(tx, created.id, "incidentHasWorkaround", "是否有替代方案", input.hasWorkaround ? "是" : "否");
    await writeField(tx, created.id, "incidentAffectedScope", "受影響系統／功能／使用者／資料權限", input.affectedScope);
    await writeField(tx, created.id, "incidentImpactSummary", "初步營運影響", input.impactSummary);

    await startWorkflowForIssueSystemTx(tx, {
      issueId: created.id,
      workflowVersionId: versionToStart.id,
      actorId: actor.id,
      reasonCode: "ISSUE_CREATED_AUTO_START",
    });

    const forwardTransitions = await tx.workflowTransition.findMany({
      where: { workflowVersionId: versionToStart.id, fromStageId: (await tx.issue.findUniqueOrThrow({ where: { id: created.id } })).currentWorkflowStageId!, transitionType: "FORWARD" },
    });
    if (forwardTransitions.length !== 1) {
      throw new IncidentCreationValidationError("此事件流程的送出路徑不唯一或不存在，無法自動送出待承接");
    }
    await executeIssueTransitionInTx(tx, {
      issueId: created.id,
      transitionId: forwardTransitions[0].id,
      actorId: actor.id,
      reasonCode: "INCIDENT_REPORTED_AUTO_SUBMIT",
    });

    return tx.issue.findUniqueOrThrow({ where: { id: created.id } });
  });
}
