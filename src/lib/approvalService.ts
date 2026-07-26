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
//
// M1.5-A3：「核准責任目標」（supervisorAssignmentId／approverTeamId，依 approvalType 決定，
// 全生命週期不變）與「實際核准途徑」（approvalAuthorityType／approvalDelegationId／
// delegatedFromUserId，PENDING 時恆為 null，只有決策完成後才寫入）語意分離。
// ---------------------------------------------------------------------------

export interface ApprovalRecordConsistencyInput {
  approvalType: string;
  decision: string;
  recordStatus: string;
  decidedAt: Date | null;
  approverUserId: string | null;
  approverTeamId: string | null;
  approvalAuthorityType: string | null;
  supervisorAssignmentId: string | null;
  approvalDelegationId: string | null;
  delegatedFromUserId: string | null;
  decisionReasonCode: string | null;
  decisionComment: string | null;
  revisionNo: number;
  supersedesApprovalRecordId: string | null;
  invalidatedAt: Date | null;
  invalidationReason: string | null;
}

export type ConsistencyCheckResult = { ok: true } | { ok: false; issues: string[] };

// 檢查 ApprovalRecord 各欄位彼此是否一致；deny-by-default，任何未通過項目皆列於 issues。
export function checkApprovalRecordConsistency(r: ApprovalRecordConsistencyInput): ConsistencyCheckResult {
  const issues: string[] = [];

  if (!isApprovalType(r.approvalType)) issues.push("approvalType 不在合法值域");
  if (!isApprovalDecision(r.decision)) issues.push("decision 不在合法值域");
  if (!isApprovalRecordStatus(r.recordStatus)) issues.push("recordStatus 不在合法值域");
  if (r.approvalAuthorityType !== null && !isApprovalAuthorityType(r.approvalAuthorityType)) {
    issues.push("approvalAuthorityType 非 null 時必須在合法值域內");
  }

  // 核准責任目標：由 approvalType 決定，PENDING 與已決策皆須維持，不隨實際核准途徑改變。
  const isTeamLeadType = r.approvalType === "RD_LEAD_APPROVAL" || r.approvalType === "QA_LEAD_APPROVAL" || r.approvalType === "DEPLOYMENT_APPROVAL";
  const isBusinessType = r.approvalType === "BUSINESS_APPROVAL";
  if (isBusinessType) {
    if (!r.supervisorAssignmentId) issues.push("approvalType=BUSINESS_APPROVAL 時 supervisorAssignmentId（核准責任目標）不得為空");
    if (r.approverTeamId !== null) issues.push("approvalType=BUSINESS_APPROVAL 時 approverTeamId 必須為 null");
  }
  if (isTeamLeadType) {
    if (!r.approverTeamId) issues.push(`approvalType=${r.approvalType} 時 approverTeamId（核准責任目標）不得為空`);
    if (r.supervisorAssignmentId !== null) issues.push(`approvalType=${r.approvalType} 時 supervisorAssignmentId 必須為 null`);
  }

  if (r.decision === "PENDING") {
    if (r.decidedAt !== null) issues.push("decision=PENDING 時 decidedAt 必須為 null");
    if (r.approverUserId !== null) issues.push("decision=PENDING 時 approverUserId 必須為 null");
    if (r.approvalAuthorityType !== null) issues.push("decision=PENDING 時 approvalAuthorityType 必須為 null（實際核准途徑尚未發生）");
    if (r.approvalDelegationId !== null) issues.push("decision=PENDING 時 approvalDelegationId 必須為 null");
    if (r.delegatedFromUserId !== null) issues.push("decision=PENDING 時 delegatedFromUserId 必須為 null");
    if (r.decisionReasonCode !== null) issues.push("decision=PENDING 時 decisionReasonCode 必須為 null");
    if (r.decisionComment !== null) issues.push("decision=PENDING 時 decisionComment 必須為 null");
  }
  if (r.decision === "APPROVED" || r.decision === "REJECTED") {
    if (r.decidedAt === null) issues.push(`decision=${r.decision} 時 decidedAt 不得為 null`);
    if (r.approverUserId === null) issues.push(`decision=${r.decision} 時 approverUserId 不得為 null`);
    if (r.approvalAuthorityType === null) issues.push(`decision=${r.decision} 時 approvalAuthorityType 不得為 null（實際核准途徑必須已解析）`);
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

  // 實際核准途徑三種類型彼此互斥的欄位組合（僅在 approvalAuthorityType 非 null 時適用）。
  if (r.approvalAuthorityType === "DIRECT_SUPERVISOR") {
    if (!r.supervisorAssignmentId) issues.push("approvalAuthorityType=DIRECT_SUPERVISOR 時 supervisorAssignmentId 不得為空");
    if (r.approvalDelegationId) issues.push("approvalAuthorityType=DIRECT_SUPERVISOR 時 approvalDelegationId 必須為 null");
    if (r.delegatedFromUserId) issues.push("approvalAuthorityType=DIRECT_SUPERVISOR 時 delegatedFromUserId 必須為 null");
  }
  if (r.approvalAuthorityType === "DELEGATE") {
    if (!r.approvalDelegationId) issues.push("approvalAuthorityType=DELEGATE 時 approvalDelegationId 不得為空");
    if (!r.delegatedFromUserId) issues.push("approvalAuthorityType=DELEGATE 時 delegatedFromUserId 不得為空");
  }
  if (r.approvalAuthorityType === "TEAM_LEAD") {
    if (r.approvalDelegationId) issues.push("approvalAuthorityType=TEAM_LEAD 時 approvalDelegationId 必須為 null");
    if (r.delegatedFromUserId) issues.push("approvalAuthorityType=TEAM_LEAD 時 delegatedFromUserId 必須為 null");
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
  // C1-B：已停用（User.isActive=false）成員不得因仍保留 TeamMember／LEAD 紀錄而成為核准候選人。
  const rows = await tx.teamMember.findMany({ where: { teamId, user: { isActive: true } } });
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
  // C1-B：已停用主管不得繼續成為合法核准候選人來源。
  const rows = await tx.userSupervisorAssignment.findMany({ where: { userId, supervisor: { isActive: true } } });
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
  // C1-B：委任來源（delegator）或代理人（delegate）任一方已停用時，該筆代理一律不得生效。
  const rows = await tx.approvalDelegation.findMany({
    where: { approvalType, delegator: { isActive: true }, delegate: { isActive: true } },
  });
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

// expectedApproverUserId 僅為 UI 顯示／通知輔助資訊，絕非授權依據（實際授權一律由
// resolveActualAuthorityForDecision 於決策當下現場重新解析）。deny-by-default：
// 只有在「決策當下只有唯一一位合格核准人」時才可明確指名；只要存在兩位以上合格候選人
// （例如主管本人＋其代理人、或同一團隊多位 LEAD），一律回傳 null，不得依資料庫回傳順序、
// 型別優先度或任何啟發式任選其一。候選人陣列順序不影響本函式結果。
export function pickExpectedApproverUserId(eligible: readonly ApprovalAuthoritySource[]): string | null {
  return eligible.length === 1 ? eligible[0].userId : null;
}

// 建立階段（尚無決策）：只解析「核准責任目標」（supervisorAssignmentId／approverTeamId，
// 由 approvalType 決定、與哪位候選人最終核准無關）與「預期核准人顯示值」
// （expectedApproverUserId，見 pickExpectedApproverUserId）。
//
// M1.5-A3：PENDING 階段絕不解析或預先任選「實際核准途徑」（approvalAuthorityType／
// approvalDelegationId／delegatedFromUserId）——核准尚未發生時，可能同時存在直屬主管、
// 其代理人、多位 Team LEAD 或其代理人，任選一種當作實際途徑會誤導稽核紀錄。
// supervisorAssignmentId 對 BUSINESS_APPROVAL 是結構上單一值（同一使用者至多一筆有效
// primary 主管指派，且僅在該主管已解析時 eligible 才可能非空），因此直接取該筆 assignment id，
// 不需要在多位「候選人」之間任選；approverTeamId 則單純等於 Issue.assignedTeamId，與候選人
// 完全無關。兩者皆非「任選核准途徑」，而是決定性的責任目標。
// TEAM_LEAD 類型的目標團隊一律取自 Issue.assignedTeamId（現有 DB 權威來源），
// 不接受呼叫端自行指定 teamId，避免呼叫端指定任意團隊使自己成為該團隊 LEAD 而取得資格。
async function resolveExpectedAuthorityForCreation(
  tx: Tx,
  issueId: string,
  approvalType: ApprovalType,
  requestedByUserId: string,
  now: Date,
): Promise<{ expectedApproverUserId: string | null; teamId: string | null; supervisorAssignmentId: string | null }> {
  const issue = await tx.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new ApprovalValidationError(["issueId 對應的 Issue 不存在"]);

  const isTeamLeadType = RISK_CHECK_GATED_TYPES.has(approvalType);
  const teamId = isTeamLeadType ? issue.assignedTeamId : null;
  if (isTeamLeadType && !teamId) {
    throw new ApprovalValidationError(["Issue 尚未指派處理團隊（assignedTeamId 為 null），無法解析核准資格"]);
  }

  const eligible = await fetchEligibleApproversInTx(tx, { approvalType, requestedByUserId, teamId, now });
  if (eligible.length === 0) {
    throw new ApprovalValidationError(["找不到合格的核准資格來源，不得建立核准紀錄"]);
  }

  const expectedApproverUserId = pickExpectedApproverUserId(eligible);
  if (expectedApproverUserId !== null && expectedApproverUserId === requestedByUserId) {
    throw new ApprovalValidationError(["預期核准人與送核人相同，不得建立此核准紀錄"]);
  }

  const directSupervisorEntry = eligible.find(
    (e): e is Extract<ApprovalAuthoritySource, { authorityType: "DIRECT_SUPERVISOR" }> => e.authorityType === "DIRECT_SUPERVISOR",
  );
  const supervisorAssignmentId = isTeamLeadType ? null : (directSupervisorEntry?.supervisorAssignmentId ?? null);

  return { expectedApproverUserId, teamId, supervisorAssignmentId };
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

// 決策階段專用：只計算「實際核准途徑」欄位（approvalAuthorityType／approvalDelegationId／
// delegatedFromUserId）。核准責任目標欄位（supervisorAssignmentId／approverTeamId）建立時
// 即已寫入且全生命週期不變，決策一律不得清空或改動——DELEGATE／TEAM_LEAD 途徑時完全不觸碰
// supervisorAssignmentId（回傳物件不含此鍵，Prisma update 不會更動該欄位）；唯一例外是
// DIRECT_SUPERVISOR 途徑：此時重新以決策當下現場解析出的 assignment id 覆寫，確保
// 「approverUserId 必須等於該 Assignment 的 supervisorUserId」在組織異動後仍保持一致
// （多數情況下與建立時寫入的值相同，僅在決策前主管異動的極端情況才會不同）。
function decisionAuthorityFields(source: ApprovalAuthoritySource): {
  approvalAuthorityType: ApprovalAuthoritySource["authorityType"];
  approvalDelegationId: string | null;
  delegatedFromUserId: string | null;
  supervisorAssignmentId?: string;
} {
  if (source.authorityType === "DIRECT_SUPERVISOR") {
    return {
      approvalAuthorityType: "DIRECT_SUPERVISOR",
      approvalDelegationId: null,
      delegatedFromUserId: null,
      supervisorAssignmentId: source.supervisorAssignmentId,
    };
  }
  if (source.authorityType === "DELEGATE") {
    return {
      approvalAuthorityType: "DELEGATE",
      approvalDelegationId: source.approvalDelegationId,
      delegatedFromUserId: source.onBehalfOfUserId,
    };
  }
  return { approvalAuthorityType: "TEAM_LEAD", approvalDelegationId: null, delegatedFromUserId: null };
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

      const { expectedApproverUserId, teamId, supervisorAssignmentId } = await resolveExpectedAuthorityForCreation(
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

      // PENDING 建立時只寫入「核准責任目標」，「實際核准途徑」三欄位一律維持 null，
      // 待決策完成後才由 decideApprovalRecord 現場解析寫入。
      return tx.approvalRecord.create({
        data: {
          issueId: input.issueId,
          approvalType: input.approvalType,
          relatedStageKey: input.relatedStageKey,
          requestedByUserId: input.requestedByUserId,
          approverTeamId: teamId,
          supervisorAssignmentId,
          expectedApproverUserId,
          approvalAuthorityType: null,
          approvalDelegationId: null,
          delegatedFromUserId: null,
          dueAt: input.dueAt ?? null,
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

    const fields = decisionAuthorityFields(actualAuthority);

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

      const { expectedApproverUserId, teamId, supervisorAssignmentId } = await resolveExpectedAuthorityForCreation(
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

      // 新 revision 一律以全新 PENDING 狀態建立：只寫入核准責任目標，實際核准途徑三欄位維持 null，
      // 不得沿用舊 revision 決策時解析出的途徑。
      const created = await tx.approvalRecord.create({
        data: {
          issueId: input.issueId,
          approvalType: input.approvalType,
          relatedStageKey: input.relatedStageKey,
          requestedByUserId: input.requestedByUserId,
          approverTeamId: teamId,
          supervisorAssignmentId,
          expectedApproverUserId,
          approvalAuthorityType: null,
          approvalDelegationId: null,
          delegatedFromUserId: null,
          dueAt: input.dueAt ?? null,
          revisionNo: previous.revisionNo + 1,
          supersedesApprovalRecordId: previous.id,
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

// ---------------------------------------------------------------------------
// C1-B4 新增：供 People／Team／Deactivation 等其他領域判斷「排除某人後核准候選人是否
// 歸零」使用。其他領域一律呼叫本函式取得目前合法候選人名單，不得另行複製
// fetchTeamMembershipsLike／fetchSupervisorAssignmentsLike／fetchDelegationsLike 等
// 私有查詢邏輯——全系統只有這一套 eligibility 判斷路徑。
// ---------------------------------------------------------------------------

export async function getEligibleApproverUserIdsInTx(
  tx: Tx,
  record: { approvalType: string; requestedByUserId: string; approverTeamId: string | null },
  now: Date = new Date(),
): Promise<string[]> {
  if (!isApprovalType(record.approvalType)) return [];
  const eligible = await fetchEligibleApproversInTx(tx, {
    approvalType: record.approvalType,
    requestedByUserId: record.requestedByUserId,
    teamId: record.approverTeamId,
    now,
  });
  return eligible.map((e) => e.userId);
}
