// M1.5-A 新增：核准快照（ApprovalRecord.approvalSnapshotJson）階段別 Schema。
//
// 不使用 Prisma Json scalar（不升級 Prisma）；approvalSnapshotJson 為純字串欄位。
// 四種 approvalType 各自有獨立必要欄位，buildApprovalSnapshot 依 approvalType dispatch，
// 不得要求某階段尚未產生的資料。驗證失敗（缺必要欄位、型別錯誤）一律 deny-by-default，
// 不得將任意未驗證物件直接序列化存入。

import { createHash } from "crypto";
import type { ApprovalType } from "./constants";

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotRiskCheckItem {
  checkKey: string;
  answer: string | null;
  detail: string;
}

export interface BusinessApprovalSnapshot {
  issueKey: string;
  stageKey: string;
  issueSummary: string;
  urgencyReason: string;
  expectedBusinessImpact: string;
  reporterUserId: string;
  designatedConfirmerUserId: string | null;
  systemName: string;
  environment: string;
  riskCheckSummary: SnapshotRiskCheckItem[] | null;
}

export interface RdLeadApprovalSnapshot {
  issueKey: string;
  stageKey: string;
  fixVersionOrTag: string;
  fixSummary: string;
  changedModules: string;
  rdSelfTestConclusion: string;
  assessmentRound: number;
  riskChecks: SnapshotRiskCheckItem[];
  knownLimitationsAndOpenItems: string;
}

export interface QaLeadApprovalSnapshot {
  issueKey: string;
  stageKey: string;
  verifiedVersion: string;
  qaTestConclusion: string;
  testDetailSummary: string;
  untestedItems: string;
  assessmentRound: number;
  riskChecks: SnapshotRiskCheckItem[];
  riskExceptionStatus: string;
}

export interface ApprovalStatusSummary {
  decision: string;
  decidedAt: string | null;
  approverUserId: string | null;
}

export interface DeploymentApprovalSnapshot {
  issueKey: string;
  stageKey: string;
  approvedDeployVersion: string;
  rdApprovalStatus: ApprovalStatusSummary;
  qaApprovalStatus: ApprovalStatusSummary;
  deploymentTarget: string;
  deploymentTime: string;
  deploymentMethod: string;
  backupStatus: string;
  rollbackPlan: string;
  downtimeAndUserImpact: string;
  assessmentRound: number;
  riskChecks: SnapshotRiskCheckItem[];
  riskExceptionStatus: string;
}

export type ApprovalSnapshot =
  | BusinessApprovalSnapshot
  | RdLeadApprovalSnapshot
  | QaLeadApprovalSnapshot
  | DeploymentApprovalSnapshot;

export class ApprovalSnapshotValidationError extends Error {
  constructor(
    public readonly approvalType: string,
    public readonly issues: string[],
  ) {
    super(`ApprovalSnapshot 驗證失敗（${approvalType}）：${issues.join("; ")}`);
    this.name = "ApprovalSnapshotValidationError";
  }
}

export class ApprovalSnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalSnapshotIntegrityError";
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isStringField(v: unknown): v is string {
  return typeof v === "string";
}

function isRiskCheckItemArray(v: unknown): v is SnapshotRiskCheckItem[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      isNonEmptyString((item as Record<string, unknown>).checkKey) &&
      ((item as Record<string, unknown>).answer === null ||
        isNonEmptyString((item as Record<string, unknown>).answer)) &&
      isStringField((item as Record<string, unknown>).detail),
  );
}

function isApprovalStatusSummary(v: unknown): v is ApprovalStatusSummary {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isNonEmptyString(o.decision) &&
    (o.decidedAt === null || isNonEmptyString(o.decidedAt)) &&
    (o.approverUserId === null || isNonEmptyString(o.approverUserId))
  );
}

