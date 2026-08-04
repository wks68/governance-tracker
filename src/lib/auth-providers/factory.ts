// C2-A Provider Factory。
//
// 依據「已驗證」的設定建立 Provider 實例。C2-A 只支援建立 LOCAL；LDAP／OIDC／
// SAML 目前只是明確的未實作 placeholder（清楚失敗，不假裝可運作的半成品）。
// 新增 Provider 種類時，只需要在 `builders` 這張表新增一筆，不需要修改任何
// 呼叫此 Factory 的業務模組。

import { validateProviderConfig, toValidatedConfig } from "./config";
import { AuthProviderConfigurationError } from "./errors";
import { createLocalProvider } from "./local/localProvider";
import type { AuthProviderConfig } from "./config";
import type { AuthProvider, ProviderKind } from "./types";

type ProviderBuilder = (config: AuthProviderConfig) => AuthProvider;

function notImplementedBuilder(kind: ProviderKind): ProviderBuilder {
  return () => {
    throw new AuthProviderConfigurationError(`Provider 類型 ${kind} 尚未實作，本階段（C2-A）僅提供介面定義`);
  };
}

const builders: Readonly<Record<ProviderKind, ProviderBuilder>> = {
  LOCAL: createLocalProvider,
  LDAP: notImplementedBuilder("LDAP"),
  OIDC: notImplementedBuilder("OIDC"),
  SAML: notImplementedBuilder("SAML"),
};

/**
 * 建立 Provider。輸入為 unknown，內部先跑 validateProviderConfig，未通過一律
 * 拋出 AuthProviderConfigurationError（訊息取自驗證結果，不含任何 secret 值）。
 */
export function createProviderFromConfig(input: unknown): AuthProvider {
  const validation = validateProviderConfig(input);
  if (!validation.valid) {
    throw new AuthProviderConfigurationError(`Provider 設定不合法：${validation.errors.join("；")}`);
  }
  const config = toValidatedConfig(input as Record<string, unknown>);
  const builder = builders[config.kind];
  if (!builder) {
    throw new AuthProviderConfigurationError(`不支援的 Provider 類型：${config.kind}`);
  }
  return builder(config);
}
