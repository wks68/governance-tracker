// C2-A Authentication Provider 抽象層 — 公開 API。
//
// 這是本模組唯一允許被外部 import 的入口。其他領域（People／Workflow／UI）
// 一律只能從這裡取用型別與函式，不得深入 import `auth-providers/**` 底下的
// 內部檔案。本階段（C2-A）只建立可擴充、可測試的架構，不整合真實
// LDAP／OIDC／SAML，也不建立任何 Migration。

export type {
  ProviderKind,
  RawClaimsSummary,
  NormalizedExternalIdentity,
  ProviderCapabilities,
  AuthenticateRequest,
  AuthenticateSuccess,
  AuthenticateFailure,
  AuthenticateResult,
  HealthStatus,
  HealthCheckResult,
  ProviderDescriptor,
  AuthProvider,
} from "./types";

export type { SecretReference, ProviderSettingValue, AuthProviderConfig, ConfigValidationResult } from "./config";
export { validateProviderConfig, toValidatedConfig } from "./config";

export {
  AuthProviderConfigurationError,
  AuthProviderUnavailableError,
  AuthProviderAuthenticationError,
  AuthProviderIdentityError,
  AuthProviderNotFoundError,
  isKnownAuthProviderError,
  containsSensitiveContent,
  toSafeProviderError,
  redactMessage,
} from "./errors";
export type { KnownAuthProviderError } from "./errors";

export {
  normalizeIdentity,
  validateNormalizedIdentity,
  mapExternalGroups,
  compareIdentityLinkCandidate,
} from "./identity";
export type { IdentityValidationResult, IdentityLinkCandidate, IdentityLinkComparison, IdentityLinkMatchField } from "./identity";

export { createProviderDescriptor, isProviderEnabled } from "./provider";

export { ProviderRegistry } from "./registry";

export { createProviderFromConfig } from "./factory";

export { createLocalProvider, authenticateLocalOrThrow } from "./local/localProvider";

export { createFakeProvider, createFakeIdentity, fakeConfig } from "./testing/fakeProvider";
export type { FakeProviderOptions } from "./testing/fakeProvider";