function validateBusinessApproval(data: Record<string, unknown>, issues: string[]): void {
  if (!isNonEmptyString(data.issueKey)) issues.push("issueKey 缺漏或非字串");
  if (!isNonEmptyString(data.stageKey)) issues.push("stageKey 缺漏或非字串");
  if (!isStringField(data.issueSummary)) issues.push("issueSummary 缺漏");
  if (!isStringField(data.urgencyReason)) issues.push("urgencyReason 缺漏");
  if (!isStringField(data.expectedBusinessImpact)) issues.push("expectedBusinessImpact 缺漏");
  if (!isNonEmptyString(data.reporterUserId)) issues.push("reporterUserId 缺漏或非字串");
  if (data.designatedConfirmerUserId !== null && !isNonEmptyString(data.designatedConfirmerUserId)) {
    issues.push("designatedConfirmerUserId 必須為 null 或非空字串");
  }
  if (!isStringField(data.systemName)) issues.push("systemName 缺漏");
  if (!isStringField(data.environment)) issues.push("environment 缺漏");
  if (data.riskCheckSummary !== null && !isRiskCheckItemArray(data.riskCheckSummary)) {
    issues.push("riskCheckSummary 必須為 null 或合法的檢核項目陣列");
  }
}

function validateRdLeadApproval(data: Record<string, unknown>, issues: string[]): void {
  if (!isNonEmptyString(data.issueKey)) issues.push("issueKey 缺漏或非字串");
  if (!isNonEmptyString(data.stageKey)) issues.push("stageKey 缺漏或非字串");
  if (!isNonEmptyString(data.fixVersionOrTag)) issues.push("fixVersionOrTag 缺漏或非字串");
  if (!isStringField(data.fixSummary)) issues.push("fixSummary 缺漏");
  if (!isStringField(data.changedModules)) issues.push("changedModules 缺漏");
  if (!isStringField(data.rdSelfTestConclusion)) issues.push("rdSelfTestConclusion 缺漏");
  if (typeof data.assessmentRound !== "number" || !Number.isInteger(data.assessmentRound) || data.assessmentRound < 1) {
    issues.push("assessmentRound 必須為 >=1 的整數");
  }
  if (!isRiskCheckItemArray(data.riskChecks)) issues.push("riskChecks 缺漏或格式錯誤");
  if (!isStringField(data.knownLimitationsAndOpenItems)) issues.push("knownLimitationsAndOpenItems 缺漏");
}

function validateQaLeadApproval(data: Record<string, unknown>, issues: string[]): void {
  if (!isNonEmptyString(data.issueKey)) issues.push("issueKey 缺漏或非字串");
  if (!isNonEmptyString(data.stageKey)) issues.push("stageKey 缺漏或非字串");
  if (!isNonEmptyString(data.verifiedVersion)) issues.push("verifiedVersion 缺漏或非字串");
  if (!isStringField(data.qaTestConclusion)) issues.push("qaTestConclusion 缺漏");
  if (!isStringField(data.testDetailSummary)) issues.push("testDetailSummary 缺漏");
  if (!isStringField(data.untestedItems)) issues.push("untestedItems 缺漏");
  if (typeof data.assessmentRound !== "number" || !Number.isInteger(data.assessmentRound) || data.assessmentRound < 1) {
    issues.push("assessmentRound 必須為 >=1 的整數");
  }
  if (!isRiskCheckItemArray(data.riskChecks)) issues.push("riskChecks 缺漏或格式錯誤");
  if (!isStringField(data.riskExceptionStatus)) issues.push("riskExceptionStatus 缺漏");
}

