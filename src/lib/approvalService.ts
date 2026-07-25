// M1.5-A 新增：核准治理層服務層（ApprovalRecord／StageRiskCheck 生命週期管理）。
//
// 重要限制：本檔案本輪不接入 src/lib/actions.ts，也不修改任何既有 UI。所有函式皆為
// 獨立可呼叫的服務層函式，供 M1.5-B 起串接使用。
//
// 信任邊界（重要）：本檔案是核准資格判斷的最終信任邊界。呼叫端只能傳入
// approvalRecordId／actorUserId／decision／reasonCode／comment 等「意圖」資訊，
// 絕不接受呼叫端直接指定或覆寫 approvalAuthorityType／supervisorAssignmentId／
// approvalDelegationId／delegatedFromUserId／approverTeamId 等「資格來源」欄位。
// 所有資格來源一律由本檔案在同一 Prisma transaction 內，重新查詢
// UserSupervisorAssignment／TeamMember／ApprovalDelegation／Issue 等資料表，
// 並呼叫 src/lib/permissions.ts 的純函式（getEligibleApprovers／canApproveStage）
// 現場解析、現場驗證、現場寫入。permissions.ts 僅提供純邏輯資格判斷器，
// 不構成信任邊界本身。

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  APPROVAL_TYPES,
  isApprovalType,
  isApprovalDecision,
  isApprovalRecordStatus,
  isApprovalAuthorityType,
  isRiskCheckAnswer,
  isTeamMembershipRole,
  type ApprovalType,
  type TeamMembershipRole,
} from "./constants";
import {
  assertNotSelfApproval,
  getEligibleApprovers,
  canApproveStage,
  type ApprovalAuthoritySource,
  type SupervisorAssignmentLike,
  type ApprovalDelegationLike,
  type TeamMembershipLike,
} from "./permissions";
import { getRiskCheckTemplate } from "./riskCheckTemplates";

type Tx = Prisma.TransactionClient;

export const RESUBMITTABLE_DECISIONS = ["REJECTED", "CANCELLED"] as const;

// 需送核前置風險檢核的 approvalType；BUSINESS_APPROVAL 無風險檢核模板。
const RISK_CHECK_GATED_TYPES: ReadonlySet<ApprovalType> = new Set(["RD_LEAD_APPROVAL", "QA_LEAD_APPROVAL", "DEPLOYMENT_APPROVAL"]);

// ---------------------------------------------------------------------------
// 錯誤類型：呼叫端可用 instanceof 分辨拒絕原因，不得吞掉錯誤改為靜默略過。
// ---------------------------------------------------------------------------

export class ApprovalValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`ApprovalRecord 驗證失敗：${issues.join("; ")}`);
    this.name = "ApprovalValidationError";
  }
}

export class ApprovalNotFoundError extends Error {
  constructor(approvalRecordId: string) {
    super(`找不到核准紀錄：${approvalRecordId}`);
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalStateError";
  }
}

export class ApprovalAuthorityMismatchError extends Error {
  constructor() {
    super("actorUserId 於決策當下重新解析後不具備此核准紀錄的合格資格來源，拒絕（deny-by-default）");
    this.name = "ApprovalAuthorityMismatchError";
  }
}

export class DuplicateActivePendingApprovalError extends Error {
  constructor(issueId: string, approvalType: string, relatedStageKey: string) {
    super(
      `同一 issueId+approvalType+relatedStageKey 僅允許一筆 ACTIVE+PENDING 核准紀錄（issueId=${issueId}, approvalType=${approvalType}, relatedStageKey=${relatedStageKey}）`,
    );
    this.name = "DuplicateActivePendingApprovalError";
  }
}

export class RiskCheckIncompleteError extends Error {
  constructor(
    public readonly stageKey: string,
    public readonly issues: string[],
  ) {
    super(`送核前置檢核未完成（stageKey=${stageKey}）：${issues.join("; ")}`);
    this.name = "RiskCheckIncompleteError";
  }
}

