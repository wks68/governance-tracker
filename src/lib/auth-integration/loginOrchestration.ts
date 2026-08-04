// C2-B1 Login Orchestration — 協調流程，不接管 Session。
//
// 安全邊界：本檔案不 import next/headers、不設 Cookie、不建立 Session、不呼叫
// redirect、不直接寫入任何資料表、不建立 User、不儲存 Token／Password／
// Assertion。輸出永遠是 LoginOrchestrationResult（一個描述性的計畫或失敗原因），
// 交由未來 C2-B2 adapter 決定如何實際執行。
//
// 流程：
//   1. 驗證由呼叫端傳入的 Provider（其 descriptor／config 由 C2-A 負責）。
//   2. 呼叫 provider.authenticate()。
//   3. 對成功回傳的身分再跑一次 validateNormalizedIdentity（沿用 C2-A）。
//   4. decideIdentityLink。
//   5. 僅 CREATE_NEW 時才跑 decideJitProvisioning。
//   6. LINK_EXISTING／CREATE_NEW 時才跑 evaluateGroupMappings。
//   7. 彙整為 LoginIntegrationPlan。
//   8. 每個關鍵步驟都透過 ports.auditSink 記錄一筆 redacted audit event。
//   9. 回傳計畫，不做任何後續執行。

import { randomUUID } from "node:crypto";
import { validateNormalizedIdentity, type AuthenticateRequest, type AuthProvider } from "../auth-providers";
import { buildAuditEvent } from "./auditEvents";
import { decideIdentityLink } from "./identityLinking";
import { decideJitProvisioning } from "./jitProvisioning";
import { evaluateGroupMappings } from "./groupMapping";
import type {
  AuthAuditEvent,
  GroupMappingEvaluation,
  IdentityLinkDecision,
  JitProvisioningDecision,
  LoginIntegrationPlan,
  LoginOrchestrationOutcomeType,
  LoginOrchestrationResult,
  SuggestedCommand,
} from "./types";
import type { AuthAuditSink, IdentityLinkRepository, ProviderConfigRepository, RoleAssignmentPort, TeamMembershipPort, TransactionBoundary, UserDirectoryPort } from "./ports";

export interface LoginOrchestrationPorts {
  readonly identityLinkRepository: IdentityLinkRepository;
  readonly userDirectory: UserDirectoryPort;
  readonly roleAssignment: RoleAssignmentPort;
  readonly teamMembership: TeamMembershipPort;
  readonly providerConfig: ProviderConfigRepository;
  readonly auditSink: AuthAuditSink;
  /** 本階段不呼叫；僅為 C2-B2 adapter 預留的形狀契約。 */
  readonly transaction: TransactionBoundary;
}

export interface OrchestrateExternalLoginParams {
  readonly provider: AuthProvider;
  readonly request: AuthenticateRequest;
  readonly ports: LoginOrchestrationPorts;
  /** 省略時自動產生 UUID；測試可傳入固定值以便斷言 audit event 一致性。 */
  readonly correlationId?: string;
}

function computeOutcome(
  linkDecision: IdentityLinkDecision,
  jitDecision: JitProvisioningDecision | null,
  requiresManualReview: boolean,
): LoginOrchestrationOutcomeType {
  if (linkDecision.decision === "REJECT") return "REJECTED";
  if (linkDecision.decision === "REQUIRE_REVIEW") return "PENDING_REVIEW";
  if (linkDecision.decision === "CREATE_NEW") {
    if (jitDecision !== null && jitDecision.outcome === "BLOCKED") return "REJECTED";
    return requiresManualReview ? "PENDING_REVIEW" : "PROCEED_CREATE_NEW";
  }
  return requiresManualReview ? "PENDING_REVIEW" : "PROCEED_LINK_EXISTING";
}

