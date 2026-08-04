// C2-A 設定與 Secret 邊界。
//
// 安全邊界：SecretReference 只能承載「去哪裡找 secret」的座標（key／reference
// name／resolver identifier），型別上不存在可以放 secret 實際值的欄位。本模組
// 不建立任何真正的 Vault、環境變數或資料庫 Secret Store——resolver 的實作留給
// 未來階段，這裡只定義形狀與驗證規則。

import type { ProviderKind } from "./types";

/**
 * 指向某個 secret 的座標，不含值本身。resolverId 描述「由哪個機制解析」
 * （例如未來的 "env" 或 "vault"），本模組不實作任何 resolver。
 */
export interface SecretReference {
  readonly key: string;
  readonly referenceName: string;
  readonly resolverId: string;
}

/** 一般（非機密）設定；值一律是原始型別或字串陣列，不得放 SecretReference 以外的機密資料。 */
export type ProviderSettingValue = string | number | boolean | readonly string[];

export interface AuthProviderConfig {
  readonly key: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly settings: Readonly<Record<string, ProviderSettingValue>>;
  readonly secrets: Readonly<Record<string, SecretReference>>;
}

export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderSettingValue(value: unknown): value is ProviderSettingValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSecretReference(value: unknown): value is SecretReference {
  if (!isPlainObject(value)) return false;
  const { key, referenceName, resolverId } = value;
  return typeof key === "string" && key.length > 0 && typeof referenceName === "string" && referenceName.length > 0 && typeof resolverId === "string" && resolverId.length > 0;
}

const VALID_KINDS: readonly ProviderKind[] = ["LOCAL", "LDAP", "OIDC", "SAML"];

/**
 * 驗證未知輸入是否構成合法的 AuthProviderConfig。不拋出例外，一律回傳結果物件，
 * 讓呼叫端（例如 ProviderFactory）自行決定要不要轉成 AuthProviderConfigurationError。
 */
export function validateProviderConfig(input: unknown): ConfigValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { valid: false, errors: ["設定必須是物件"] };
  }

  const { key, kind, displayName, enabled, settings, secrets } = input;

  if (typeof key !== "string" || key.trim().length === 0) errors.push("key 必須是非空字串");
  if (typeof kind !== "string" || !VALID_KINDS.includes(kind as ProviderKind)) {
    errors.push(`kind 必須是以下其中之一：${VALID_KINDS.join(", ")}`);
  }
  if (typeof displayName !== "string" || displayName.trim().length === 0) errors.push("displayName 必須是非空字串");
  if (typeof enabled !== "boolean") errors.push("enabled 必須是布林值");

  if (settings === undefined) {
    // 允許省略，等同空物件。
  } else if (!isPlainObject(settings)) {
    errors.push("settings 必須是物件");
  } else {
    for (const [settingKey, settingValue] of Object.entries(settings)) {
      if (!isProviderSettingValue(settingValue)) {
        errors.push(`settings.${settingKey} 型別不允許（只能是字串／數字／布林／字串陣列）`);
      }
    }
  }

  if (secrets === undefined) {
    // 允許省略，等同空物件。
  } else if (!isPlainObject(secrets)) {
    errors.push("secrets 必須是物件");
  } else {
    for (const [secretKey, secretValue] of Object.entries(secrets)) {
      if (!isSecretReference(secretValue)) {
        errors.push(`secrets.${secretKey} 必須是 SecretReference（key／referenceName／resolverId），不得直接放置密文`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 在 validateProviderConfig 通過後才可呼叫；把 unknown 收斂為型別化的 AuthProviderConfig。
 * 呼叫端必須自行先驗證，本函式不重複驗證邏輯。
 */
export function toValidatedConfig(input: Record<string, unknown>): AuthProviderConfig {
  return {
    key: input.key as string,
    kind: input.kind as ProviderKind,
    displayName: input.displayName as string,
    enabled: input.enabled as boolean,
    settings: (input.settings as Record<string, ProviderSettingValue> | undefined) ?? {},
    secrets: (input.secrets as Record<string, SecretReference> | undefined) ?? {},
  };
}
