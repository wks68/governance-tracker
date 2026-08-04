// C2-A Identity Mapping — 純函式集合。
//
// 安全邊界：本檔案只做「外部身分資料的正規化與比對」，絕不寫入 User／UserRole／
// TeamMembership，也不會自動把外部群組當成核准的系統角色。群組到系統角色的實際
// 治理（誰核准、何時生效、寫入哪些資料表）留給 C2-B／C3。這裡的函式全部是純
// 函式：相同輸入永遠得到相同輸出，不觸碰資料庫、不呼叫外部服務。

import { AuthProviderIdentityError } from "./errors";
import type { NormalizedExternalIdentity, RawClaimsSummary } from "./types";

const KNOWN_IDENTITY_FIELDS = ["subject", "loginIdentifier", "displayName", "email", "department", "groups"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeRawClaims(raw: Record<string, unknown>): RawClaimsSummary {
  const keys = Object.keys(raw);
  return {
    knownFieldKeys: KNOWN_IDENTITY_FIELDS.filter((field) => keys.includes(field)),
    fieldCount: keys.length,
  };
}

function toTrimmedStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 把未知的外部原始身分資料轉為 NormalizedExternalIdentity。任何 Provider 專有
 * claims（例如某 LDAP schema 特有欄位）一律不得穿透到回傳值——只有白名單內的
 * 欄位會被讀取，其餘只計入 rawClaimsReference 的 fieldCount。
 */
export function normalizeIdentity(providerKey: string, raw: unknown): NormalizedExternalIdentity {
  if (!isPlainObject(raw)) {
    throw new AuthProviderIdentityError("外部身分資料格式錯誤：預期為物件");
  }

  const subject = toTrimmedStringOrNull(raw.subject);
  const loginIdentifier = toTrimmedStringOrNull(raw.loginIdentifier);
  const displayName = toTrimmedStringOrNull(raw.displayName);

  if (!subject) throw new AuthProviderIdentityError("外部身分資料缺少必要欄位：subject");
  if (!loginIdentifier) throw new AuthProviderIdentityError("外部身分資料缺少必要欄位：loginIdentifier");
  if (!displayName) throw new AuthProviderIdentityError("外部身分資料缺少必要欄位：displayName");

  const email = toTrimmedStringOrNull(raw.email);
  const department = toTrimmedStringOrNull(raw.department);
  const groups = Array.isArray(raw.groups) ? raw.groups.filter((item): item is string => typeof item === "string") : [];

  return {
    providerKey,
    subject,
    loginIdentifier,
    displayName,
    email,
    department,
    groups,
    rawClaimsReference: summarizeRawClaims(raw),
  };
}

export interface IdentityValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** 檢查已建構的 NormalizedExternalIdentity 是否符合最小不變量。 */
export function validateNormalizedIdentity(identity: NormalizedExternalIdentity): IdentityValidationResult {
  const errors: string[] = [];

  if (identity.providerKey.trim().length === 0) errors.push("providerKey 不得為空");
  if (identity.subject.trim().length === 0) errors.push("subject 不得為空");
  if (identity.loginIdentifier.trim().length === 0) errors.push("loginIdentifier 不得為空");
  if (identity.displayName.trim().length === 0) errors.push("displayName 不得為空");
  if (identity.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) errors.push("email 格式不正確");
  if (!identity.groups.every((g) => typeof g === "string" && g.length > 0)) errors.push("groups 內必須全部是非空字串");

  return { valid: errors.length === 0, errors };
}

/**
 * 把外部群組名稱對應為系統可辨識的群組識別碼。mapping 是呼叫端提供的白名單
 * 對照表；不在白名單內的外部群組會被捨棄，而不是原樣放行。這只是「正規化
 * 名稱」的純函式，不代表核准、不代表角色指派。
 */
export function mapExternalGroups(externalGroups: readonly string[], mapping: Readonly<Record<string, string>>): readonly string[] {
  const mapped = new Set<string>();
  for (const externalGroup of externalGroups) {
    const target = mapping[externalGroup];
    if (target) mapped.add(target);
  }
  return Array.from(mapped);
}

export type IdentityLinkMatchField = "loginIdentifier" | "email";

export interface IdentityLinkCandidate {
  readonly loginIdentifier?: string | null;
  readonly email?: string | null;
}

export interface IdentityLinkComparison {
  readonly matched: boolean;
  readonly matchedOn: IdentityLinkMatchField | null;
}

/**
 * 純比對函式：判斷一個既有的內部候選人（例如既有 User 的顯示投影）是否「可能」
 * 對應到某個外部身分。只回傳比對結果，不做任何連結、不寫入任何資料——是否
 * 真的建立連結、由誰核准，留給 C2-B／C3 的治理流程決定。
 */
export function compareIdentityLinkCandidate(
  identity: NormalizedExternalIdentity,
  candidate: IdentityLinkCandidate,
): IdentityLinkComparison {
  if (candidate.loginIdentifier && candidate.loginIdentifier === identity.loginIdentifier) {
    return { matched: true, matchedOn: "loginIdentifier" };
  }
  if (candidate.email && identity.email && candidate.email.toLowerCase() === identity.email.toLowerCase()) {
    return { matched: true, matchedOn: "email" };
  }
  return { matched: false, matchedOn: null };
}
