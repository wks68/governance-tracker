// C2-B1 Authentication Integration Services — 公開 API。
//
// 這是本模組唯一允許被外部 import 的入口。其他領域（People／Workflow／UI）
// 一律只能從這裡取用型別與函式，不得深入 import `auth-integration/**` 底下的
// 內部檔案。本階段（C2-B1）只建立身分連結／JIT／群組映射／登入協調的純決策
// 抽象，不修改 Schema、不接管正式登入、不寫正式 User 資料。

export type {
  // Identity Linking
  IdentityLinkDecisionType,
  IdentityLinkReasonCode,
  IdentityLinkDecision,
  IdentityLinkPolicy,
  IdentityLinkInput,
  IdentityLinkStatus,
  ExistingIdentityLink,
  InternalUserProjection,
  // JIT
  JitProvisioningOutcome,
  JitReasonCode,
  ProposedInitialStatus,
  ProposedUserProfile,
  JitRoleCommandConfig,
  JitTeamCommandConfig,
  JitProvisioningPolicy,
  JitProvisioningInput,
  JitProvisioningDecision,
  // Suggested commands
  SuggestedCommandOrigin,
  SuggestedRoleCommand,
  SuggestedTeamCommand,
  SuggestedCommand,
  // Group Mapping
  GroupMappingRule,
  GroupMappingSuggestion,
  GroupMappingConflictKind,
  GroupMappingConflict,
  GroupMappingSummaryReasonCode,
  GroupMappingEvaluation,
  // Orchestration
  LoginOrchestrationOutcomeType,
  AuthAuditDecisionType,
  AuthAuditEvent,
  LoginIntegrationPlan,
  LoginOrchestrationSuccess,
  LoginOrchestrationFailure,
  LoginOrchestrationResult,
} from "./types";

export { FORBIDDEN_JIT_ROLE_KEYS, isForbiddenRoleKey, createDefaultIdentityLinkPolicy, createDefaultJitProvisioningPolicy } from "./types";

export {
  AuthIntegrationConfigurationError,
  AuthIntegrationPlanValidationError,
  isKnownAuthIntegrationError,
} from "./errors";
export type { KnownAuthIntegrationError } from "./errors";

export type { ValidationResult } from "./validation";
export {
  validateIdentityLinkPolicy,
  validateJitProvisioningPolicy,
  validateGroupMappingRule,
  validateGroupMappingRules,
  validateLoginIntegrationPlan,
} from "./validation";

export type {
  IdentityLinkRepository,
  UserDirectoryPort,
  RoleAssignmentPort,
  TeamMembershipPort,
  ProviderConfigRepository,
  AuthAuditSink,
  TransactionBoundary,
} from "./ports";

export { decideIdentityLink } from "./identityLinking";
export { decideJitProvisioning } from "./jitProvisioning";
export { evaluateGroupMappings } from "./groupMapping";

export { hashSubjectReference, buildAuditEvent } from "./auditEvents";
export type { BuildAuditEventParams } from "./auditEvents";

export { orchestrateExternalLogin } from "./loginOrchestration";
export type { LoginOrchestrationPorts, OrchestrateExternalLoginParams } from "./loginOrchestration";

export {
  createFakeUser,
  createFakeIdentityLinkRepository,
  createFakeUserDirectory,
  createFakeRoleAssignmentPort,
  createFakeTeamMembershipPort,
  createFakeProviderConfigRepository,
  createFakeTransactionBoundary,
} from "./testing/fakeRepositories";
export type { FakeLinkRecord, FakeIdentityLinkRepositoryOptions, FakeProviderConfigRepositoryOptions } from "./testing/fakeRepositories";

export { createFakeAuditSink } from "./testing/fakeAuditSink";
export type { FakeAuditSink } from "./testing/fakeAuditSink";
