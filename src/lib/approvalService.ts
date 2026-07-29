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
import { deriveRiskChecksForStage, type RiskDerivationContext } from "./riskCheckDerivation";

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

// 建立工單／團隊整合修正新增：找不到任何合格核准來源時使用的專用錯誤類別，訊息一律是可
// 直接顯示給使用者的中文友善訊息，不暴露 ApprovalRecord／Prisma／stageKey 等技術字眼；
// 不得以「猜一個核准人」代替。
//
// 送簽核准人規則修正：第 2 關（申請人直屬主管）與第 4／6／8 關（RD／QA／OP 承接團隊主管）
// 缺少的東西本質不同——後者缺的不是「一般人事直屬主管」，而是「可核准本階段工作的承接團隊
// 主管或核准代理人」（常見情境：執行人本人就是該團隊唯一主管，依防自我核准規則被排除後就
// 沒有其他人選）。因此訊息必須依 approvalType 分流，且明確指出使用者可以去哪裡完成設定，
// 不得一律顯示「未設定直屬主管」。
const NO_ELIGIBLE_APPROVER_MESSAGES: Record<string, string> = {
  BUSINESS_APPROVAL: "申請人尚未設定直屬主管或授權代理人。請至『人員』設定直屬主管，或至『核准治理設定』設定核准代理人。",
  RD_LEAD_APPROVAL: "目前承接團隊沒有其他可核准此工單的 RD 主管或授權代理人。請至『團隊』設定其他團隊主管，或至『核准治理設定』設定核准代理人。",
  QA_LEAD_APPROVAL: "目前承接團隊沒有其他可核准此工單的 QA 主管或授權代理人。請至『團隊』設定其他團隊主管，或至『核准治理設定』設定核准代理人。",
  DEPLOYMENT_APPROVAL: "目前承接團隊沒有其他可核准此工單的 OP 主管或授權代理人。請至『團隊』設定其他團隊主管，或至『核准治理設定』設定核准代理人。",
};

