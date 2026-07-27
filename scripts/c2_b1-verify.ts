// C2-B1 驗證腳本：Authentication Integration Services（身分連結／JIT／群組映射／
// 登入協調）。
//
// 與 scripts/c2_a-verify.ts 同樣的性質：本階段完全不整合真實 LDAP／OIDC／SAML、
// 不建立 Migration、不寫入任何 User／UserRole／TeamMembership、不接管 Session，
// 因此本腳本不需要 DATABASE_URL、不 import Prisma、也不需要 next/headers 的
// request context。
//
// 涵蓋兩類檢查：
//   1. 純邏輯測試：Identity Linking／JIT Provisioning／Group Mapping／Audit
//      Event／Validation／Fake Ports／Login Orchestration。
//   2. 原始碼層級的邊界檢查：模組不 import Prisma／UI／next/headers／Workflow，
//      不建立 Session／Cookie，GroupMappingRule 型別不存在 LEAD／主管／代理／
//      核准權欄位，公開 API 只由 index.ts 匯出，以及 M1／M2／C1／C2-A 紅線
//      檔案相對於指定比對基準完全沒有變動。

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { createFakeProvider, createFakeIdentity, redactMessage } from "../src/lib/auth-providers";
import {
  decideIdentityLink,
  decideJitProvisioning,
  evaluateGroupMappings,
  orchestrateExternalLogin,
  validateLoginIntegrationPlan,
  validateIdentityLinkPolicy,
  validateJitProvisioningPolicy,
  validateGroupMappingRule,
  validateGroupMappingRules,
  hashSubjectReference,
  buildAuditEvent,
  createDefaultIdentityLinkPolicy,
  createDefaultJitProvisioningPolicy,
  createFakeUser,
  createFakeIdentityLinkRepository,
  createFakeUserDirectory,
  createFakeRoleAssignmentPort,
  createFakeTeamMembershipPort,
  createFakeProviderConfigRepository,
  createFakeTransactionBoundary,
  createFakeAuditSink,
  type LoginOrchestrationPorts,
  type GroupMappingRule,
  type JitProvisioningPolicy,
  type LoginIntegrationPlan,
} from "../src/lib/auth-integration";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}`);
  }
}

async function checkAsync(name: string, fn: () => Promise<boolean>) {
  try {
    check(name, await fn());
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name}（未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
  }
}

function skip(name: string, reason: string) {
  skipCount++;
  console.log(`  SKIP  ${name}（${reason}）`);
}
void skip;

// ===========================================================================
// 1. Identity Linking
// ===========================================================================
function runIdentityLinkingTests() {
  console.log("\n=== C2-B1 驗證：Identity Linking（純邏輯） ===");

  const identity = createFakeIdentity({ providerKey: "prov-a", subject: "sub-1", loginIdentifier: "alice" });
  const defaultPolicy = createDefaultIdentityLinkPolicy();

  check(
    "[IL1] decideIdentityLink：既有 provider+subject link 存在時 LINK_EXISTING",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: { userId: "u-1", providerKey: "prov-a", status: "ACTIVE" },
        loginIdentifierCandidates: [],
        emailCandidates: [],
        policy: defaultPolicy,
      });
      return d.decision === "LINK_EXISTING" && d.matchedUserId === "u-1" && d.reasonCode === "EXISTING_LINK_FOUND";
    })(),
  );

  check(
    "[IL2] decideIdentityLink：既有 link 已撤銷時 REJECT，不自動重新連結",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: { userId: "u-1", providerKey: "prov-a", status: "REVOKED" },
        loginIdentifierCandidates: [],
        emailCandidates: [],
        policy: defaultPolicy,
      });
      return d.decision === "REJECT" && d.reasonCode === "EXISTING_LINK_REVOKED" && d.matchedUserId === null;
    })(),
  );

  check(
    "[IL3] decideIdentityLink：loginIdentifier 唯一候選（非 Admin）LINK_EXISTING",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: null,
        loginIdentifierCandidates: [createFakeUser({ userId: "u-2", isAdmin: false })],
        emailCandidates: [],
        policy: defaultPolicy,
      });
      return d.decision === "LINK_EXISTING" && d.matchedUserId === "u-2" && d.reasonCode === "UNIQUE_LOGIN_IDENTIFIER_MATCH";
    })(),
  );

  check(
    "[IL4] decideIdentityLink：loginIdentifier 唯一候選但目標為 Admin，REQUIRE_REVIEW（不自動連結到 Admin）",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: null,
        loginIdentifierCandidates: [createFakeUser({ userId: "u-admin", isAdmin: true })],
        emailCandidates: [],
        policy: defaultPolicy,
      });
      return d.decision === "REQUIRE_REVIEW" && d.reasonCode === "MATCH_TARGETS_ADMIN_ACCOUNT" && d.matchedUserId === null && d.candidateUserIds.includes("u-admin");
    })(),
  );

  check(
    "[IL5] decideIdentityLink：loginIdentifier 多重候選時 REQUIRE_REVIEW，拒絕自動連結",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: null,
        loginIdentifierCandidates: [createFakeUser({ userId: "u-a" }), createFakeUser({ userId: "u-b" })],
        emailCandidates: [],
        policy: defaultPolicy,
      });
      return d.decision === "REQUIRE_REVIEW" && d.reasonCode === "MULTIPLE_LOGIN_IDENTIFIER_CANDIDATES" && d.candidateUserIds.length === 2;
    })(),
  );

  check(
    "[IL6] decideIdentityLink：Email 自動連結預設關閉——即使傳入 email 候選仍 CREATE_NEW",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: null,
        loginIdentifierCandidates: [],
        emailCandidates: [createFakeUser({ userId: "u-email" })],
        policy: defaultPolicy,
      });
      return d.decision === "CREATE_NEW" && d.reasonCode === "EMAIL_MATCHING_DISABLED_BY_POLICY";
    })(),
  );

  check(
    "[IL7] decideIdentityLink：政策明確開啟 Email 比對且唯一候選（非 Admin）時 LINK_EXISTING",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: null,
        loginIdentifierCandidates: [],
        emailCandidates: [createFakeUser({ userId: "u-email" })],
        policy: { allowEmailMatching: true },
      });
      return d.decision === "LINK_EXISTING" && d.matchedUserId === "u-email" && d.reasonCode === "EMAIL_MATCH_ALLOWED_BY_POLICY";
    })(),
  );

  check(
    "[IL8] decideIdentityLink：政策開啟 Email 比對但多重候選時 REQUIRE_REVIEW",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: null,
        loginIdentifierCandidates: [],
        emailCandidates: [createFakeUser({ userId: "u-a" }), createFakeUser({ userId: "u-b" })],
        policy: { allowEmailMatching: true },
      });
      return d.decision === "REQUIRE_REVIEW" && d.reasonCode === "MULTIPLE_EMAIL_CANDIDATES";
    })(),
  );

  check(
    "[IL9] decideIdentityLink：Email 比對開啟且唯一候選為 Admin 時 REQUIRE_REVIEW",
    (() => {
      const d = decideIdentityLink({
        identity,
        existingLink: null,
        loginIdentifierCandidates: [],
        emailCandidates: [createFakeUser({ userId: "u-admin", isAdmin: true })],
        policy: { allowEmailMatching: true },
      });
      return d.decision === "REQUIRE_REVIEW" && d.reasonCode === "MATCH_TARGETS_ADMIN_ACCOUNT";
    })(),
  );

  check(
    "[IL10] decideIdentityLink：完全無候選時 CREATE_NEW／NO_CANDIDATE_FOUND",
    (() => {
      const d = decideIdentityLink({ identity, existingLink: null, loginIdentifierCandidates: [], emailCandidates: [], policy: { allowEmailMatching: true } });
      return d.decision === "CREATE_NEW" && d.reasonCode === "NO_CANDIDATE_FOUND";
    })(),
  );

  const identitySrc = fs.readFileSync(path.join(REPO_ROOT, "src/lib/auth-integration/identityLinking.ts"), "utf8");
  check("[IL11] identityLinking.ts 原始碼內完全不比對 displayName（不得因顯示名稱相同而連結）", !/candidate\.displayName/i.test(identitySrc));
}

// ===========================================================================
// 2. JIT Provisioning
// ===========================================================================
function runJitProvisioningTests() {
  console.log("\n=== C2-B1 驗證：JIT Provisioning（純邏輯） ===");

  const validIdentity = createFakeIdentity({ loginIdentifier: "bob", displayName: "Bob", email: "bob@example.invalid" });

  check(
    "[JT1] decideJitProvisioning：缺少必要欄位（email）時明確阻擋",
    (() => {
      // createFakeIdentity 的 overrides 用 `??` 合併，null 會被視為「未提供」而套用預設值；
      // 這裡改用建構後覆寫，確保 email 真的是 null。
      const identity = { ...createFakeIdentity(), email: null };
      const d = decideJitProvisioning({ identity, conflictingActiveUser: null, policy: createDefaultJitProvisioningPolicy() });
      return d.outcome === "BLOCKED" && d.reasonCode === "MISSING_REQUIRED_FIELDS" && d.missingFields.includes("email");
    })(),
  );

  check(
    "[JT2] decideJitProvisioning：JIT 預設關閉（fail closed），一般情況下直接拒絕",
    (() => {
      const d = decideJitProvisioning({ identity: validIdentity, conflictingActiveUser: null, policy: createDefaultJitProvisioningPolicy() });
      return d.outcome === "BLOCKED" && d.reasonCode === "JIT_DISABLED_BY_POLICY" && d.proposedProfile === null;
    })(),
  );

  check(
    "[JT3] decideJitProvisioning：loginIdentifier 與既有未連結帳號衝突時阻擋",
    (() => {
      const policy: JitProvisioningPolicy = { allowJit: true, requireApprovalAlways: true, defaultRoleCommand: null, defaultTeamCommand: null };
      const conflicting = createFakeUser({ userId: "u-conflict", loginIdentifier: validIdentity.loginIdentifier });
      const d = decideJitProvisioning({ identity: validIdentity, conflictingActiveUser: conflicting, policy });
      return d.outcome === "BLOCKED" && d.reasonCode === "CONFLICTING_ACTIVE_ACCOUNT" && d.conflicts.includes("u-conflict");
    })(),
  );

  check(
    "[JT4] decideJitProvisioning：Admin 永遠不能由 JIT 自動指派，即使政策誤設為預設角色",
    (() => {
      const policy: JitProvisioningPolicy = {
        allowJit: true,
        requireApprovalAlways: false,
        defaultRoleCommand: { roleKey: "Admin", requiresApproval: false },
        defaultTeamCommand: null,
      };
      const d = decideJitProvisioning({ identity: validIdentity, conflictingActiveUser: null, policy });
      return d.outcome === "BLOCKED" && d.reasonCode === "DEFAULT_ROLE_FORBIDDEN" && d.proposedCommands.length === 0;
    })(),
  );

  check(
    "[JT5] decideJitProvisioning：允許但需人工核准時，初始狀態為 PENDING_APPROVAL 且建議命令 requiresApproval=true",
    (() => {
      const policy: JitProvisioningPolicy = {
        allowJit: true,
        requireApprovalAlways: true,
        defaultRoleCommand: { roleKey: "PM", requiresApproval: false },
        defaultTeamCommand: null,
      };
      const d = decideJitProvisioning({ identity: validIdentity, conflictingActiveUser: null, policy });
      return (
        d.outcome === "REQUIRES_APPROVAL" &&
        d.proposedProfile?.initialStatus === "PENDING_APPROVAL" &&
        d.proposedCommands.length === 1 &&
        d.proposedCommands[0].requiresApproval === true
      );
    })(),
  );

  check(
    "[JT6] decideJitProvisioning：允許且不需人工核准時，初始狀態為 ACTIVE 且建議命令 requiresApproval=false",
    (() => {
      const policy: JitProvisioningPolicy = {
        allowJit: true,
        requireApprovalAlways: false,
        defaultRoleCommand: { roleKey: "PM", requiresApproval: false },
        defaultTeamCommand: { teamKey: "team-x", requiresApproval: false },
      };
      const d = decideJitProvisioning({ identity: validIdentity, conflictingActiveUser: null, policy });
      return (
        d.outcome === "ALLOWED" &&
        d.proposedProfile?.initialStatus === "ACTIVE" &&
        d.proposedCommands.length === 2 &&
        d.proposedCommands.every((c) => c.requiresApproval === false)
      );
    })(),
  );

  check(
    "[JT7] decideJitProvisioning：initial role 不受 Provider 提供的 groups 影響（未設定 defaultRoleCommand 時不建議任何角色）",
    (() => {
      const identity = createFakeIdentity({ ...validIdentity, groups: ["Admin", "some-external-role-looking-group"] });
      const policy: JitProvisioningPolicy = { allowJit: true, requireApprovalAlways: false, defaultRoleCommand: null, defaultTeamCommand: null };
      const d = decideJitProvisioning({ identity, conflictingActiveUser: null, policy });
      return d.outcome === "ALLOWED" && d.proposedCommands.length === 0;
    })(),
  );

  const jitSrc = fs.readFileSync(path.join(REPO_ROOT, "src/lib/auth-integration/jitProvisioning.ts"), "utf8");
  check("[JT8] jitProvisioning.ts 原始碼內完全不讀取 identity.groups（角色不得由 Provider 任意指定）", !/identity\.groups/.test(jitSrc));
}

// ===========================================================================
// 3. Group Mapping
// ===========================================================================
function rule(overrides: Partial<GroupMappingRule> & Pick<GroupMappingRule, "id" | "externalGroupPattern">): GroupMappingRule {
  return {
    targetRoleKey: null,
    targetTeamKey: null,
    priority: 100,
    enabled: true,
    requiresApproval: false,
    providerScope: [],
    ...overrides,
  };
}

function runGroupMappingTests() {
  console.log("\n=== C2-B1 驗證：Group Mapping Policy（純邏輯） ===");

  const identity = createFakeIdentity({ providerKey: "prov-x", groups: ["eng-team"] });

  check(
    "[GM1] evaluateGroupMappings：無匹配規則時 reasonCode=NO_MATCH",
    (() => {
      const e = evaluateGroupMappings(identity, [rule({ id: "r1", externalGroupPattern: "other-team", targetRoleKey: "RD" })]);
      return e.reasonCode === "NO_MATCH" && e.suggestions.length === 0 && e.matchedRuleIds.length === 0;
    })(),
  );

  check(
    "[GM2] evaluateGroupMappings：單一匹配規則時回傳對應建議",
    (() => {
      const e = evaluateGroupMappings(identity, [rule({ id: "r1", externalGroupPattern: "eng-team", targetRoleKey: "RD", targetTeamKey: "team-rd" })]);
      return (
        e.reasonCode === "SINGLE_MATCH" &&
        e.matchedRuleIds.length === 1 &&
        e.suggestions.some((s) => s.kind === "ROLE" && s.key === "RD") &&
        e.suggestions.some((s) => s.kind === "TEAM" && s.key === "team-rd")
      );
    })(),
  );

  check(
    "[GM3] evaluateGroupMappings：多重匹配但建議相同角色時無衝突",
    (() => {
      const rules = [
        rule({ id: "r1", externalGroupPattern: "eng-team", targetRoleKey: "RD", priority: 1 }),
        rule({ id: "r2", externalGroupPattern: "eng-team", targetRoleKey: "RD", priority: 2 }),
      ];
      const e = evaluateGroupMappings(identity, rules);
      const roleSuggestion = e.suggestions.find((s) => s.kind === "ROLE");
      return e.reasonCode === "MULTIPLE_MATCHES_NO_CONFLICT" && e.conflicts.length === 0 && roleSuggestion?.sourceRuleIds.length === 2;
    })(),
  );

  check(
    "[GM4] evaluateGroupMappings：角色衝突時記錄 conflict，並以優先權（數字較小）決定 winner",
    (() => {
      const rules = [
        rule({ id: "r-low", externalGroupPattern: "eng-team", targetRoleKey: "RD", priority: 5 }),
        rule({ id: "r-high", externalGroupPattern: "eng-team", targetRoleKey: "QA", priority: 1 }),
      ];
      const e = evaluateGroupMappings(identity, rules);
      const roleSuggestion = e.suggestions.find((s) => s.kind === "ROLE");
      const conflict = e.conflicts.find((c) => c.kind === "ROLE_CONFLICT");
      return (
        e.reasonCode === "MULTIPLE_MATCHES_WITH_CONFLICT" &&
        roleSuggestion?.key === "QA" &&
        roleSuggestion?.requiresApproval === true &&
        conflict?.winningKey === "QA" &&
        [...(conflict?.candidateKeys ?? [])].sort().join(",") === "QA,RD"
      );
    })(),
  );

  check(
    "[GM5] evaluateGroupMappings：Team 衝突時同樣記錄 conflict 並以優先權決定 winner",
    (() => {
      const rules = [
        rule({ id: "r-low", externalGroupPattern: "eng-team", targetTeamKey: "team-a", priority: 9 }),
        rule({ id: "r-high", externalGroupPattern: "eng-team", targetTeamKey: "team-b", priority: 1 }),
      ];
      const e = evaluateGroupMappings(identity, rules);
      const teamSuggestion = e.suggestions.find((s) => s.kind === "TEAM");
      const conflict = e.conflicts.find((c) => c.kind === "TEAM_CONFLICT");
      return teamSuggestion?.key === "team-b" && conflict !== undefined && conflict.candidateKeys.includes("team-a") && conflict.candidateKeys.includes("team-b");
    })(),
  );

  check(
    "[GM6] evaluateGroupMappings：disabled 規則即使群組相符也被跳過",
    (() => {
      const e = evaluateGroupMappings(identity, [rule({ id: "r1", externalGroupPattern: "eng-team", targetRoleKey: "RD", enabled: false })]);
      return e.reasonCode === "NO_MATCH" && e.skippedDisabledRuleIds.includes("r1") && e.suggestions.length === 0;
    })(),
  );

  check(
    "[GM7] evaluateGroupMappings：provider scope 不含目前 providerKey 時跳過該規則",
    (() => {
      const e = evaluateGroupMappings(identity, [rule({ id: "r1", externalGroupPattern: "eng-team", targetRoleKey: "RD", providerScope: ["some-other-provider"] })]);
      return e.skippedOutOfScopeRuleIds.includes("r1") && e.suggestions.length === 0;
    })(),
  );

  check(
    "[GM7b] evaluateGroupMappings：provider scope 含目前 providerKey 時正常生效",
    (() => {
      const e = evaluateGroupMappings(identity, [rule({ id: "r1", externalGroupPattern: "eng-team", targetRoleKey: "RD", providerScope: ["prov-x"] })]);
      return e.suggestions.some((s) => s.kind === "ROLE" && s.key === "RD");
    })(),
  );

  check(
    "[GM8] evaluateGroupMappings：requiresApproval 由規則設定傳遞到建議（無衝突時）",
    (() => {
      const e = evaluateGroupMappings(identity, [rule({ id: "r1", externalGroupPattern: "eng-team", targetRoleKey: "RD", requiresApproval: true })]);
      return e.suggestions.find((s) => s.kind === "ROLE")?.requiresApproval === true && e.requiresApproval === true;
    })(),
  );

  check(
    "[GM9] evaluateGroupMappings：外部群組與規則 pattern 比對時忽略大小寫與前後空白",
    (() => {
      const messyIdentity = createFakeIdentity({ providerKey: "prov-x", groups: [" ENG-Team  "] });
      const e = evaluateGroupMappings(messyIdentity, [rule({ id: "r1", externalGroupPattern: "eng-team", targetRoleKey: "RD" })]);
      return e.matchedRuleIds.includes("r1");
    })(),
  );

  check(
    "[GM10] evaluateGroupMappings：規則本身指向 Admin 時整批排除，絕不出現在建議中",
    (() => {
      const e = evaluateGroupMappings(identity, [rule({ id: "r-admin", externalGroupPattern: "eng-team", targetRoleKey: "Admin" })]);
      return e.rejectedForbiddenRuleIds.includes("r-admin") && !e.matchedRuleIds.includes("r-admin") && e.suggestions.every((s) => s.key !== "Admin");
    })(),
  );

  const typesSrc = fs.readFileSync(path.join(REPO_ROOT, "src/lib/auth-integration/types.ts"), "utf8");
  const ruleBlockMatch = typesSrc.match(/interface GroupMappingRule \{[\s\S]*?\n\}/);
  const teamCommandBlockMatch = typesSrc.match(/interface SuggestedTeamCommand \{[\s\S]*?\n\}/);
  check(
    "[GM11] GroupMappingRule／SuggestedTeamCommand 型別內完全沒有 membershipRole／supervisor／delegate／approval 相關欄位（結構上不可能建議 LEAD／主管／代理／核准權）",
    ruleBlockMatch !== null &&
      teamCommandBlockMatch !== null &&
      !/\b(membershipRole|supervisor|delegate|approvalAuthority|proxy)\s*[?:]/i.test(ruleBlockMatch[0]) &&
      !/\b(membershipRole|supervisor|delegate|approvalAuthority|proxy)\s*[?:]/i.test(teamCommandBlockMatch[0]),
  );
}

// ===========================================================================
// 4. Audit Events／Redaction
// ===========================================================================
function runAuditEventTests() {
  console.log("\n=== C2-B1 驗證：Audit Event Descriptor 與 Redaction（純邏輯） ===");

  check(
    "[AE1] hashSubjectReference：相同輸入產生相同雜湊，不同 subject 產生不同雜湊，且不等於原始 subject",
    (() => {
      const h1 = hashSubjectReference("prov", "raw-subject-abc");
      const h2 = hashSubjectReference("prov", "raw-subject-abc");
      const h3 = hashSubjectReference("prov", "raw-subject-xyz");
      return h1 === h2 && h1 !== h3 && h1 !== "raw-subject-abc";
    })(),
  );

  check(
    "[AE2] buildAuditEvent：detail 內的敏感內容經 redactMessage 淨化，不外洩原始密碼片段",
    (() => {
      const event = buildAuditEvent({
        providerKey: "prov",
        subject: "s1",
        decisionType: "PROVIDER_AUTH_FAILURE",
        result: "FAILURE",
        reasonCode: "X",
        correlationId: "c1",
        detail: "bind failed, password=leak-me-123",
      });
      return event.detail === redactMessage("bind failed, password=leak-me-123") && !event.detail.includes("leak-me-123");
    })(),
  );

  check(
    "[AE3] buildAuditEvent：subjectReference 為雜湊值，序列化後的事件內容不含原始 subject 明文",
    (() => {
      const event = buildAuditEvent({
        providerKey: "prov",
        subject: "raw-secret-subject-abc",
        decisionType: "IDENTITY_LINK_DECISION",
        result: "LINK_EXISTING",
        reasonCode: "X",
        correlationId: "c1",
        detail: "ok",
      });
      return !JSON.stringify(event).includes("raw-secret-subject-abc");
    })(),
  );

  check(
    "[AE4] buildAuditEvent：correlationId 原樣保留，供上層串接同一次登入的所有事件",
    buildAuditEvent({ providerKey: "p", subject: "s", decisionType: "LOGIN_ORCHESTRATION_OUTCOME", result: "R", reasonCode: "X", correlationId: "corr-123", detail: "" })
      .correlationId === "corr-123",
  );
}

// ===========================================================================
// 5. Validation
// ===========================================================================
function runValidationTests() {
  console.log("\n=== C2-B1 驗證：Validation（純邏輯） ===");

  check("[VA1] validateIdentityLinkPolicy：合法 policy 通過", validateIdentityLinkPolicy({ allowEmailMatching: false }).valid === true);
  check("[VA1b] validateIdentityLinkPolicy：allowEmailMatching 非布林值時拒絕", validateIdentityLinkPolicy({ allowEmailMatching: "yes" }).valid === false);

  check(
    "[VA2] validateJitProvisioningPolicy：defaultRoleCommand 指向 Admin 時拒絕",
    validateJitProvisioningPolicy({ allowJit: true, requireApprovalAlways: true, defaultRoleCommand: { roleKey: "Admin", requiresApproval: false }, defaultTeamCommand: null })
      .valid === false,
  );
  check(
    "[VA2b] validateJitProvisioningPolicy：合法 policy 通過",
    validateJitProvisioningPolicy({ allowJit: false, requireApprovalAlways: true, defaultRoleCommand: null, defaultTeamCommand: null }).valid === true,
  );

  check(
    "[VA3] validateGroupMappingRule：targetRoleKey 指向 Admin 時拒絕",
    validateGroupMappingRule({
      id: "r1",
      externalGroupPattern: "x",
      targetRoleKey: "Admin",
      targetTeamKey: null,
      priority: 1,
      enabled: true,
      requiresApproval: false,
      providerScope: [],
    }).valid === false,
  );
  check(
    "[VA3b] validateGroupMappingRule：priority 非有限數字時拒絕",
    validateGroupMappingRule({
      id: "r1",
      externalGroupPattern: "x",
      targetRoleKey: null,
      targetTeamKey: null,
      priority: Number.NaN,
      enabled: true,
      requiresApproval: false,
      providerScope: [],
    }).valid === false,
  );

  check(
    "[VA4] validateGroupMappingRules：重複 id 時拒絕",
    validateGroupMappingRules([
      rule({ id: "dup", externalGroupPattern: "a" }),
      rule({ id: "dup", externalGroupPattern: "b" }),
    ]).valid === false,
  );
}

// ===========================================================================
// 6. Fake Ports
// ===========================================================================
async function runFakePortTests() {
  console.log("\n=== C2-B1 驗證：Fake Ports（測試輔助本身也需驗證） ===");

  await checkAsync("[FP1] fakeIdentityLinkRepository：不同 Provider 的相同 subject 不共用連結（跨 Provider 隔離）", async () => {
    const repo = createFakeIdentityLinkRepository({ links: [{ providerKey: "prov-a", subject: "shared-subject", userId: "u-1", status: "ACTIVE" }] });
    const forA = await repo.findLinkByProviderSubject("prov-a", "shared-subject");
    const forB = await repo.findLinkByProviderSubject("prov-b", "shared-subject");
    return forA?.userId === "u-1" && forB === null;
  });

  await checkAsync("[FP2] fakeAuditSink：依序收集所有 record 呼叫", async () => {
    const sink = createFakeAuditSink();
    await sink.record(buildAuditEvent({ providerKey: "p", subject: "s", decisionType: "IDENTITY_LINK_DECISION", result: "R1", reasonCode: "X", correlationId: "c", detail: "" }));
    await sink.record(buildAuditEvent({ providerKey: "p", subject: "s", decisionType: "LOGIN_ORCHESTRATION_OUTCOME", result: "R2", reasonCode: "X", correlationId: "c", detail: "" }));
    return sink.events.length === 2 && sink.events[0].result === "R1" && sink.events[1].result === "R2";
  });

  await checkAsync("[FP3] fakeProviderConfigRepository：回傳呼叫端設定的 policy／rules", async () => {
    const groupRules = [rule({ id: "r1", externalGroupPattern: "x" })];
    const repo = createFakeProviderConfigRepository({ identityLinkPolicy: { allowEmailMatching: true }, groupRules });
    const policy = await repo.getIdentityLinkPolicy("any");
    const rules = await repo.getGroupMappingRules("any");
    return policy.allowEmailMatching === true && rules.length === 1 && rules[0].id === "r1";
  });

  await checkAsync("[FP4] fakeTransactionBoundary：直接執行並回傳 fn 的結果", async () => {
    const tx = createFakeTransactionBoundary();
    const result = await tx.runInTransaction(async () => 42);
    return result === 42;
  });

  await checkAsync("[FP5] createFakeUserDirectory／createFakeRoleAssignmentPort／createFakeTeamMembershipPort：基本行為正確", async () => {
    const directory = createFakeUserDirectory({ users: [createFakeUser({ userId: "u-1", loginIdentifier: "carol", active: true })] });
    const roles = createFakeRoleAssignmentPort({ rolesByUserId: { "u-1": ["PM"] } });
    const teams = createFakeTeamMembershipPort({ teamsByUserId: { "u-1": ["team-x"] } });
    const found = await directory.findActiveUserByLoginIdentifier("carol");
    const roleKeys = await roles.listCurrentRoleKeys("u-1");
    const teamKeys = await teams.listCurrentTeamKeys("u-1");
    return found?.userId === "u-1" && roleKeys.includes("PM") && teamKeys.includes("team-x");
  });
}

// ===========================================================================
// 7. Login Orchestration
// ===========================================================================
function buildPorts(overrides: Partial<LoginOrchestrationPorts> = {}): LoginOrchestrationPorts {
  return {
    identityLinkRepository: overrides.identityLinkRepository ?? createFakeIdentityLinkRepository(),
    userDirectory: overrides.userDirectory ?? createFakeUserDirectory(),
    roleAssignment: overrides.roleAssignment ?? createFakeRoleAssignmentPort(),
    teamMembership: overrides.teamMembership ?? createFakeTeamMembershipPort(),
    providerConfig: overrides.providerConfig ?? createFakeProviderConfigRepository(),
    auditSink: overrides.auditSink ?? createFakeAuditSink(),
    transaction: overrides.transaction ?? createFakeTransactionBoundary(),
  };
}

async function runLoginOrchestrationTests() {
  console.log("\n=== C2-B1 驗證：Login Orchestration（協調流程，不接管 Session） ===");

  await checkAsync("[LO1] orchestrateExternalLogin：既有連結時成功並輸出 PROCEED_LINK_EXISTING", async () => {
    const identity = createFakeIdentity({ providerKey: "prov-o", subject: "sub-existing" });
    const provider = createFakeProvider({ key: "prov-o", behavior: "success", identity });
    const ports = buildPorts({
      identityLinkRepository: createFakeIdentityLinkRepository({ links: [{ providerKey: "prov-o", subject: "sub-existing", userId: "u-1", status: "ACTIVE" }] }),
    });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports, correlationId: "corr-lo1" });
    return (
      result.ok === true &&
      result.plan.outcome === "PROCEED_LINK_EXISTING" &&
      result.plan.jitDecision === null &&
      result.plan.correlationId === "corr-lo1" &&
      result.plan.auditEvents.every((e) => e.correlationId === "corr-lo1")
    );
  });

  await checkAsync("[LO2] orchestrateExternalLogin：無連結且 JIT 允許（不需核准）時 PROCEED_CREATE_NEW", async () => {
    const identity = createFakeIdentity({ providerKey: "prov-o2", subject: "sub-new", loginIdentifier: "newuser", email: "newuser@example.invalid" });
    const provider = createFakeProvider({ key: "prov-o2", behavior: "success", identity });
    const ports = buildPorts({
      providerConfig: createFakeProviderConfigRepository({
        jitPolicy: { allowJit: true, requireApprovalAlways: false, defaultRoleCommand: { roleKey: "PM", requiresApproval: false }, defaultTeamCommand: null },
      }),
    });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports });
    return result.ok === true && result.plan.outcome === "PROCEED_CREATE_NEW" && result.plan.jitDecision?.outcome === "ALLOWED" && result.plan.suggestedCommands.length === 1;
  });

  await checkAsync("[LO3] orchestrateExternalLogin：Provider 驗證失敗時回傳 ok=false，並記錄一筆 redacted audit event", async () => {
    const provider = createFakeProvider({ key: "prov-fail", behavior: "failure", failureReason: "invalid credentials, password=leak-abc" });
    const sink = createFakeAuditSink();
    const ports = buildPorts({ auditSink: sink });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports });
    return (
      result.ok === false &&
      result.reasonCode === "PROVIDER_AUTHENTICATION_FAILED" &&
      sink.events.length === 1 &&
      sink.events[0].decisionType === "PROVIDER_AUTH_FAILURE" &&
      !sink.events[0].detail.includes("leak-abc")
    );
  });

  await checkAsync("[LO4] orchestrateExternalLogin：身分驗證失敗（email 格式不正確）時回傳 ok=false", async () => {
    const identity = createFakeIdentity({ email: "not-an-email" });
    const provider = createFakeProvider({ key: "prov-invalid", behavior: "success", identity });
    const sink = createFakeAuditSink();
    const ports = buildPorts({ auditSink: sink });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports });
    return result.ok === false && result.reasonCode === "IDENTITY_VALIDATION_FAILED" && sink.events.length === 1 && sink.events[0].decisionType === "IDENTITY_VALIDATION_FAILURE";
  });

  await checkAsync("[LO5] orchestrateExternalLogin：省略 correlationId 時自動產生，且兩次呼叫不相同", async () => {
    const identity = createFakeIdentity({ providerKey: "prov-corr", subject: "sub-corr" });
    const provider = createFakeProvider({ key: "prov-corr", behavior: "success", identity });
    const result1 = await orchestrateExternalLogin({ provider, request: {}, ports: buildPorts() });
    const result2 = await orchestrateExternalLogin({ provider, request: {}, ports: buildPorts() });
    return result1.ok === true && result2.ok === true && result1.plan.correlationId.length > 0 && result1.plan.correlationId !== result2.plan.correlationId;
  });

  await checkAsync("[LO6] orchestrateExternalLogin：REQUIRE_REVIEW 時 outcome=PENDING_REVIEW，且不評估 JIT／群組映射", async () => {
    const identity = createFakeIdentity({ providerKey: "prov-review", subject: "sub-review", loginIdentifier: "ambiguous" });
    const provider = createFakeProvider({ key: "prov-review", behavior: "success", identity });
    const ports = buildPorts({
      identityLinkRepository: createFakeIdentityLinkRepository({ users: [createFakeUser({ userId: "u-a", loginIdentifier: "ambiguous" }), createFakeUser({ userId: "u-b", loginIdentifier: "ambiguous" })] }),
    });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports });
    return result.ok === true && result.plan.outcome === "PENDING_REVIEW" && result.plan.jitDecision === null && result.plan.groupMappingEvaluation === null;
  });

  await checkAsync("[LO7] orchestrateExternalLogin：既有連結已撤銷時 outcome=REJECTED", async () => {
    const identity = createFakeIdentity({ providerKey: "prov-revoked", subject: "sub-revoked" });
    const provider = createFakeProvider({ key: "prov-revoked", behavior: "success", identity });
    const ports = buildPorts({
      identityLinkRepository: createFakeIdentityLinkRepository({ links: [{ providerKey: "prov-revoked", subject: "sub-revoked", userId: "u-1", status: "REVOKED" }] }),
    });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports });
    return result.ok === true && result.plan.outcome === "REJECTED" && result.plan.identityLinkDecision.decision === "REJECT";
  });

  await checkAsync("[LO8] orchestrateExternalLogin：CREATE_NEW 但 JIT 依預設關閉阻擋時 outcome=REJECTED", async () => {
    const identity = createFakeIdentity({ providerKey: "prov-jitblock", subject: "sub-jitblock", loginIdentifier: "jitblocked", email: "jitblocked@example.invalid" });
    const provider = createFakeProvider({ key: "prov-jitblock", behavior: "success", identity });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports: buildPorts() });
    return result.ok === true && result.plan.outcome === "REJECTED" && result.plan.jitDecision?.outcome === "BLOCKED";
  });

  await checkAsync("[LO9] validateLoginIntegrationPlan：成功案例的 plan 通過驗證", async () => {
    const identity = createFakeIdentity({ providerKey: "prov-valid", subject: "sub-valid" });
    const provider = createFakeProvider({ key: "prov-valid", behavior: "success", identity });
    const ports = buildPorts({
      identityLinkRepository: createFakeIdentityLinkRepository({ links: [{ providerKey: "prov-valid", subject: "sub-valid", userId: "u-1", status: "ACTIVE" }] }),
    });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports });
    if (!result.ok) return false;
    return validateLoginIntegrationPlan(result.plan).valid === true;
  });

  await checkAsync("[LO10] validateLoginIntegrationPlan：人為構造出違規 plan（suggestedCommands 內含 Admin）時偵測為 invalid", async () => {
    const identity = createFakeIdentity({ providerKey: "prov-valid2", subject: "sub-valid2" });
    const provider = createFakeProvider({ key: "prov-valid2", behavior: "success", identity });
    const ports = buildPorts({
      identityLinkRepository: createFakeIdentityLinkRepository({ links: [{ providerKey: "prov-valid2", subject: "sub-valid2", userId: "u-1", status: "ACTIVE" }] }),
    });
    const result = await orchestrateExternalLogin({ provider, request: {}, ports });
    if (!result.ok) return false;
    const tampered: LoginIntegrationPlan = {
      ...result.plan,
      suggestedCommands: [...result.plan.suggestedCommands, { kind: "ASSIGN_ROLE", roleKey: "Admin", requiresApproval: false, origin: "GROUP_MAPPING", reasonCode: "X" }],
    };
    return validateLoginIntegrationPlan(tampered).valid === false;
  });
}

// ===========================================================================
// 8. 原始碼層級邊界檢查
// ===========================================================================
const REPO_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(REPO_ROOT, "src/lib/auth-integration");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function listModuleFiles(): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".ts")) results.push(full);
    }
  };
  walk(MODULE_DIR);
  return results;
}

// scopeHeadRef 預設 "HEAD"，與修改前的既有語意完全相同（獨立 C2-B1 branch 不受影響）。
// 治理儀表板封板批次自治新增：可用 C2_B1_SCOPE_HEAD_REF 明確指定「C2-B1 實際整合完成
// 的最後一筆 commit」，讓 B9 系列只檢查 BASE_REF..SCOPE_HEAD_REF 這個封閉區間，不看
// SCOPE_HEAD_REF 之後、同一個 branch 上繼續發生的其他已授權階段（例如 M2-B、治理
// 儀表板）——比照 scripts/c2_a-verify.ts 的 C2_A_SCOPE_HEAD_REF 既有慣例。
function gitDiffEmpty(baseRef: string, scopeHeadRef: string, relPath: string): boolean {
  try {
    const out = execFileSync("git", ["diff", baseRef, scopeHeadRef, "--", relPath], { cwd: REPO_ROOT, encoding: "utf8" });
    return out.trim().length === 0;
  } catch (err) {
    throw new Error(`git diff 檢查失敗（${relPath}）：${err instanceof Error ? err.message : String(err)}`);
  }
}

function pathExists(relPath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

// 預設比對基準為本輪起始 tag；可用 C2_B1_BASE_REF 覆寫（例如未來整合腳本）。
function resolveBaseRef(): string {
  const envRef = process.env.C2_B1_BASE_REF;
  const requestedRef = envRef && envRef.trim() ? envRef.trim() : "m2-a-c2-a-integrated";

  let resolvedCommit: string;
  try {
    resolvedCommit = execFileSync("git", ["rev-parse", "--verify", `${requestedRef}^{commit}`], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    console.error(`拒絕執行：C2_B1_BASE_REF="${requestedRef}" 無法解析為有效 commit。`);
    process.exit(1);
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", resolvedCommit, "HEAD"], { cwd: REPO_ROOT });
  } catch {
    console.error(`拒絕執行：C2_B1_BASE_REF="${requestedRef}"（解析為 ${resolvedCommit}）不是目前 HEAD 的祖先，無法作為比對基準。`);
    process.exit(1);
  }

  return resolvedCommit;
}

function resolveScopeHeadRef(baseRefCommit: string): string {
  const envRef = process.env.C2_B1_SCOPE_HEAD_REF;
  const requestedRef = envRef && envRef.trim() ? envRef.trim() : "HEAD";

  let resolvedCommit: string;
  try {
    resolvedCommit = execFileSync("git", ["rev-parse", "--verify", `${requestedRef}^{commit}`], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    console.error(`拒絕執行：C2_B1_SCOPE_HEAD_REF="${requestedRef}" 無法解析為有效 commit。`);
    process.exit(1);
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseRefCommit, resolvedCommit], { cwd: REPO_ROOT });
  } catch {
    console.error(`拒絕執行：BASE_REF（${baseRefCommit}）不是 C2_B1_SCOPE_HEAD_REF="${requestedRef}"（解析為 ${resolvedCommit}）的祖先，無法構成合法區間。`);
    process.exit(1);
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", resolvedCommit, "HEAD"], { cwd: REPO_ROOT });
  } catch {
    console.error(`拒絕執行：C2_B1_SCOPE_HEAD_REF="${requestedRef}"（解析為 ${resolvedCommit}）不是目前 HEAD 的祖先。`);
    process.exit(1);
  }

  return resolvedCommit;
}

function runBoundaryChecks() {
  console.log("\n=== C2-B1 驗證：模組邊界與紅線檔案未變動（原始碼層級靜態檢查） ===");

  const moduleFiles = listModuleFiles();
  check("[B0] auth-integration 模組確實存在檔案（非空殼）", moduleFiles.length >= 10);

  let prismaImportViolation: string | null = null;
  let nextHeadersViolation: string | null = null;
  let uiImportViolation: string | null = null;
  let cookieRedirectViolation: string | null = null;
  let workflowImportViolation: string | null = null;

  for (const file of moduleFiles) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(REPO_ROOT, file);
    if (/@prisma\/client/.test(src) || /@\/lib\/prisma["']/.test(src) || /from\s*["']\.\.\/prisma["']/.test(src)) prismaImportViolation = rel;
    if (/from\s*["']next\/headers["']/.test(src)) nextHeadersViolation = rel;
    if (/@\/components\//.test(src) || /@\/app\//.test(src)) uiImportViolation = rel;
    if (/\bcookies\s*\(/.test(src) || /\bredirect\s*\(/.test(src) || /from\s*["']next\/navigation["']/.test(src)) cookieRedirectViolation = rel;
    if (/lib\/workflow\//.test(src) || /workflowService/.test(src) || /workflowExecutionService/.test(src)) workflowImportViolation = rel;
  }

  check("[B1] auth-integration 模組內沒有任何檔案 import Prisma", prismaImportViolation === null);
  check("[B2] auth-integration 模組內沒有任何檔案 import next/headers（不接管 Session／Cookie）", nextHeadersViolation === null);
  check("[B3] auth-integration 模組內沒有任何檔案 import UI 層（src/components、src/app）", uiImportViolation === null);
  check("[B4] auth-integration 模組內沒有呼叫 cookies()／redirect()，也沒有 import next/navigation", cookieRedirectViolation === null);
  check("[B5] auth-integration 模組完全不依賴 Workflow 模組（src/lib/workflow、workflowService、workflowExecutionService）", workflowImportViolation === null);

  let userWriteViolation: string | null = null;
  for (const file of moduleFiles) {
    const src = fs.readFileSync(file, "utf8");
    if (/prisma\.(user|userRole|teamMembership)\./i.test(src)) userWriteViolation = path.relative(REPO_ROOT, file);
  }
  check("[B6] auth-integration 模組內沒有任何 User／UserRole／TeamMembership 寫入呼叫", userWriteViolation === null);

  const indexSrc = readSource("src/lib/auth-integration/index.ts");
  check(
    "[B7] index.ts 沒有建立全域可變 singleton（不得有 `export const ... = create...()` 之類的模組層級實例）",
    !/export\s+const\s+\w+\s*=\s*create\w*\(/.test(indexSrc),
  );

  // 公開 API 只由 index.ts 匯出：repo 內其他檔案（auth-integration 自身以外）不得直接
  // import `@/lib/auth-integration/<子路徑>`。git grep 找不到任何符合的行時會以非 0
  // 結束，這正是我們期望的「通過」情況，因此用 try/catch 分辨兩種結果。
  let deepImportViolation: string | null = null;
  try {
    const out = execFileSync("git", ["grep", "-n", "-E", "from ['\"]@/lib/auth-integration/[^'\"]"], { cwd: REPO_ROOT, encoding: "utf8" });
    const lines = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith("src/lib/auth-integration/"));
    if (lines.length > 0) deepImportViolation = lines.join(" | ");
  } catch {
    // 無匹配，通過。
  }
  check("[B8] 公開 API 只由 index.ts 匯出：repo 內沒有任何檔案（auth-integration 自身以外）直接 import 內部子路徑", deepImportViolation === null);

  const BASE_REF = resolveBaseRef();
  const SCOPE_HEAD_REF = resolveScopeHeadRef(BASE_REF);
  const scopeLabel = `${BASE_REF}..${SCOPE_HEAD_REF}`;
  const protectedFiles = [
    "prisma/schema.prisma",
    "prisma/seed.ts",
    "src/lib/auth.ts",
    "src/lib/permissions.ts",
    "src/components/Nav.tsx",
    "package.json",
    "package-lock.json",
    "src/lib/workflowService.ts",
    "src/lib/workflowExecutionService.ts",
  ];
  for (const relPath of protectedFiles) {
    if (!pathExists(relPath)) {
      check(`[B9] ${relPath} 相對於 C2-B1 整合區間（${scopeLabel}）完全未變動`, true);
      continue;
    }
    check(`[B9] ${relPath} 相對於 C2-B1 整合區間（${scopeLabel}）完全未變動`, gitDiffEmpty(BASE_REF, SCOPE_HEAD_REF, relPath));
  }
  check("[B9b] prisma/migrations 目錄相對於 C2-B1 整合區間完全未變動（C2-B1 沒有新增 Migration）", gitDiffEmpty(BASE_REF, SCOPE_HEAD_REF, "prisma/migrations"));
  check("[B9c] src/lib/workflow 目錄相對於 C2-B1 整合區間完全未變動", !pathExists("src/lib/workflow") || gitDiffEmpty(BASE_REF, SCOPE_HEAD_REF, "src/lib/workflow"));
  check("[B9d] src/lib/workflow-execution 目錄相對於 C2-B1 整合區間完全未變動", !pathExists("src/lib/workflow-execution") || gitDiffEmpty(BASE_REF, SCOPE_HEAD_REF, "src/lib/workflow-execution"));
  check("[B9e] package.json 未新增任何套件（與 C2-B1 整合區間起點逐字相同）", gitDiffEmpty(BASE_REF, SCOPE_HEAD_REF, "package.json"));
}

// ===========================================================================
// main
// ===========================================================================
async function main() {
  console.log("=== M1.5-C2-B1 驗證：Authentication Integration Services ===");

  runIdentityLinkingTests();
  runJitProvisioningTests();
  runGroupMappingTests();
  runAuditEventTests();
  runValidationTests();
  await runFakePortTests();
  await runLoginOrchestrationTests();
  runBoundaryChecks();

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("c2_b1-verify 執行時發生未預期錯誤：", err);
  process.exit(1);
});