export class UnresolvedUnknownRiskError extends Error {
  constructor(public readonly checkKeys: string[]) {
    super(`存在尚未 resolve 的 UNKNOWN 風險檢核項目，不得核准：${checkKeys.join(", ")}`);
    this.name = "UnresolvedUnknownRiskError";
  }
}

// ---------------------------------------------------------------------------
// 決策欄位一致性（純邏輯，不依賴 Prisma，可在 Migration 套用前單元測試）
// ---------------------------------------------------------------------------

export interface ApprovalRecordConsistencyInput {
  decision: string;
  recordStatus: string;
  decidedAt: Date | null;
  approverUserId: string | null;
  approvalAuthorityType: string;
  supervisorAssignmentId: string | null;
  approvalDelegationId: string | null;
  revisionNo: number;
  supersedesApprovalRecordId: string | null;
  invalidatedAt: Date | null;
  invalidationReason: string | null;
}

export type ConsistencyCheckResult = { ok: true } | { ok: false; issues: string[] };

// 檢查 ApprovalRecord 各欄位彼此是否一致；deny-by-default，任何未通過項目皆列於 issues。
export function checkApprovalRecordConsistency(r: ApprovalRecordConsistencyInput): ConsistencyCheckResult {
  const issues: string[] = [];

  if (!isApprovalDecision(r.decision)) issues.push("decision 不在合法值域");
  if (!isApprovalRecordStatus(r.recordStatus)) issues.push("recordStatus 不在合法值域");
  if (!isApprovalAuthorityType(r.approvalAuthorityType)) issues.push("approvalAuthorityType 不在合法值域");

  if (r.decision === "PENDING") {
    if (r.decidedAt !== null) issues.push("decision=PENDING 時 decidedAt 必須為 null");
    if (r.approverUserId !== null) issues.push("decision=PENDING 時 approverUserId 必須為 null");
  }
  if (r.decision === "APPROVED" || r.decision === "REJECTED") {
    if (r.decidedAt === null) issues.push(`decision=${r.decision} 時 decidedAt 不得為 null`);
    if (r.approverUserId === null) issues.push(`decision=${r.decision} 時 approverUserId 不得為 null`);
  }
  if (r.decision === "CANCELLED" && r.decidedAt === null) {
    issues.push("decision=CANCELLED 時 decidedAt 不得為 null");
  }

  if (r.recordStatus === "INVALIDATED") {
    if (r.decision !== "APPROVED") issues.push("recordStatus=INVALIDATED 僅適用於 decision=APPROVED 的紀錄");
    if (r.invalidatedAt === null) issues.push("recordStatus=INVALIDATED 時 invalidatedAt 不得為 null");
    if (!r.invalidationReason) issues.push("recordStatus=INVALIDATED 時 invalidationReason 不得為空");
  }
  if (r.recordStatus === "SUPERSEDED") {
    if (r.decision !== "REJECTED" && r.decision !== "CANCELLED") {
      issues.push("recordStatus=SUPERSEDED 僅適用於 decision=REJECTED／CANCELLED 的紀錄");
    }
  }

  if (r.approvalAuthorityType === "DIRECT_SUPERVISOR") {
    if (!r.supervisorAssignmentId) issues.push("approvalAuthorityType=DIRECT_SUPERVISOR 時 supervisorAssignmentId 不得為空");
    if (r.approvalDelegationId) issues.push("approvalAuthorityType=DIRECT_SUPERVISOR 時 approvalDelegationId 必須為 null");
  }
  if (r.approvalAuthorityType === "DELEGATE") {
    if (!r.approvalDelegationId) issues.push("approvalAuthorityType=DELEGATE 時 approvalDelegationId 不得為空");
    if (r.supervisorAssignmentId) issues.push("approvalAuthorityType=DELEGATE 時 supervisorAssignmentId 必須為 null");
  }
  if (r.approvalAuthorityType === "TEAM_LEAD") {
    if (r.supervisorAssignmentId) issues.push("approvalAuthorityType=TEAM_LEAD 時 supervisorAssignmentId 必須為 null");
    if (r.approvalDelegationId) issues.push("approvalAuthorityType=TEAM_LEAD 時 approvalDelegationId 必須為 null");
  }

  if (r.supersedesApprovalRecordId === null && r.revisionNo !== 1) {
    issues.push("supersedesApprovalRecordId 為 null 時 revisionNo 必須為 1");
  }
  if (r.supersedesApprovalRecordId !== null && r.revisionNo <= 1) {
    issues.push("supersedesApprovalRecordId 非 null 時 revisionNo 必須大於 1");
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

// ---------------------------------------------------------------------------
// 風險檢核 null／UNKNOWN 規則（純邏輯）
// ---------------------------------------------------------------------------

export interface RiskCheckAnswerLike {
  checkKey: string;
  answer: string | null;
}

// 送核前置條件：該 stageKey 模板內所有 checkKey 均須存在且 answer 不得為 null（尚未填答視為未完成，
// 不得以 default 冒充已填答）；非模板 checkKey 一律視為不合法，拒絕送核。
export function assertAllRiskChecksAnswered(stageKey: string, checks: readonly RiskCheckAnswerLike[]): void {
  const template = getRiskCheckTemplate(stageKey);
  if (!template) {
    throw new RiskCheckIncompleteError(stageKey, [`stageKey 無對應的風險檢核模板`]);
  }
  const byKey = new Map(checks.map((c) => [c.checkKey, c] as const));
  const issues: string[] = [];
  for (const item of template) {
    const found = byKey.get(item.checkKey);
    if (!found || found.answer === null) {
      issues.push(`${item.checkKey} 尚未填答`);
    } else if (!isRiskCheckAnswer(found.answer)) {
      issues.push(`${item.checkKey} 答案不在合法值域`);
    }
  }
  for (const c of checks) {
    if (!template.some((item) => item.checkKey === c.checkKey)) {
      issues.push(`${c.checkKey} 非 ${stageKey} 合法模板項目`);
    }
  }
  if (issues.length > 0) {
    throw new RiskCheckIncompleteError(stageKey, issues);
  }
}

export interface RiskCheckResolutionLike {
  checkKey: string;
  answer: string | null;
  resolvedAt: Date | null;
}

// 核准前置條件：answer=UNKNOWN 的檢核項目必須已 resolve（resolvedAt 非 null），否則不得核准。
export function assertNoUnresolvedUnknownRisks(checks: readonly RiskCheckResolutionLike[]): void {
  const unresolved = checks.filter((c) => c.answer === "UNKNOWN" && c.resolvedAt === null);
  if (unresolved.length > 0) {
    throw new UnresolvedUnknownRiskError(unresolved.map((c) => c.checkKey));
  }
}

// 送核前置條件（DB 版本）：查詢 issueId+stageKey 目前最新一輪 StageRiskCheck，套用
// assertAllRiskChecksAnswered。不得信任呼叫端自行宣稱「已填答」，一律以 DB 現況為準。
async function assertRiskChecksReadyForSubmission(tx: Tx, issueId: string, stageKey: string): Promise<void> {
  const rows = await tx.stageRiskCheck.findMany({ where: { issueId, stageKey } });
  if (rows.length === 0) {
    throw new RiskCheckIncompleteError(stageKey, ["尚無任何風險檢核紀錄"]);
  }
  const maxRound = Math.max(...rows.map((r) => r.assessmentRound));
  const currentRound = rows.filter((r) => r.assessmentRound === maxRound);
  assertAllRiskChecksAnswered(
    stageKey,
    currentRound.map((r) => ({ checkKey: r.checkKey, answer: r.answer })),
  );
}

// ---------------------------------------------------------------------------
// 核准資格來源解析（信任邊界核心）：一律在呼叫端提供的 tx 內現場查詢，
// 現場以 now 重新檢查有效期間，現場交由 permissions.ts 純函式判斷。
// ---------------------------------------------------------------------------

async function fetchTeamMembershipsLike(tx: Tx, teamId: string): Promise<TeamMembershipLike[]> {
  const rows = await tx.teamMember.findMany({ where: { teamId } });
  const result: TeamMembershipLike[] = [];
  for (const m of rows) {
    if (!isTeamMembershipRole(m.membershipRole)) continue; // deny-by-default：非法值域資料視為無有效成員身分
    result.push({
      teamId: m.teamId,
      userId: m.userId,
      membershipRole: m.membershipRole as TeamMembershipRole,
      isActive: m.isActive,
    });
  }
  return result;
}

async function fetchSupervisorAssignmentsLike(tx: Tx, userId: string): Promise<SupervisorAssignmentLike[]> {
  const rows = await tx.userSupervisorAssignment.findMany({ where: { userId } });
  return rows.map((a) => ({
    id: a.id,
    userId: a.userId,
    supervisorUserId: a.supervisorUserId,
    validFrom: a.validFrom,
    validUntil: a.validUntil,
    isPrimary: a.isPrimary,
    isActive: a.isActive,
  }));
}

async function fetchDelegationsLike(tx: Tx, approvalType: string): Promise<ApprovalDelegationLike[]> {
  const rows = await tx.approvalDelegation.findMany({ where: { approvalType } });
  return rows.map((d) => ({
    id: d.id,
    delegatorUserId: d.delegatorUserId,
    delegateUserId: d.delegateUserId,
    teamId: d.teamId,
    approvalType: d.approvalType,
    validFrom: d.validFrom,
    validUntil: d.validUntil,
    isActive: d.isActive,
  }));
}

// 現場（同一 transaction 內）查詢並解析目前所有合格核准來源。
// 完全不接受呼叫端傳入的資格資料，僅接受「查什麼」所需的上下文（approvalType／
// requestedByUserId／teamId），資格判斷結果由 DB 現況與 now 決定。
async function fetchEligibleApproversInTx(
  tx: Tx,
  params: { approvalType: ApprovalType; requestedByUserId: string; teamId: string | null; now: Date },
): Promise<ApprovalAuthoritySource[]> {
  const supervisorAssignments =
    params.approvalType === "BUSINESS_APPROVAL" ? await fetchSupervisorAssignmentsLike(tx, params.requestedByUserId) : [];
  const teamMemberships = params.teamId ? await fetchTeamMembershipsLike(tx, params.teamId) : [];
  const delegations = await fetchDelegationsLike(tx, params.approvalType);

  return getEligibleApprovers({
    approvalType: params.approvalType,
    requestedByUserId: params.requestedByUserId,
    teamId: params.teamId,
    supervisorAssignments,
    teamMemberships,
    delegations,
    now: params.now,
  });
}

// 建立階段（尚無決策）：解析「預期」核准來源，僅供 UI 顯示與稽核比對，非決策時的授權依據。
// TEAM_LEAD 類型的目標團隊一律取自 Issue.assignedTeamId（現有 DB 權威來源），
// 不接受呼叫端自行指定 teamId，避免呼叫端指定任意團隊使自己成為該團隊 LEAD 而取得資格。
async function resolveExpectedAuthorityForCreation(
  tx: Tx,
  issueId: string,
  approvalType: ApprovalType,
  requestedByUserId: string,
  now: Date,
): Promise<{ expected: ApprovalAuthoritySource; teamId: string | null }> {
  const issue = await tx.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new ApprovalValidationError(["issueId 對應的 Issue 不存在"]);

  const isTeamLeadType = RISK_CHECK_GATED_TYPES.has(approvalType);
  const teamId = isTeamLeadType ? issue.assignedTeamId : null;
  if (isTeamLeadType && !teamId) {
    throw new ApprovalValidationError(["Issue 尚未指派處理團隊（assignedTeamId 為 null），無法解析核准資格"]);
  }

  const eligible = await fetchEligibleApproversInTx(tx, { approvalType, requestedByUserId, teamId, now });
  const expected = eligible.find((e) => e.authorityType !== "DELEGATE") ?? eligible[0] ?? null;
  if (!expected) {
    throw new ApprovalValidationError(["找不到合格的核准資格來源，不得建立核准紀錄"]);
  }
  if (expected.userId === requestedByUserId) {
    throw new ApprovalValidationError(["預期核准人與送核人相同，不得建立此核准紀錄"]);
  }
  return { expected, teamId };
}

// 決策階段（信任邊界核心）：現場重新解析「實際」核准來源，僅接受 actorUserId 是否
// 落在現場解析出的合格名單內；不接受呼叫端宣稱的 authorityType／assignmentId／delegationId。
async function resolveActualAuthorityForDecision(
  tx: Tx,
  record: { approvalType: string; requestedByUserId: string; approverTeamId: string | null },
  actorUserId: string,
  now: Date,
): Promise<ApprovalAuthoritySource> {
  if (!isApprovalType(record.approvalType)) {
    throw new ApprovalStateError("核准紀錄的 approvalType 不在合法值域");
  }
  const eligible = await fetchEligibleApproversInTx(tx, {
    approvalType: record.approvalType,
    requestedByUserId: record.requestedByUserId,
    teamId: record.approverTeamId,
    now,
  });
  const actual = canApproveStage(actorUserId, eligible);
  if (!actual) throw new ApprovalAuthorityMismatchError();
  return actual;
}

function authoritySourceToRecordFields(source: ApprovalAuthoritySource): {
  approvalAuthorityType: ApprovalAuthoritySource["authorityType"];
  supervisorAssignmentId: string | null;
  approvalDelegationId: string | null;
  delegatedFromUserId: string | null;
} {
  if (source.authorityType === "DIRECT_SUPERVISOR") {
    return {
      approvalAuthorityType: "DIRECT_SUPERVISOR",
      supervisorAssignmentId: source.supervisorAssignmentId,
      approvalDelegationId: null,
      delegatedFromUserId: null,
    };
  }
  if (source.authorityType === "DELEGATE") {
    return {
      approvalAuthorityType: "DELEGATE",
      supervisorAssignmentId: null,
      approvalDelegationId: source.approvalDelegationId,
      delegatedFromUserId: source.onBehalfOfUserId,
    };
  }
  return {
    approvalAuthorityType: "TEAM_LEAD",
    supervisorAssignmentId: null,
    approvalDelegationId: null,
    delegatedFromUserId: null,
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

// ---------------------------------------------------------------------------
// 建立 PENDING＋ACTIVE 的 ApprovalRecord
// ---------------------------------------------------------------------------

export interface CreatePendingApprovalInput {
  issueId: string;
  approvalType: ApprovalType;
  relatedStageKey: string;
  requestedByUserId: string;
  dueAt?: Date | null;
}

function validateBasicCreateInput(input: CreatePendingApprovalInput): void {
  const issues: string[] = [];
  if (!isApprovalType(input.approvalType)) issues.push("approvalType 不在合法值域");
  if (!input.issueId) issues.push("issueId 不得為空");
  if (!input.relatedStageKey) issues.push("relatedStageKey 不得為空");
  if (!input.requestedByUserId) issues.push("requestedByUserId 不得為空");
  if (issues.length > 0) throw new ApprovalValidationError(issues);
}

// 以 transaction 檢查同一 issueId+approvalType+relatedStageKey 是否已存在 ACTIVE+PENDING 紀錄，
// 資料庫層另有 partial unique index（見 migration.sql）作為最終防線。
export async function createPendingApprovalRecord(input: CreatePendingApprovalInput) {
  validateBasicCreateInput(input);
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      if (RISK_CHECK_GATED_TYPES.has(input.approvalType)) {
        await assertRiskChecksReadyForSubmission(tx, input.issueId, input.relatedStageKey);
      }

      const { expected, teamId } = await resolveExpectedAuthorityForCreation(
        tx,
        input.issueId,
        input.approvalType,
        input.requestedByUserId,
        now,
      );

      const existing = await tx.approvalRecord.findFirst({
        where: {
          issueId: input.issueId,
          approvalType: input.approvalType,
          relatedStageKey: input.relatedStageKey,
          recordStatus: "ACTIVE",
          decision: "PENDING",
        },
      });
      if (existing) {
        throw new DuplicateActivePendingApprovalError(input.issueId, input.approvalType, input.relatedStageKey);
      }

      const fields = authoritySourceToRecordFields(expected);
      return tx.approvalRecord.create({
        data: {
          issueId: input.issueId,
          approvalType: input.approvalType,
          relatedStageKey: input.relatedStageKey,
          requestedByUserId: input.requestedByUserId,
          approverTeamId: teamId,
          expectedApproverUserId: expected.userId,
          dueAt: input.dueAt ?? null,
          ...fields,
        },
      });
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateActivePendingApprovalError(input.issueId, input.approvalType, input.relatedStageKey);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 決策：APPROVED／REJECTED
// ---------------------------------------------------------------------------

export interface DecideApprovalInput {
  approvalRecordId: string;
  // 實際執行決策動作的使用者；資格是否合法一律由本檔案於 transaction 內現場重新解析，
  // 不接受呼叫端額外傳入 authorityType／assignmentId／delegationId 等宣稱值。
  actorUserId: string;
  decision: "APPROVED" | "REJECTED";
  decisionReasonCode?: string | null;
  decisionComment?: string | null;
}

export async function decideApprovalRecord(input: DecideApprovalInput) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const record = await tx.approvalRecord.findUnique({ where: { id: input.approvalRecordId } });
    if (!record) throw new ApprovalNotFoundError(input.approvalRecordId);
    if (record.recordStatus !== "ACTIVE" || record.decision !== "PENDING") {
      throw new ApprovalStateError("僅 recordStatus=ACTIVE 且 decision=PENDING 的核准紀錄可被決策");
    }

    assertNotSelfApproval(record.requestedByUserId, input.actorUserId);

    // 信任邊界核心：現場重新查詢＋重新判斷，忽略任何呼叫端可能附帶的資格宣稱。
    const actualAuthority = await resolveActualAuthorityForDecision(tx, record, input.actorUserId, now);

    if (input.decision === "APPROVED") {
      const riskChecks = await tx.stageRiskCheck.findMany({ where: { approvalRecordId: record.id } });
      assertNoUnresolvedUnknownRisks(riskChecks);
    }

    const fields = authoritySourceToRecordFields(actualAuthority);

    return tx.approvalRecord.update({
      where: { id: record.id },
      data: {
        decision: input.decision,
        decidedAt: now,
        approverUserId: actualAuthority.userId,
        decisionReasonCode: input.decisionReasonCode ?? null,
        decisionComment: input.decisionComment ?? null,
        ...fields,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// 決策：CANCELLED（不涉及核准資格判斷，不受本輪信任邊界調整影響）
// ---------------------------------------------------------------------------

export async function cancelApprovalRecord(
  approvalRecordId: string,
  decisionReasonCode?: string | null,
  decisionComment?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const record = await tx.approvalRecord.findUnique({ where: { id: approvalRecordId } });
    if (!record) throw new ApprovalNotFoundError(approvalRecordId);
    if (record.recordStatus !== "ACTIVE" || record.decision !== "PENDING") {
      throw new ApprovalStateError("僅 recordStatus=ACTIVE 且 decision=PENDING 的核准紀錄可被取消");
    }
    return tx.approvalRecord.update({
      where: { id: record.id },
      data: {
        decision: "CANCELLED",
        decidedAt: new Date(),
        decisionReasonCode: decisionReasonCode ?? null,
        decisionComment: decisionComment ?? null,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// recordStatus：INVALIDATED（原 APPROVED 紀錄因內容變更而追溯失效）
// ---------------------------------------------------------------------------

export async function invalidateApprovalRecord(approvalRecordId: string, invalidationReason: string) {
  if (!invalidationReason) {
    throw new ApprovalValidationError(["invalidationReason 不得為空"]);
  }
  return prisma.$transaction(async (tx) => {
    const record = await tx.approvalRecord.findUnique({ where: { id: approvalRecordId } });
    if (!record) throw new ApprovalNotFoundError(approvalRecordId);
    if (record.recordStatus !== "ACTIVE" || record.decision !== "APPROVED") {
      throw new ApprovalStateError("僅 recordStatus=ACTIVE 且 decision=APPROVED 的核准紀錄可被 INVALIDATED");
    }
    return tx.approvalRecord.update({
      where: { id: record.id },
      data: { recordStatus: "INVALIDATED", invalidatedAt: new Date(), invalidationReason },
    });
  });
}

// ---------------------------------------------------------------------------
// recordStatus：SUPERSEDED（重新送核，形成單一 revision 取代鏈）
// ---------------------------------------------------------------------------

export interface ResubmitApprovalInput extends CreatePendingApprovalInput {
  previousApprovalRecordId: string;
}

// 將 REJECTED／CANCELLED 的舊紀錄標記為 SUPERSEDED，並建立 revisionNo+1 的新 PENDING 紀錄，
// supersedesApprovalRecordId 指向舊紀錄 id（DB 層 @unique 保證每筆舊紀錄至多被取代一次，
// 形成單一鏈，不得分岔）。核准資格來源解析規則與 createPendingApprovalRecord 相同，
// 同樣不接受呼叫端指定 teamId／authorityType 等欄位。
export async function resubmitApprovalRecord(input: ResubmitApprovalInput) {
  validateBasicCreateInput(input);
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const previous = await tx.approvalRecord.findUnique({ where: { id: input.previousApprovalRecordId } });
      if (!previous) throw new ApprovalNotFoundError(input.previousApprovalRecordId);
      if (previous.recordStatus !== "ACTIVE") {
        throw new ApprovalStateError("僅 recordStatus=ACTIVE 的核准紀錄可被重新送核取代");
      }
      if (!RESUBMITTABLE_DECISIONS.includes(previous.decision as (typeof RESUBMITTABLE_DECISIONS)[number])) {
        throw new ApprovalStateError("僅 decision=REJECTED／CANCELLED 的核准紀錄可被重新送核取代");
      }

      if (RISK_CHECK_GATED_TYPES.has(input.approvalType)) {
        await assertRiskChecksReadyForSubmission(tx, input.issueId, input.relatedStageKey);
      }

      const { expected, teamId } = await resolveExpectedAuthorityForCreation(
        tx,
        input.issueId,
        input.approvalType,
        input.requestedByUserId,
        now,
      );

      const existing = await tx.approvalRecord.findFirst({
        where: {
          issueId: input.issueId,
          approvalType: input.approvalType,
          relatedStageKey: input.relatedStageKey,
          recordStatus: "ACTIVE",
          decision: "PENDING",
        },
      });
      if (existing) {
        throw new DuplicateActivePendingApprovalError(input.issueId, input.approvalType, input.relatedStageKey);
      }

      const fields = authoritySourceToRecordFields(expected);
      const created = await tx.approvalRecord.create({
        data: {
          issueId: input.issueId,
          approvalType: input.approvalType,
          relatedStageKey: input.relatedStageKey,
          requestedByUserId: input.requestedByUserId,
          approverTeamId: teamId,
          expectedApproverUserId: expected.userId,
          dueAt: input.dueAt ?? null,
          revisionNo: previous.revisionNo + 1,
          supersedesApprovalRecordId: previous.id,
          ...fields,
        },
      });
      await tx.approvalRecord.update({ where: { id: previous.id }, data: { recordStatus: "SUPERSEDED" } });
      return created;
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateActivePendingApprovalError(input.issueId, input.approvalType, input.relatedStageKey);
    }
    throw err;
  }
}

export function isKnownApprovalType(value: string): value is ApprovalType {
  return (APPROVAL_TYPES as readonly string[]).includes(value);
}