export class NoEligibleApproverError extends Error {
  constructor(public readonly approvalType: string) {
    super(
      NO_ELIGIBLE_APPROVER_MESSAGES[approvalType] ??
        "目前承接團隊沒有其他可核准此工單的主管或授權代理人。請至『團隊』設定其他團隊主管，或至『核准治理設定』設定核准代理人。",
    );
    this.name = "NoEligibleApproverError";
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

// 風險檢核死結修正：message 是會被 toActionResult 原樣顯示在畫面上的字串，因此一律不得
// 包含 stageKey、資料表名稱或內部 guard 名稱。技術細節保留在 stageKey／issues 屬性上，
// 供 server log 與測試斷言使用，不進入使用者可見訊息。
export class RiskCheckIncompleteError extends Error {
  constructor(
    public readonly stageKey: string,
    public readonly issues: string[],
  ) {
    super("本關卡的風險檢核尚未完成，暫時無法送出簽核。請確認本關卡必填內容均已填寫後再送出，或聯絡系統管理員協助確認。");
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

// 風險檢核死結修正：送核 transaction 內，先由「既有正式工單資料」建立／更新系統推導的
// StageRiskCheck 紀錄，再執行前置檢核。
//
// 為什麼需要這一步：這 8 項固定檢核從未有任何使用者可完成的填答畫面（唯一寫入入口
// submitStageRiskCheckAnswer 只有 verify script 呼叫），使用者填完畫面上所有必填欄位後仍會
// 被「尚無任何風險檢核紀錄」擋住且無法自救。風險檢核本身仍是必要控制，因此不是移除檢核，
// 而是改由既有資料（工單風險等級／環境／影響正式環境／RCA 與風險例外註記／本關卡既有
// IssueFieldValue）自動推導出檢核結果，主管仍看得到完整 8 項結果。
//
// 覆寫規則（deny-by-default 的相反面：不得覆寫人工判斷）：
//   - answeredByUserId 非 null＝人工填答（透過 submitStageRiskCheckAnswer），一律保留不動。
//   - answeredByUserId 為 null＝系統推導，可隨最新工單資料更新（RD 修改內容後重新送核時，
//     推導結果必須跟著更新，否則會留下與現況不符的稽核紀錄）。
async function ensureDerivedRiskChecks(tx: Tx, issueId: string, stageKey: string): Promise<void> {
  const derived = deriveRiskChecksForStage(stageKey, await loadRiskDerivationContext(tx, issueId));
  if (derived.length === 0) return;

  const existingRows = await tx.stageRiskCheck.findMany({ where: { issueId, stageKey } });
  const round = existingRows.length > 0 ? Math.max(...existingRows.map((r) => r.assessmentRound)) : 1;
  const now = new Date();

  for (const item of derived) {
    const existing = existingRows.find((r) => r.assessmentRound === round && r.checkKey === item.checkKey);
    if (existing && existing.answeredByUserId !== null) continue; // 人工填答優先，不覆寫

    if (existing) {
      await tx.stageRiskCheck.update({
        where: { id: existing.id },
        data: { answer: item.answer, detail: item.detail, answeredAt: now, resolvedAt: null },
      });
    } else {
      await tx.stageRiskCheck.create({
        data: {
          issueId,
          stageKey,
          assessmentRound: round,
          checkKey: item.checkKey,
          answer: item.answer,
          detail: item.detail,
          answeredByUserId: null, // 標記為系統推導，與人工填答區分
          answeredAt: now,
        },
      });
    }
  }
}

// 推導所需的既有正式資料，全部現場查詢，不接受呼叫端傳入。
async function loadRiskDerivationContext(tx: Tx, issueId: string): Promise<RiskDerivationContext> {
  const issue = await tx.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new ApprovalValidationError(["issueId 對應的 Issue 不存在"]);
  const rows = await tx.issueFieldValue.findMany({ where: { issueId } });
  const fieldValues: Record<string, string> = {};
  for (const row of rows) fieldValues[row.fieldKey] = row.fieldValue;
  return {
    riskLevel: issue.riskLevel,
    environment: issue.environment,
    impactProduction: issue.impactProduction,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    fieldValues,
  };
}

// 送核前置條件（DB 版本）：先補齊系統推導紀錄，再查詢 issueId+stageKey 目前最新一輪
// StageRiskCheck，套用 assertAllRiskChecksAnswered。不得信任呼叫端自行宣稱「已填答」，
// 一律以 DB 現況為準；ensureDerivedRiskChecks 之後仍然沒有紀錄的情況只可能是模板缺漏等
// 系統異常，仍必須 fail closed，不得放行。
async function assertRiskChecksReadyForSubmission(tx: Tx, issueId: string, stageKey: string): Promise<void> {
  await ensureDerivedRiskChecks(tx, issueId, stageKey);

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

  // 送簽核准人規則修正：防自我核准必須在「解析核准人」這一步就生效，而不是等到建立紀錄後
  // 才用 ApprovalValidationError 擋下——執行人同時是該團隊唯一主管（例：RD 執行人 Yonnve 也是
  // 「創新應用開發」唯一 LEAD）時，舊流程會先把他自己選成 expectedApprover，再丟出
  // 「ApprovalRecord 驗證失敗：預期核准人與送核人相同」這種技術訊息。
  //
  // 正確語意：送核人本人一律不是本階段的合格核准人選，先從候選名單移除，再判斷是否還有
  // 同團隊其他 active LEAD 或正式 ApprovalDelegation 核准代理人。移除後名單為空時 fail closed，
  // 並丟出依 approvalType 分流的友善業務訊息（見 NO_ELIGIBLE_APPROVER_MESSAGES）。
  // RD／QA／OP 三關共用完全相同的規則，不分別實作。
  const selectable = eligible.filter((e) => e.userId !== requestedByUserId);
  if (selectable.length === 0) {
    throw new NoEligibleApproverError(approvalType);
  }

  const expectedApproverUserId = pickExpectedApproverUserId(selectable);

  const directSupervisorEntry = selectable.find(
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

async function createPendingApprovalRecordTx(tx: Tx, input: CreatePendingApprovalInput) {
  const now = new Date();

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
}

// 以 transaction 檢查同一 issueId+approvalType+relatedStageKey 是否已存在 ACTIVE+PENDING 紀錄，
// 資料庫層另有 partial unique index（見 migration.sql）作為最終防線。
//
// M2-B1 新增：可選的外部 transaction client（比照 writeAuditLog(params, client?) 既有慣例）。
// Issue Workflow 執行引擎（src/lib/workflow-execution/）進入 APPROVAL 關卡時，必須在同一
// transaction 內同時寫入 Issue runtime 欄位、IssueWorkflowStageHistory 與本筆 ApprovalRecord，
// 三者要嘛全部成功、要嘛全部回滾——因此本函式不得永遠自行開啟新的 transaction。呼叫端不傳入
// client 時（既有呼叫端，例如未來直接測試本服務）行為與過去完全相同：自行開啟並提交
// transaction。本函式本身不寫 AuditLog——PENDING 建立事件的 AuditLog（"ApprovalRequested"）
// 由呼叫端（例如 workflow-execution 的 requirementService.createRequiredApprovalRecord）
// 在同一 transaction 內、緊接著呼叫本函式之後補寫，因為只有呼叫端知道「這筆核准是因為哪個
// WorkflowStage 而觸發」等上下文摘要內容。
export async function createPendingApprovalRecord(input: CreatePendingApprovalInput, client?: Tx) {
  validateBasicCreateInput(input);

  try {
    if (client) return await createPendingApprovalRecordTx(client, input);
    return await prisma.$transaction((tx) => createPendingApprovalRecordTx(tx, input));
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

async function cancelApprovalRecordTx(
  tx: Tx,
  approvalRecordId: string,
  decisionReasonCode?: string | null,
  decisionComment?: string | null,
) {
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
}

// M2-B1 相同慣例新增：可選的外部 transaction client——Admin 改派申請人／團隊時，需要在同一
// transaction 內「取消舊 PENDING 核准紀錄＋更新 Issue＋建立新 PENDING 核准紀錄」，三者要嘛
// 全部成功、要嘛全部回滾，不得另開 transaction。呼叫端不傳入 client 時行為與過去完全相同。
export async function cancelApprovalRecord(
  approvalRecordId: string,
  decisionReasonCode?: string | null,
  decisionComment?: string | null,
  client?: Tx,
) {
  if (client) return cancelApprovalRecordTx(client, approvalRecordId, decisionReasonCode, decisionComment);
  return prisma.$transaction((tx) => cancelApprovalRecordTx(tx, approvalRecordId, decisionReasonCode, decisionComment));
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

async function resubmitApprovalRecordTx(tx: Tx, input: ResubmitApprovalInput) {
  const now = new Date();

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
}

// 將 REJECTED／CANCELLED 的舊紀錄標記為 SUPERSEDED，並建立 revisionNo+1 的新 PENDING 紀錄，
// supersedesApprovalRecordId 指向舊紀錄 id（DB 層 @unique 保證每筆舊紀錄至多被取代一次，
// 形成單一鏈，不得分岔）。核准資格來源解析規則與 createPendingApprovalRecord 相同，
// 同樣不接受呼叫端指定 teamId／authorityType 等欄位。
//
// M2-B1 新增：可選的外部 transaction client，理由與 createPendingApprovalRecord 相同——
// Issue 從 RETURN 目標關卡（例如 rdInProgress）重新 FORWARD 回到同一個 APPROVAL 關卡時，
// 執行引擎需要在同一個 stage-transition transaction 內判斷「這個 approvalType+relatedStageKey
// 是否已有可重新送核的舊紀錄」並建立新 revision，不得另開 transaction。
export async function resubmitApprovalRecord(input: ResubmitApprovalInput, client?: Tx) {
  validateBasicCreateInput(input);

  try {
    if (client) return await resubmitApprovalRecordTx(client, input);
    return await prisma.$transaction((tx) => resubmitApprovalRecordTx(tx, input));
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