function validateDeploymentApproval(data: Record<string, unknown>, issues: string[]): void {
  if (!isNonEmptyString(data.issueKey)) issues.push("issueKey 缺漏或非字串");
  if (!isNonEmptyString(data.stageKey)) issues.push("stageKey 缺漏或非字串");
  if (!isNonEmptyString(data.approvedDeployVersion)) issues.push("approvedDeployVersion 缺漏或非字串");
  if (!isApprovalStatusSummary(data.rdApprovalStatus)) issues.push("rdApprovalStatus 缺漏或格式錯誤");
  if (!isApprovalStatusSummary(data.qaApprovalStatus)) issues.push("qaApprovalStatus 缺漏或格式錯誤");
  if (!isNonEmptyString(data.deploymentTarget)) issues.push("deploymentTarget 缺漏或非字串");
  if (!isNonEmptyString(data.deploymentTime)) issues.push("deploymentTime 缺漏或非字串");
  if (!isNonEmptyString(data.deploymentMethod)) issues.push("deploymentMethod 缺漏或非字串");
  if (!isStringField(data.backupStatus)) issues.push("backupStatus 缺漏");
  if (!isStringField(data.rollbackPlan)) issues.push("rollbackPlan 缺漏");
  if (!isStringField(data.downtimeAndUserImpact)) issues.push("downtimeAndUserImpact 缺漏");
  if (typeof data.assessmentRound !== "number" || !Number.isInteger(data.assessmentRound) || data.assessmentRound < 1) {
    issues.push("assessmentRound 必須為 >=1 的整數");
  }
  if (!isRiskCheckItemArray(data.riskChecks)) issues.push("riskChecks 缺漏或格式錯誤");
  if (!isStringField(data.riskExceptionStatus)) issues.push("riskExceptionStatus 缺漏");
}

// 穩定排序後的 JSON 字串化：物件鍵一律按字母排序遞迴處理，確保雜湊可重現。
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function computeSnapshotHash(json: string): string {
  return createHash("sha256").update(json).digest("hex");
}

export interface BuiltApprovalSnapshot {
  json: string;
  hash: string;
  schemaVersion: number;
}

// 依 approvalType dispatch 對應驗證器；資料未通過驗證時 deny-by-default（拋出，不建立快照）。
export function buildApprovalSnapshot(approvalType: ApprovalType, data: unknown): BuiltApprovalSnapshot {
  if (typeof data !== "object" || data === null) {
    throw new ApprovalSnapshotValidationError(approvalType, ["snapshot 資料必須為物件"]);
  }
  const record = data as Record<string, unknown>;
  const issues: string[] = [];

  switch (approvalType) {
    case "BUSINESS_APPROVAL":
      validateBusinessApproval(record, issues);
      break;
    case "RD_LEAD_APPROVAL":
      validateRdLeadApproval(record, issues);
      break;
    case "QA_LEAD_APPROVAL":
      validateQaLeadApproval(record, issues);
      break;
    case "DEPLOYMENT_APPROVAL":
      validateDeploymentApproval(record, issues);
      break;
    case "RISK_EXCEPTION_APPROVAL":
      // 第一版主流程不觸發此類型快照，保留值域供未來使用；本輪不定義其 schema。
      throw new ApprovalSnapshotValidationError(approvalType, [
        "RISK_EXCEPTION_APPROVAL 快照 schema 尚未定義，M1.5-A/B 不建立自動觸發邏輯",
      ]);
    default:
      throw new ApprovalSnapshotValidationError(approvalType, ["未知的 approvalType"]);
  }

  if (issues.length > 0) {
    throw new ApprovalSnapshotValidationError(approvalType, issues);
  }

  const json = stableStringify(record);
  const hash = computeSnapshotHash(json);
  return { json, hash, schemaVersion: SNAPSHOT_SCHEMA_VERSION };
}

// 讀取時 deny-by-default：解析失敗或 hash 不符一律視為快照不可用，不得靜默略過。
export function parseApprovalSnapshot(json: string, expectedHash: string | null): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ApprovalSnapshotIntegrityError("approvalSnapshotJson 解析失敗，視為不可用");
  }
  if (expectedHash !== null) {
    const actualHash = computeSnapshotHash(stableStringify(parsed));
    if (actualHash !== expectedHash) {
      throw new ApprovalSnapshotIntegrityError("approvalSnapshotJson 雜湊不符，視為不可用");
    }
  }
  return parsed;
}
