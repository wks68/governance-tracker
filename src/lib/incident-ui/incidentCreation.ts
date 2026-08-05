// Incident 事件通報流程：建立事件＋自動送出待承接，比照 src/lib/issueCreation.ts 既有
// 「同一 transaction 內建立＋啟動 Workflow＋送出第一關」模式，但刻意精簡（不含 Hotfix 特有
// 的富文字／治理關聯欄位處理），只服務 Incident 自己的資料需求。共用的底層原語
// （allocateNextIssueKey／resolveUniqueAutoStartVersionForIssueType／
// startWorkflowForIssueSystemTx／executeIssueTransitionInTx）完全相同，不建立第二套流程引擎。
//
// 第二階段擴充（任務規格第四～十一節，通報人快速通報介面）：
//   - 「問題是否仍持續」「是否有替代方式」改為三態字串（含「不確定」），不再是布林值——
//     通報人合法地不知道答案時必須能直接送出，不得被迫二選一。
//   - 新增結構化欄位（症狀複選、影響範圍正式值、資料／權限影響複選、初步營運影響複選、
//     通報人初步影響感受、聯絡方式）一律使用 incidentFieldRegistry.ts 集中定義的 Key。
//   - Checkbox 互斥規則（資料／權限影響、初步營運影響）在這裡再驗證一次，不只信任 Client
//     端已擋過——UI 與 Server 都必須擋，比照任務規格明確要求。
//   - 系統自動整理摘要（buildAutoIncidentSummary）與通報人原始描述（description）分開保存，
//     摘要不得覆蓋原始描述。
//   - suggestedImpactLevel 只是通報人自己的感受紀錄，絕不寫入 Issue.riskLevel（正式事件
//     等級只能由事件受理窗口於 classifyIncident 決定，見 incidentAssignmentService.ts）。

import { prisma } from "../prisma";
import type { Prisma, User } from "@prisma/client";
import { allocateNextIssueKey } from "../issue-key-sequence";
import { resolveUniqueAutoStartVersionForIssueType, startWorkflowForIssueSystemTx, executeIssueTransitionInTx } from "../workflowExecutionService";
import { ENVIRONMENTS } from "../constants";
import { INCIDENT_FIELD, INCIDENT_FIELD_LABEL } from "./incidentFieldRegistry";
import {
  REPORTER_OTHER,
  REPORTER_SYSTEM_OPTIONS,
  INCIDENT_TYPE_OPTIONS,
  ONGOING_OPTIONS,
  WORKAROUND_OPTIONS,
  IMPACT_SCOPE_VALUES,
  IMPACT_SCOPE_OPTIONS,
  DATA_PERMISSION_IMPACT_OPTIONS,
  OPERATIONAL_IMPACT_OPTIONS,
  OPERATIONAL_IMPACT_NONE,
  OPERATIONAL_IMPACT_UNSURE,
  IMPACT_FEELING_OPTIONS,
  CONTACT_METHOD_OPTIONS,
  validateDataPermissionImpactSelection,
  validateOperationalImpactSelection,
  buildAutoIncidentSummary,
} from "./reporterIntakeOptions";

export class IncidentCreationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentCreationValidationError";
  }
}

export interface CreateIncidentInput {
  title: string;
  description: string;
  systemName: string;
  environment: string;
  incidentType: string;
  incidentTypeOtherNote?: string;
  occurredAt: string; // ISO；occurredAtUncertain 為 true 時可為空字串
  occurredAtUncertain?: boolean;
  reportSource: string;
  /** 通報人初步影響感受（IMPACT_FEELING_OPTIONS 之一）；絕不直接寫入 Issue.riskLevel。 */
  suggestedSeverity: string;
  /** ONGOING_OPTIONS 三態之一：「是，現在仍持續」／「否，目前已恢復」／「不確定」。 */
  isOngoing: string;
  /** WORKAROUND_OPTIONS 三態之一：「有」／「沒有」／「不確定」。 */
  hasWorkaround: string;
  workaroundNote?: string;
  symptomText: string;
  symptomTags?: string[];
  impactScope: string;
  affectedUserIds?: string[];
  affectedTeamIds?: string[];
  dataPermissionImpact: string[];
  operationalImpact: string[];
  operationalImpactOtherNote?: string;
  contactMethod?: string;
  contactDetail?: string;
  /** 舊制自由文字欄位，第二階段起改由 buildAutoIncidentSummary 產生；保留參數相容既有呼叫端，
   *  未提供時以自動摘要代替。 */
  affectedScope?: string;
  impactSummary?: string;
}

