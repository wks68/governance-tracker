// C2-B1 Group Mapping Policy — 純決策函式。
//
// 安全邊界：GroupMappingRule 型別本身沒有 membershipRole／supervisor／delegate／
// approvalAuthority 欄位，因此本檔案不可能產生「建議 Team LEAD」「建議主管」
// 「建議代理」「建議核准權」——這是型別層級的保證，不是執行期判斷。角色建議
// 一律再過一次 isForbiddenRoleKey 防線，即使規則本身在載入時漏檢，這裡仍會
// 把違規規則整批排除並記錄在 rejectedForbiddenRuleIds。
//
// priority 數字越小＝優先權越高，只用來在「角色／Team 出現衝突建議」時選出
// winner；衝突本身一律完整記錄在 conflicts，不會被優先權悄悄蓋過。

import { isForbiddenRoleKey } from "./types";
import type { GroupMappingConflict, GroupMappingEvaluation, GroupMappingRule, GroupMappingSuggestion } from "./types";
import type { NormalizedExternalIdentity } from "../auth-providers";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

interface KindResolution {
  readonly suggestion: GroupMappingSuggestion | null;
  readonly conflict: GroupMappingConflict | null;
}

function resolveKind(kind: "ROLE" | "TEAM", matchedRules: readonly GroupMappingRule[], getKey: (rule: GroupMappingRule) => string | null): KindResolution {
  const withKey = matchedRules.filter((rule) => getKey(rule) !== null);
  if (withKey.length === 0) return { suggestion: null, conflict: null };

  const distinctKeys = Array.from(new Set(withKey.map((rule) => getKey(rule) as string)));
  const sorted = [...withKey].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const winner = sorted[0];
  const winningKey = getKey(winner) as string;

  const hasConflict = distinctKeys.length > 1;
  const requiresApproval = hasConflict || withKey.some((rule) => rule.requiresApproval);
  const sourceRuleIds = withKey.filter((rule) => getKey(rule) === winningKey).map((rule) => rule.id);

  const suggestion: GroupMappingSuggestion = { kind, key: winningKey, requiresApproval, sourceRuleIds };
  const conflict: GroupMappingConflict | null = hasConflict
    ? {
        kind: kind === "ROLE" ? "ROLE_CONFLICT" : "TEAM_CONFLICT",
        candidateKeys: distinctKeys,
        winningKey,
        ruleIds: withKey.map((rule) => rule.id),
      }
    : null;

  return { suggestion, conflict };
}

export function evaluateGroupMappings(identity: Pick<NormalizedExternalIdentity, "providerKey" | "groups">, rules: readonly GroupMappingRule[]): GroupMappingEvaluation {
  const normalizedGroups = new Set(identity.groups.map(normalize));

  const rejectedForbiddenRuleIds: string[] = [];
  const skippedDisabledRuleIds: string[] = [];
  const skippedOutOfScopeRuleIds: string[] = [];
  const matchedRules: GroupMappingRule[] = [];

  for (const rule of rules) {
    if (rule.targetRoleKey !== null && isForbiddenRoleKey(rule.targetRoleKey)) {
      rejectedForbiddenRuleIds.push(rule.id);
      continue;
    }
    if (!rule.enabled) {
      skippedDisabledRuleIds.push(rule.id);
      continue;
    }
    if (rule.providerScope.length > 0 && !rule.providerScope.includes(identity.providerKey)) {
      skippedOutOfScopeRuleIds.push(rule.id);
      continue;
    }
    if (normalizedGroups.has(normalize(rule.externalGroupPattern))) {
      matchedRules.push(rule);
    }
  }

  if (matchedRules.length === 0) {
    return {
      matchedRuleIds: [],
      suggestions: [],
      conflicts: [],
      rejectedForbiddenRuleIds,
      skippedDisabledRuleIds,
      skippedOutOfScopeRuleIds,
      requiresApproval: false,
      reasonCode: "NO_MATCH",
    };
  }

  const roleResolution = resolveKind("ROLE", matchedRules, (rule) => rule.targetRoleKey);
  const teamResolution = resolveKind("TEAM", matchedRules, (rule) => rule.targetTeamKey);

  const suggestions = [roleResolution.suggestion, teamResolution.suggestion].filter((s): s is GroupMappingSuggestion => s !== null);
  const conflicts = [roleResolution.conflict, teamResolution.conflict].filter((c): c is GroupMappingConflict => c !== null);

  const reasonCode =
    matchedRules.length === 1 ? "SINGLE_MATCH" : conflicts.length > 0 ? "MULTIPLE_MATCHES_WITH_CONFLICT" : "MULTIPLE_MATCHES_NO_CONFLICT";

  return {
    matchedRuleIds: matchedRules.map((rule) => rule.id),
    suggestions,
    conflicts,
    rejectedForbiddenRuleIds,
    skippedDisabledRuleIds,
    skippedOutOfScopeRuleIds,
    requiresApproval: conflicts.length > 0 || suggestions.some((s) => s.requiresApproval),
    reasonCode,
  };
}
