// C2-B1：Authentication Integration Services — 型別契約。
//
// 安全邊界：本模組建立在 C2-A Provider Contract（`src/lib/auth-providers`）之上的
// 下一層純決策抽象。本檔案只定義「身分連結／JIT／群組映射／登入協調」四個決策
// 流程的輸入輸出形狀，不涉及任何實際資料存取（見 ports.ts）、不接管 Session、
// 不 import Prisma。所有型別只承載「決策」「計畫」「命令描述」「Audit event
// descriptor」，不承載任何已經真正生效的授權（授權寫入留給未來 C2-B2）。
//
// 兩個結構性防線（設計即防禦，而非只靠執行期判斷）：
//   - GroupMappingRule／SuggestedTeamCommand 完全沒有「Team LEAD」「主管」
//     「代理」「核准權」相關欄位——這些概念在型別層級就不存在，因此群組映射
//     不可能產生此類建議。
//   - FORBIDDEN_JIT_ROLE_KEYS／isForbiddenRoleKey 是 JIT 與群組映射共用的唯一
//     Admin 阻擋清單，決策函式與驗證函式都必須參照同一份清單。

import type { NormalizedExternalIdentity } from "../auth-providers";

// ===========================================================================
// 共用：禁止事項清單
// ===========================================================================

/** JIT／群組映射一律不得建議指派的角色（大小寫不敏感比對）。目前僅 Admin。 */
export const FORBIDDEN_JIT_ROLE_KEYS: readonly string[] = ["Admin"];

export function isForbiddenRoleKey(roleKey: string): boolean {
  const normalized = roleKey.trim().toLowerCase();
  return FORBIDDEN_JIT_ROLE_KEYS.some((forbidden) => forbidden.toLowerCase() === normalized);
}

// ===========================================================================
// 內部使用者投影 — Ports 讀取後回傳的最小形狀（見 ports.ts）
// ===========================================================================

export interface InternalUserProjection {
  readonly userId: string;
  readonly loginIdentifier: string | null;
  readonly email: string | null;
  readonly displayName: string;
  readonly isAdmin: boolean;
  readonly active: boolean;
}

export type IdentityLinkStatus = "ACTIVE" | "REVOKED";

export interface ExistingIdentityLink {
  readonly userId: string;
  readonly providerKey: string;
  readonly status: IdentityLinkStatus;
}

// ===========================================================================
// Identity Linking — 純決策
// ===========================================================================

export type IdentityLinkDecisionType = "LINK_EXISTING" | "CREATE_NEW" | "REQUIRE_REVIEW" | "REJECT";

export type IdentityLinkReasonCode =
  | "EXISTING_LINK_FOUND"
  | "UNIQUE_LOGIN_IDENTIFIER_MATCH"
  | "MULTIPLE_LOGIN_IDENTIFIER_CANDIDATES"
  | "EMAIL_MATCH_ALLOWED_BY_POLICY"
  | "MULTIPLE_EMAIL_CANDIDATES"
  | "EMAIL_MATCHING_DISABLED_BY_POLICY"
  | "NO_CANDIDATE_FOUND"
  | "MATCH_TARGETS_ADMIN_ACCOUNT"
  | "EXISTING_LINK_REVOKED";

export interface IdentityLinkDecision {
  readonly decision: IdentityLinkDecisionType;
  readonly reasonCode: IdentityLinkReasonCode;
  readonly explanation: string;
  /** 僅 LINK_EXISTING 時非 null。 */
  readonly matchedUserId: string | null;
  /** REQUIRE_REVIEW 時的候選集合；其餘情況為空陣列。 */
  readonly candidateUserIds: readonly string[];
}

/**
 * Email 比對政策。allowEmailMatching 預設必須為 false（見 createDefaultIdentityLinkPolicy）—
 * 呼叫端刻意傳入 true 才會啟用 email 比對，本模組不提供「自動判斷何時該打開」的邏輯。
 */
export interface IdentityLinkPolicy {
  readonly allowEmailMatching: boolean;
}

export function createDefaultIdentityLinkPolicy(): IdentityLinkPolicy {
  return { allowEmailMatching: false };
}

export interface IdentityLinkInput {
  readonly identity: NormalizedExternalIdentity;
  /** 呼叫端必須以 (providerKey, subject) 複合鍵查詢——不同 Provider 的 subject 不共用同一個 link。 */
  readonly existingLink: ExistingIdentityLink | null;
  readonly loginIdentifierCandidates: readonly InternalUserProjection[];
  /**
   * 呼叫端可預先查出 email 候選並傳入；但本函式仍會依 policy.allowEmailMatching
   * 自行決定是否採用——即使呼叫端誤傳了候選名單，policy 關閉時一律忽略，
   * 這是刻意的縱深防禦，不依賴呼叫端「記得不要查」。
   */
  readonly emailCandidates: readonly InternalUserProjection[];
  readonly policy: IdentityLinkPolicy;
}