function required(value: string, label: string, issues: string[]) {
  if (!value.trim()) issues.push(`${label}不得為空`);
}

async function writeField(tx: Prisma.TransactionClient, issueId: string, fieldKey: string, fieldLabel: string, fieldValue: string) {
  if (!fieldValue.trim()) return;
  await tx.issueFieldValue.create({ data: { issueId, fieldKey, fieldLabel, fieldValue: fieldValue.trim() } });
}

function impactScopeLabel(value: string): string {
  return IMPACT_SCOPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export async function createIncidentForActor(actor: User, input: CreateIncidentInput) {
  if (!actor.isActive) throw new IncidentCreationValidationError("帳號已停用，無法建立事件通報");

  const issues: string[] = [];
  required(input.title, "事件名稱", issues);
  required(input.symptomText, "問題現象", issues);
  if (!REPORTER_SYSTEM_OPTIONS.includes(input.systemName)) issues.push("系統名稱必須是既有值域之一");
  if (input.systemName === REPORTER_OTHER && !input.description.trim()) issues.push("系統選擇「其他」時必須補充說明");
  if (!ENVIRONMENTS.includes(input.environment)) issues.push("環境必須是既有值域之一");
  if (!(INCIDENT_TYPE_OPTIONS as readonly string[]).includes(input.incidentType)) issues.push("事件類型必須是既有值域之一");
  if (input.incidentType === REPORTER_OTHER && !input.incidentTypeOtherNote?.trim()) issues.push("事件類型選擇「其他」時必須補充說明");
  if (!(IMPACT_FEELING_OPTIONS as readonly string[]).includes(input.suggestedSeverity)) issues.push("初步影響感受必須是既有值域之一");
  if (!input.occurredAtUncertain) required(input.occurredAt, "事件發生時間", issues);
  required(input.reportSource, "通報來源", issues);
  if (!(ONGOING_OPTIONS as readonly string[]).includes(input.isOngoing)) issues.push("問題是否仍持續必須是既有值域之一");
  if (!(WORKAROUND_OPTIONS as readonly string[]).includes(input.hasWorkaround)) issues.push("是否有替代方式必須是既有值域之一");
  if (!IMPACT_SCOPE_VALUES.includes(input.impactScope)) issues.push("影響範圍必須是既有值域之一");
  if (input.dataPermissionImpact.length === 0) issues.push("資料與權限影響至少選擇一項或「不確定」");
  if (input.dataPermissionImpact.some((v) => !(DATA_PERMISSION_IMPACT_OPTIONS as readonly string[]).includes(v))) {
    issues.push("資料與權限影響包含未知選項");
  }
  const dataPermissionMutexError = validateDataPermissionImpactSelection(input.dataPermissionImpact);
  if (dataPermissionMutexError) issues.push(dataPermissionMutexError);
  if (input.operationalImpact.length === 0) issues.push("初步營運影響至少選擇一項或「不確定」");
  if (input.operationalImpact.some((v) => !(OPERATIONAL_IMPACT_OPTIONS as readonly string[]).includes(v))) {
    issues.push("初步營運影響包含未知選項");
  }
  const operationalMutexError = validateOperationalImpactSelection(input.operationalImpact);
  if (operationalMutexError) issues.push(operationalMutexError);
  if (input.operationalImpact.includes(REPORTER_OTHER) && !input.operationalImpactOtherNote?.trim()) {
    issues.push("初步營運影響選擇「其他」時必須補充說明");
  }
  if (input.contactMethod && !(CONTACT_METHOD_OPTIONS as readonly string[]).includes(input.contactMethod)) {
    issues.push("聯絡方式必須是既有值域之一");
  }
  if (issues.length > 0) throw new IncidentCreationValidationError(issues.join("；"));

  const versionToStart = await resolveUniqueAutoStartVersionForIssueType("Incident");
  if (!versionToStart) {
    throw new IncidentCreationValidationError("找不到唯一已發布的 Incident Workflow 版本，無法建立事件");
  }

  const autoSummary = buildAutoIncidentSummary({
    systemName: input.systemName,
    incidentType: input.incidentType === REPORTER_OTHER ? (input.incidentTypeOtherNote ?? REPORTER_OTHER) : input.incidentType,
    symptomText: input.symptomText,
    isOngoing: input.isOngoing,
    impactScopeLabel: impactScopeLabel(input.impactScope),
    dataPermissionImpact: input.dataPermissionImpact,
    hasWorkaround: input.hasWorkaround,
  });

  return prisma.$transaction(async (tx) => {
    const issueKey = await allocateNextIssueKey(tx, "Incident");
    const created = await tx.issue.create({
      data: {
        issueKey,
        issueType: "Incident",
        title: input.title.trim(),
        // 通報人原始描述獨立保存，絕不被自動摘要覆蓋；系統摘要另存於
        // INCIDENT_FIELD.autoSummary，兩者在詳情頁都完整可見。
        description: input.description.trim() || input.symptomText.trim(),
        systemName: input.systemName,
        environment: input.environment,
        reporter: actor.name,
        reporterUserId: actor.id,
        workflowStatus: "reported",
      },
    });

    await writeField(tx, created.id, "incidentType", "事件類型", input.incidentType === REPORTER_OTHER ? `其他：${input.incidentTypeOtherNote?.trim() ?? ""}` : input.incidentType);
    if (!input.occurredAtUncertain) {
      await writeField(tx, created.id, "incidentOccurredAt", "事件發生時間", input.occurredAt);
    }
    await writeField(tx, created.id, INCIDENT_FIELD.occurredAtUncertain, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.occurredAtUncertain], input.occurredAtUncertain ? "是" : "否");
    await writeField(tx, created.id, "incidentReportSource", "通報來源", input.reportSource);
    await writeField(tx, created.id, INCIDENT_FIELD.suggestedImpactLevel, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.suggestedImpactLevel], input.suggestedSeverity);
    await writeField(tx, created.id, "incidentIsOngoing", "問題是否仍持續", input.isOngoing);
    await writeField(tx, created.id, "incidentHasWorkaround", "是否有替代方案", input.hasWorkaround);
    if (input.workaroundNote?.trim()) {
      await writeField(tx, created.id, INCIDENT_FIELD.workaroundNote, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.workaroundNote], input.workaroundNote);
    }
    await writeField(tx, created.id, INCIDENT_FIELD.symptomText, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.symptomText], input.symptomText);
    if (input.symptomTags && input.symptomTags.length > 0) {
      await writeField(tx, created.id, INCIDENT_FIELD.symptomTags, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.symptomTags], input.symptomTags.join("、"));
    }
    await writeField(tx, created.id, INCIDENT_FIELD.impactScope, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.impactScope], input.impactScope);
    await writeField(tx, created.id, "incidentAffectedScope", "受影響系統／功能／使用者／資料權限", input.affectedScope?.trim() || impactScopeLabel(input.impactScope));
    if (input.affectedUserIds && input.affectedUserIds.length > 0) {
      await writeField(tx, created.id, INCIDENT_FIELD.affectedUserIds, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.affectedUserIds], input.affectedUserIds.join(","));
    }
    if (input.affectedTeamIds && input.affectedTeamIds.length > 0) {
      await writeField(tx, created.id, INCIDENT_FIELD.affectedTeamIds, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.affectedTeamIds], input.affectedTeamIds.join(","));
    }
    await writeField(tx, created.id, INCIDENT_FIELD.dataPermissionImpact, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.dataPermissionImpact], input.dataPermissionImpact.join("、"));
    await writeField(tx, created.id, INCIDENT_FIELD.operationalImpact, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.operationalImpact], input.operationalImpact.join("、"));
    if (input.operationalImpact.includes(REPORTER_OTHER) && input.operationalImpactOtherNote?.trim()) {
      await writeField(tx, created.id, INCIDENT_FIELD.operationalImpactOtherNote, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.operationalImpactOtherNote], input.operationalImpactOtherNote);
    }
    await writeField(
      tx,
      created.id,
      "incidentImpactSummary",
      "初步營運影響",
      input.impactSummary?.trim() ||
        input.operationalImpact.filter((v) => v !== OPERATIONAL_IMPACT_NONE && v !== OPERATIONAL_IMPACT_UNSURE && v !== REPORTER_OTHER).join("、") ||
        input.operationalImpact.join("、"),
    );
    if (input.contactMethod?.trim()) {
      await writeField(tx, created.id, INCIDENT_FIELD.contactMethod, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.contactMethod], input.contactMethod);
    }
    if (input.contactDetail?.trim()) {
      await writeField(tx, created.id, INCIDENT_FIELD.contactDetail, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.contactDetail], input.contactDetail);
    }
    await writeField(tx, created.id, INCIDENT_FIELD.autoSummary, INCIDENT_FIELD_LABEL[INCIDENT_FIELD.autoSummary], autoSummary);

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