export async function orchestrateExternalLogin(params: OrchestrateExternalLoginParams): Promise<LoginOrchestrationResult> {
  const correlationId = params.correlationId ?? randomUUID();
  const providerKey = params.provider.descriptor.key;
  const auditEvents: AuthAuditEvent[] = [];

  const recordEvent = async (event: AuthAuditEvent) => {
    auditEvents.push(event);
    await params.ports.auditSink.record(event);
  };

  const authResult = await params.provider.authenticate(params.request);
  if (!authResult.ok) {
    await recordEvent(
      buildAuditEvent({
        providerKey,
        subject: "unresolved",
        decisionType: "PROVIDER_AUTH_FAILURE",
        result: "FAILURE",
        reasonCode: "PROVIDER_AUTHENTICATION_FAILED",
        correlationId,
        detail: authResult.reason,
      }),
    );
    return {
      ok: false,
      reasonCode: "PROVIDER_AUTHENTICATION_FAILED",
      explanation: "Provider 驗證失敗，拒絕登入",
      correlationId,
      auditEvents,
    };
  }

  const identity = authResult.identity;
  const identityValidation = validateNormalizedIdentity(identity);
  if (!identityValidation.valid) {
    await recordEvent(
      buildAuditEvent({
        providerKey,
        subject: identity.subject,
        decisionType: "IDENTITY_VALIDATION_FAILURE",
        result: "FAILURE",
        reasonCode: "IDENTITY_VALIDATION_FAILED",
        correlationId,
        detail: identityValidation.errors.join("; "),
      }),
    );
    return {
      ok: false,
      reasonCode: "IDENTITY_VALIDATION_FAILED",
      explanation: "外部身分資料未通過驗證，拒絕登入",
      correlationId,
      auditEvents,
    };
  }

  const [identityLinkPolicy, jitPolicy, groupRules] = await Promise.all([
    params.ports.providerConfig.getIdentityLinkPolicy(providerKey),
    params.ports.providerConfig.getJitProvisioningPolicy(providerKey),
    params.ports.providerConfig.getGroupMappingRules(providerKey),
  ]);

  const existingLink = await params.ports.identityLinkRepository.findLinkByProviderSubject(providerKey, identity.subject);
  const loginIdentifierCandidates = existingLink === null ? await params.ports.identityLinkRepository.findCandidatesByLoginIdentifier(identity.loginIdentifier) : [];
  const emailCandidates = existingLink === null && identity.email ? await params.ports.identityLinkRepository.findCandidatesByEmail(identity.email) : [];

  const identityLinkDecision = decideIdentityLink({
    identity,
    existingLink,
    loginIdentifierCandidates,
    emailCandidates,
    policy: identityLinkPolicy,
  });

  await recordEvent(
    buildAuditEvent({
      providerKey,
      subject: identity.subject,
      decisionType: "IDENTITY_LINK_DECISION",
      result: identityLinkDecision.decision,
      reasonCode: identityLinkDecision.reasonCode,
      correlationId,
      detail: identityLinkDecision.explanation,
    }),
  );

  let jitDecision: JitProvisioningDecision | null = null;
  let groupMappingEvaluation: GroupMappingEvaluation | null = null;

  if (identityLinkDecision.decision === "CREATE_NEW") {
    const conflictingActiveUser = await params.ports.userDirectory.findActiveUserByLoginIdentifier(identity.loginIdentifier);
    jitDecision = decideJitProvisioning({ identity, conflictingActiveUser, policy: jitPolicy });
    await recordEvent(
      buildAuditEvent({
        providerKey,
        subject: identity.subject,
        decisionType: "JIT_PROVISIONING_DECISION",
        result: jitDecision.outcome,
        reasonCode: jitDecision.reasonCode,
        correlationId,
        detail: jitDecision.explanation,
      }),
    );
  }

  if (identityLinkDecision.decision === "LINK_EXISTING" || identityLinkDecision.decision === "CREATE_NEW") {
    groupMappingEvaluation = evaluateGroupMappings(identity, groupRules);
    await recordEvent(
      buildAuditEvent({
        providerKey,
        subject: identity.subject,
        decisionType: "GROUP_MAPPING_EVALUATION",
        result: groupMappingEvaluation.reasonCode,
        reasonCode: groupMappingEvaluation.reasonCode,
        correlationId,
        detail: `matchedRules=${groupMappingEvaluation.matchedRuleIds.length} conflicts=${groupMappingEvaluation.conflicts.length}`,
      }),
    );
  }

  const suggestedCommands: SuggestedCommand[] = [];
  if (jitDecision) suggestedCommands.push(...jitDecision.proposedCommands);
  if (groupMappingEvaluation) {
    for (const suggestion of groupMappingEvaluation.suggestions) {
      suggestedCommands.push(
        suggestion.kind === "ROLE"
          ? { kind: "ASSIGN_ROLE", roleKey: suggestion.key, requiresApproval: suggestion.requiresApproval, origin: "GROUP_MAPPING", reasonCode: groupMappingEvaluation.reasonCode }
          : { kind: "ASSIGN_TEAM_MEMBERSHIP", teamKey: suggestion.key, requiresApproval: suggestion.requiresApproval, origin: "GROUP_MAPPING", reasonCode: groupMappingEvaluation.reasonCode },
      );
    }
  }

  const requiresManualReview =
    identityLinkDecision.decision === "REQUIRE_REVIEW" ||
    (jitDecision !== null && jitDecision.outcome === "REQUIRES_APPROVAL") ||
    suggestedCommands.some((command) => command.requiresApproval) ||
    (groupMappingEvaluation !== null && groupMappingEvaluation.conflicts.length > 0);

  const outcome = computeOutcome(identityLinkDecision, jitDecision, requiresManualReview);
  const reasonCode = jitDecision !== null && jitDecision.outcome === "BLOCKED" ? jitDecision.reasonCode : identityLinkDecision.reasonCode;

  await recordEvent(
    buildAuditEvent({
      providerKey,
      subject: identity.subject,
      decisionType: "LOGIN_ORCHESTRATION_OUTCOME",
      result: outcome,
      reasonCode,
      correlationId,
      detail: `requiresManualReview=${requiresManualReview}`,
    }),
  );

  const plan: LoginIntegrationPlan = {
    correlationId,
    providerKey,
    identity,
    identityLinkDecision,
    jitDecision,
    groupMappingEvaluation,
    suggestedCommands,
    requiresManualReview,
    outcome,
    reasonCode,
    auditEvents,
  };

  return { ok: true, plan };
}