// ===========================================================================
// JIT Provisioning — 純決策
// ===========================================================================

export type JitProvisioningOutcome = "ALLOWED" | "REQUIRES_APPROVAL" | "BLOCKED";

export type JitReasonCode =
  | "JIT_DISABLED_BY_POLICY"
  | "MISSING_REQUIRED_FIELDS"
  | "CONFLICTING_ACTIVE_ACCOUNT"
  | "DEFAULT_ROLE_FORBIDDEN"
  | "ALLOWED_REQUIRES_APPROVAL_BY_POLICY"
  | "ALLOWED_NO_APPROVAL_REQUIRED";

export type ProposedInitialStatus = "PENDING_APPROVAL" | "ACTIVE";

export interface ProposedUserProfile {
  readonly loginIdentifier: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly department: string | null;
  readonly initialStatus: ProposedInitialStatus;
}

export type SuggestedCommandOrigin = "JIT_DEFAULT" | "GROUP_MAPPING";

/** 只描述「建議指派某系統角色」——不代表已經寫入 UserRole，且結構上永遠不含 Admin（由 decide 函式保證）。 */
export interface SuggestedRoleCommand {
  readonly kind: "ASSIGN_ROLE";
  readonly roleKey: string;
  readonly requiresApproval: boolean;
  readonly origin: SuggestedCommandOrigin;
  readonly reasonCode: string;
}

/**
 * 只描述「建議加入某 Team」——刻意不存在 membershipRole 欄位，因此結構上不可能
 * 表達「建議設為 LEAD」；一律視為一般成員層級的建議。
 */
export interface SuggestedTeamCommand {
  readonly kind: "ASSIGN_TEAM_MEMBERSHIP";
  readonly teamKey: string;
  readonly requiresApproval: boolean;
  readonly origin: SuggestedCommandOrigin;
  readonly reasonCode: string;
}

export type SuggestedCommand = SuggestedRoleCommand | SuggestedTeamCommand;

export interface JitRoleCommandConfig {
  readonly roleKey: string;
  readonly requiresApproval: boolean;
}

export interface JitTeamCommandConfig {
  readonly teamKey: string;
  readonly requiresApproval: boolean;
}

/**
 * allowJit 預設必須為 false（fail closed）。defaultRoleCommand／defaultTeamCommand
 * 是本系統端設定的固定值，不得由外部 Provider（例如 identity.groups）決定——
 * decideJitProvisioning 內部也不會讀取 identity.groups 作為角色來源，確保
 * 「initial role 不可由 Provider 任意指定」在程式碼層級成立，而非只靠慣例。
 */
export interface JitProvisioningPolicy {
  readonly allowJit: boolean;
  readonly requireApprovalAlways: boolean;
  readonly defaultRoleCommand: JitRoleCommandConfig | null;
  readonly defaultTeamCommand: JitTeamCommandConfig | null;
}

export function createDefaultJitProvisioningPolicy(): JitProvisioningPolicy {
  return { allowJit: false, requireApprovalAlways: true, defaultRoleCommand: null, defaultTeamCommand: null };
}

export interface JitProvisioningInput {
  readonly identity: NormalizedExternalIdentity;
  /** 若 loginIdentifier 已被其他既有帳號使用（且沒有 provider link）則傳入該帳號，強制阻擋。 */
  readonly conflictingActiveUser: InternalUserProjection | null;
  readonly policy: JitProvisioningPolicy;
}

export interface JitProvisioningDecision {
  readonly outcome: JitProvisioningOutcome;
  readonly reasonCode: JitReasonCode;
  readonly explanation: string;
  readonly missingFields: readonly string[];
  readonly conflicts: readonly string[];
  readonly proposedProfile: ProposedUserProfile | null;
  readonly proposedCommands: readonly SuggestedCommand[];
}

// ===========================================================================
// Group Mapping Policy — 純決策
// ===========================================================================

/**
 * 單一映射規則。刻意不存在 membershipRole／supervisor／delegate／approvalAuthority
 * 欄位——群組映射的型別本身就無法表達「LEAD」「主管」「代理」「核准權」。
 * priority 數字越小＝優先權越高（用於角色／Team 衝突時決定 winner，衝突本身
 * 仍會被完整記錄，不會被優先權「靜默吃掉」）。
 */
