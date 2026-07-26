// C2-B1 設定驗證 — 純函式，不拋出例外，一律回傳結果物件（與 C2-A 的
// validateProviderConfig 風格一致）。這裡是「設定層」的第一道防線；決策函式
// （identityLinking.ts／jitProvisioning.ts／groupMapping.ts）仍會在執行期
// 獨立做第二道防禦性檢查，不依賴呼叫端一定先跑過這裡的驗證。

import { isForbiddenRoleKey } from "./types";
import type { GroupMappingRule, IdentityLinkPolicy, JitProvisioningPolicy, LoginIntegrationPlan } from "./types";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateIdentityLinkPolicy(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { valid: false, errors: ["policy 必須是物件"] };
  if (typeof input.allowEmailMatching !== "boolean") errors.push("allowEmailMatching 必須是布林值");
  return { valid: errors.length === 0, errors };
}

export function validateJitProvisioningPolicy(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { valid: false, errors: ["policy 必須是物件"] };

  if (typeof input.allowJit !== "boolean") errors.push("allowJit 必須是布林值");
  if (typeof input.requireApprovalAlways !== "boolean") errors.push("requireApprovalAlways 必須是布林值");

  const { defaultRoleCommand, defaultTeamCommand } = input;
  if (defaultRoleCommand !== null && defaultRoleCommand !== undefined) {
    if (!isPlainObject(defaultRoleCommand) || typeof defaultRoleCommand.roleKey !== "string" || defaultRoleCommand.roleKey.trim().length === 0) {
      errors.push("defaultRoleCommand 必須是 { roleKey, requiresApproval } 或 null");
    } else if (isForbiddenRoleKey(defaultRoleCommand.roleKey)) {
      errors.push(`defaultRoleCommand.roleKey 不得為禁止指派的角色：${defaultRoleCommand.roleKey}`);
    }
    if (isPlainObject(defaultRoleCommand) && typeof defaultRoleCommand.requiresApproval !== "boolean") {
      errors.push("defaultRoleCommand.requiresApproval 必須是布林值");
    }
  }
  if (defaultTeamCommand !== null && defaultTeamCommand !== undefined) {
    if (!isPlainObject(defaultTeamCommand) || typeof defaultTeamCommand.teamKey !== "string" || defaultTeamCommand.teamKey.trim().length === 0) {
      errors.push("defaultTeamCommand 必須是 { teamKey, requiresApproval } 或 null");
    }
    if (isPlainObject(defaultTeamCommand) && typeof defaultTeamCommand.requiresApproval !== "boolean") {
      errors.push("defaultTeamCommand.requiresApproval 必須是布林值");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateGroupMappingRule(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { valid: false, errors: ["rule 必須是物件"] };

  if (typeof input.id !== "string" || input.id.trim().length === 0) errors.push("id 必須是非空字串");
  if (typeof input.externalGroupPattern !== "string" || input.externalGroupPattern.trim().length === 0) {
    errors.push("externalGroupPattern 必須是非空字串");
  }
  if (input.targetRoleKey !== null && typeof input.targetRoleKey !== "string") errors.push("targetRoleKey 必須是字串或 null");
  if (typeof input.targetRoleKey === "string" && isForbiddenRoleKey(input.targetRoleKey)) {
    errors.push(`targetRoleKey 不得為禁止指派的角色：${input.targetRoleKey}`);
  }
  if (input.targetTeamKey !== null && typeof input.targetTeamKey !== "string") errors.push("targetTeamKey 必須是字串或 null");
  if (typeof input.priority !== "number" || !Number.isFinite(input.priority)) errors.push("priority 必須是有限數字");
  if (typeof input.enabled !== "boolean") errors.push("enabled 必須是布林值");
  if (typeof input.requiresApproval !== "boolean") errors.push("requiresApproval 必須是布林值");
  if (!Array.isArray(input.providerScope) || !input.providerScope.every((s: unknown) => typeof s === "string")) {
    errors.push("providerScope 必須是字串陣列");
  }

  return { valid: errors.length === 0, errors };
}

export function validateGroupMappingRules(rules: readonly unknown[]): ValidationResult {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  rules.forEach((rule, index) => {
    const result = validateGroupMappingRule(rule);
    if (!result.valid) errors.push(`rules[${index}]：${result.errors.join("；")}`);
    if (isPlainObject(rule) && typeof rule.id === "string") {
      if (seenIds.has(rule.id)) errors.push(`rules[${index}]：id 重複：${rule.id}`);
      seenIds.add(rule.id);
    }
  });
  return { valid: errors.length === 0, errors };
}

/**
 * 對已建構完成的 LoginIntegrationPlan 做最後一道不變量檢查——供未來 C2-B2
 * adapter 在真正執行任何命令前呼叫，或供測試斷言 orchestrateExternalLogin
 * 的輸出結構正確。不做任何 I/O，純檢查已存在的物件。
 */
export function validateLoginIntegrationPlan(plan: LoginIntegrationPlan): ValidationResult {
  const errors: string[] = [];

  if (plan.correlationId.trim().length === 0) errors.push("correlationId 不得為空");

  if (plan.identityLinkDecision.decision === "LINK_EXISTING" && plan.identityLinkDecision.matchedUserId === null) {
    errors.push("LINK_EXISTING 決策必須帶有 matchedUserId");
  }
  if (plan.identityLinkDecision.decision !== "LINK_EXISTING" && plan.identityLinkDecision.matchedUserId !== null) {
    errors.push("非 LINK_EXISTING 決策不得帶有 matchedUserId");
  }

  if (plan.identityLinkDecision.decision !== "CREATE_NEW" && plan.jitDecision !== null) {
    errors.push("僅 CREATE_NEW 決策可帶有 jitDecision");
  }

  for (const command of plan.suggestedCommands) {
    if (command.kind === "ASSIGN_ROLE" && isForbiddenRoleKey(command.roleKey)) {
      errors.push(`suggestedCommands 內出現禁止指派的角色：${command.roleKey}`);
    }
  }

  for (const event of plan.auditEvents) {
    if (event.correlationId !== plan.correlationId) errors.push("audit event 的 correlationId 與 plan 不一致");
  }

  return { valid: errors.length === 0, errors };
}
