// C2-A：Authentication Provider 抽象層 — 型別契約。
//
// 安全邊界：本檔案只定義「外部身分如何被描述」與「Provider 如何被呼叫」的形狀，
// 不涉及任何實際驗證邏輯、Session、Prisma 或 UI。任一型別都不得持有密碼、
// Access／Refresh Token、LDAP bind password、SAML assertion 或未過濾的完整
// raw claims——外部憑證資料一律以 `unknown` 接收，經 normalizeIdentity 驗證後
// 才能離開 Provider 邊界（見 identity.ts）。

/** 預留四種 Provider 類型；C2-A 只實作 LOCAL 與測試用 Provider。 */
export type ProviderKind = "LOCAL" | "LDAP" | "OIDC" | "SAML";

/**
 * 最小、去識別化的 raw claims 摘要。不得包含任何欄位的實際值，只描述
 * 「收到了哪些已知欄位」，供除錯與稽核追蹤使用。
 */
export interface RawClaimsSummary {
  readonly knownFieldKeys: readonly string[];
  readonly fieldCount: number;
}

/** Provider 對外正規化後的身分——People Service 之後若要串接，只能消費這個形狀。 */
export interface NormalizedExternalIdentity {
  readonly providerKey: string;
  readonly subject: string;
  readonly loginIdentifier: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly department: string | null;
  readonly groups: readonly string[];
  readonly rawClaimsReference: RawClaimsSummary;
}

/** Provider 的能力／功能中繼資料，讓呼叫端不需要用 kind 做 switch 判斷細節。 */
export interface ProviderCapabilities {
  readonly supportsAuthentication: boolean;
  readonly supportsGroupSync: boolean;
  readonly supportsHealthCheck: boolean;
}

/** 未經驗證的外部憑證輸入。內容形狀由各 Provider 自行驗證，呼叫端不得假設欄位存在。 */
export type AuthenticateRequest = unknown;

export interface AuthenticateSuccess {
  readonly ok: true;
  readonly identity: NormalizedExternalIdentity;
}

export interface AuthenticateFailure {
  readonly ok: false;
  readonly reason: string;
}

export type AuthenticateResult = AuthenticateSuccess | AuthenticateFailure;

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export interface HealthCheckResult {
  readonly status: HealthStatus;
  readonly checkedAt: Date;
  readonly detail: string;
}

export interface ProviderDescriptor {
  readonly key: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly capabilities: ProviderCapabilities;
}

/**
 * Provider Contract。所有 Provider 實作（LOCAL、未來的 LDAP／OIDC／SAML、測試用
 * Fake）都必須符合此介面。介面本身不得綁定任何單一產品的專有型別。
 */
export interface AuthProvider {
  readonly descriptor: ProviderDescriptor;
  authenticate(request: AuthenticateRequest): Promise<AuthenticateResult>;
  checkHealth(): Promise<HealthCheckResult>;
}