export interface GroupMappingRule {
  readonly id: string;
  readonly externalGroupPattern: string;
  readonly targetRoleKey: string | null;
  readonly targetTeamKey: string | null;
  readonly priority: number;
  readonly enabled: boolean;
  readonly requiresApproval: boolean;
  /** 空陣列＝適用於所有 Provider；非空則必須包含目前的 providerKey 才會生效。 */
  readonly providerScope: readonly string[];
}

export interface GroupMappingSuggestion {
  readonly kind: "ROLE" | "TEAM";
  readonly key: string;
  readonly requiresApproval: boolean;
  readonly sourceRuleIds: readonly string[];
}

export type GroupMappingConflictKind = "ROLE_CONFLICT" | "TEAM_CONFLICT";

export interface GroupMappingConflict {
  readonly kind: GroupMappingConflictKind;
  readonly candidateKeys: readonly string[];
  readonly winningKey: string;
  readonly ruleIds: readonly string[];
}

export type GroupMappingSummaryReasonCode =
  | "NO_MATCH"
  | "SINGLE_MATCH"
  | "MULTIPLE_MATCHES_NO_CONFLICT"
  | "MULTIPLE_MATCHES_WITH_CONFLICT";

export interface GroupMappingEvaluation {
  readonly matchedRuleIds: readonly string[];
  readonly suggestions: readonly GroupMappingSuggestion[];
  readonly conflicts: readonly GroupMappingConflict[];
  readonly rejectedForbiddenRuleIds: readonly string[];
  readonly skippedDisabledRuleIds: readonly string[];
  readonly skippedOutOfScopeRuleIds: readonly string[];
  readonly requiresApproval: boolean;
  readonly reasonCode: GroupMappingSummaryReasonCode;
}

// ===========================================================================
// Login Orchestration — 協調流程（不接管 Session）
// ===========================================================================

export type LoginOrchestrationOutcomeType =
  | "PROCEED_LINK_EXISTING"
  | "PROCEED_CREATE_NEW"
  | "PENDING_REVIEW"
  | "REJECTED";

export type AuthAuditDecisionType =
  | "IDENTITY_LINK_DECISION"
  | "JIT_PROVISIONING_DECISION"
  | "GROUP_MAPPING_EVALUATION"
  | "LOGIN_ORCHESTRATION_OUTCOME"
  | "PROVIDER_AUTH_FAILURE"
  | "IDENTITY_VALIDATION_FAILURE";

/**
 * Audit event descriptor。至少描述 providerKey／subjectReference（雜湊，非明文
 * subject）／decisionType／result／reasonCode／timestamp／correlationId。detail
 * 一律經過 C2-A 的 redactMessage 處理，不重建新的 redaction 規則。
 */
export interface AuthAuditEvent {
  readonly providerKey: string;
  readonly subjectReference: string;
  readonly decisionType: AuthAuditDecisionType;
  readonly result: string;
  readonly reasonCode: string;
  readonly timestamp: Date;
  readonly correlationId: string;
  readonly detail: string;
}

export interface LoginIntegrationPlan {
  readonly correlationId: string;
  readonly providerKey: string;
  readonly identity: NormalizedExternalIdentity;
  readonly identityLinkDecision: IdentityLinkDecision;
  /** 僅 identityLinkDecision.decision === "CREATE_NEW" 時非 null。 */
  readonly jitDecision: JitProvisioningDecision | null;
  /** 僅 LINK_EXISTING／CREATE_NEW 時非 null（REQUIRE_REVIEW／REJECT 時無確定目標，不評估）。 */
  readonly groupMappingEvaluation: GroupMappingEvaluation | null;
  readonly suggestedCommands: readonly SuggestedCommand[];
  readonly requiresManualReview: boolean;
  readonly outcome: LoginOrchestrationOutcomeType;
  readonly reasonCode: string;
  readonly auditEvents: readonly AuthAuditEvent[];
}

export interface LoginOrchestrationSuccess {
  readonly ok: true;
  readonly plan: LoginIntegrationPlan;
}

export interface LoginOrchestrationFailure {
  readonly ok: false;
  readonly reasonCode: "PROVIDER_AUTHENTICATION_FAILED" | "IDENTITY_VALIDATION_FAILED";
  readonly explanation: string;
  readonly correlationId: string;
  readonly auditEvents: readonly AuthAuditEvent[];
}

export type LoginOrchestrationResult = LoginOrchestrationSuccess | LoginOrchestrationFailure;
