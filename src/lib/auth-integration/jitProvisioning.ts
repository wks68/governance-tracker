// C2-B1 JIT Provisioning — 純決策函式。
//
// 安全邊界：不呼叫 peopleService、不寫入任何資料。只回傳「是否允許 JIT／初始
// profile／初始狀態／是否需要人工核准／缺少哪些必要欄位／是否衝突／建議命令」。
//
// 規則摘要：
//   1. allowJit 預設 false（fail closed）——policy 必須明確開啟。
//   2. initial role 完全來自 policy.defaultRoleCommand（系統端設定），本函式
//      不讀取外部身分的群組欄位或任何 Provider 提供的角色提示。
//   3. Admin 永遠不能由 JIT 自動指派——即使 policy 設定錯誤，仍在此處二次擋下
//      （BLOCKED／DEFAULT_ROLE_FORBIDDEN），不假設上游驗證一定先跑過。
//   4. 外部群組只在 groupMapping.ts 形成「建議映射」，本函式完全不處理群組。
//   5. 缺少 email／loginIdentifier／displayName 等必要欄位時明確阻擋。

import { isForbiddenRoleKey } from "./types";
import type { JitProvisioningDecision, JitProvisioningInput, ProposedUserProfile, SuggestedCommand } from "./types";

function blocked(reasonCode: JitProvisioningDecision["reasonCode"], explanation: string, missingFields: readonly string[] = [], conflicts: readonly string[] = []): JitProvisioningDecision {
  return { outcome: "BLOCKED", reasonCode, explanation, missingFields, conflicts, proposedProfile: null, proposedCommands: [] };
}

function requiredFieldsMissing(input: JitProvisioningInput): string[] {
  const missing: string[] = [];
  const { identity } = input;
  if (!identity.loginIdentifier || identity.loginIdentifier.trim().length === 0) missing.push("loginIdentifier");
  if (!identity.displayName || identity.displayName.trim().length === 0) missing.push("displayName");
  if (!identity.email || identity.email.trim().length === 0) missing.push("email");
  return missing;
}

export function decideJitProvisioning(input: JitProvisioningInput): JitProvisioningDecision {
  const { identity, conflictingActiveUser, policy } = input;

  const missingFields = requiredFieldsMissing(input);
  if (missingFields.length > 0) {
    return blocked("MISSING_REQUIRED_FIELDS", `外部身分缺少必要欄位：${missingFields.join("、")}，拒絕 JIT`, missingFields);
  }

  if (!policy.allowJit) {
    return blocked("JIT_DISABLED_BY_POLICY", "JIT 依政策預設關閉（fail closed），此 Provider 未明確開啟自動建立帳號");
  }

  if (conflictingActiveUser !== null) {
    return blocked(
      "CONFLICTING_ACTIVE_ACCOUNT",
      `loginIdentifier「${identity.loginIdentifier}」已被既有帳號（${conflictingActiveUser.userId}）使用但未建立連結，拒絕自動建立以避免衝突`,
      [],
      [conflictingActiveUser.userId],
    );
  }

  if (policy.defaultRoleCommand !== null && isForbiddenRoleKey(policy.defaultRoleCommand.roleKey)) {
    return blocked("DEFAULT_ROLE_FORBIDDEN", `政策設定的預設角色（${policy.defaultRoleCommand.roleKey}）為禁止由 JIT 自動指派的角色，阻擋整個 JIT 流程`);
  }

  const requiresApproval = policy.requireApprovalAlways;
  const proposedProfile: ProposedUserProfile = {
    loginIdentifier: identity.loginIdentifier,
    displayName: identity.displayName,
    email: identity.email,
    department: identity.department,
    initialStatus: requiresApproval ? "PENDING_APPROVAL" : "ACTIVE",
  };

  const proposedCommands: SuggestedCommand[] = [];
  if (policy.defaultRoleCommand) {
    proposedCommands.push({
      kind: "ASSIGN_ROLE",
      roleKey: policy.defaultRoleCommand.roleKey,
      requiresApproval: requiresApproval || policy.defaultRoleCommand.requiresApproval,
      origin: "JIT_DEFAULT",
      reasonCode: "JIT_DEFAULT_ROLE",
    });
  }
  if (policy.defaultTeamCommand) {
    proposedCommands.push({
      kind: "ASSIGN_TEAM_MEMBERSHIP",
      teamKey: policy.defaultTeamCommand.teamKey,
      requiresApproval: requiresApproval || policy.defaultTeamCommand.requiresApproval,
      origin: "JIT_DEFAULT",
      reasonCode: "JIT_DEFAULT_TEAM",
    });
  }

  return {
    outcome: requiresApproval ? "REQUIRES_APPROVAL" : "ALLOWED",
    reasonCode: requiresApproval ? "ALLOWED_REQUIRES_APPROVAL_BY_POLICY" : "ALLOWED_NO_APPROVAL_REQUIRED",
    explanation: requiresApproval ? "JIT 允許建立新帳號，但依政策需人工核准後才生效" : "JIT 允許建立新帳號，且依政策不需額外人工核准",
    missingFields: [],
    conflicts: [],
    proposedProfile,
    proposedCommands,
  };
}
