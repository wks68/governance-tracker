// C2-A 錯誤模型。
//
// 安全邊界：這些錯誤物件的 .message 是唯一保證會被記錄或顯示的欄位，因此絕對
// 不得包含密碼、Token、Cookie、bind credential、完整 assertion 或 stack trace。
// redactSecret／toSafeProviderError 是唯一允許把「未知例外」轉成這些型別的路徑。

export class AuthProviderConfigurationError extends Error {
  readonly code = "AUTH_PROVIDER_CONFIGURATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthProviderConfigurationError";
  }
}

export class AuthProviderUnavailableError extends Error {
  readonly code = "AUTH_PROVIDER_UNAVAILABLE_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthProviderUnavailableError";
  }
}

export class AuthProviderAuthenticationError extends Error {
  readonly code = "AUTH_PROVIDER_AUTHENTICATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthProviderAuthenticationError";
  }
}

export class AuthProviderIdentityError extends Error {
  readonly code = "AUTH_PROVIDER_IDENTITY_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthProviderIdentityError";
  }
}

export class AuthProviderNotFoundError extends Error {
  readonly code = "AUTH_PROVIDER_NOT_FOUND_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthProviderNotFoundError";
  }
}

export type KnownAuthProviderError =
  | AuthProviderConfigurationError
  | AuthProviderUnavailableError
  | AuthProviderAuthenticationError
  | AuthProviderIdentityError
  | AuthProviderNotFoundError;

const KNOWN_ERROR_CTORS = [
  AuthProviderConfigurationError,
  AuthProviderUnavailableError,
  AuthProviderAuthenticationError,
  AuthProviderIdentityError,
  AuthProviderNotFoundError,
] as const;

export function isKnownAuthProviderError(err: unknown): err is KnownAuthProviderError {
  return KNOWN_ERROR_CTORS.some((ctor) => err instanceof ctor);
}

/**
 * 常見會夾帶敏感字串的樣式（形式上的偵測，非密碼強度判斷）。用於在把未知例外
 * 轉為對外訊息前，先阻擋明顯外洩的片段。
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /password\s*[:=]\s*\S+/i,
  /bind[_-]?credential\S*/i,
  /(access|refresh)[_-]?token\s*[:=]?\s*\S+/i,
  /bearer\s+\S+/i,
  /set-cookie\s*[:=]\s*\S+/i,
  /<saml[a-z:]*assertion[\s\S]*?<\/[a-z:]*assertion>/i,
];

export function containsSensitiveContent(value: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * 把任意未知例外安全地轉成固定通用訊息；絕不轉傳原始 message 或 stack。
 * 呼叫端若已持有已知的 AuthProvider*Error，應直接使用該錯誤，不需經過此函式。
 */
export function toSafeProviderError(_err: unknown, fallbackMessage: string): AuthProviderUnavailableError {
  return new AuthProviderUnavailableError(fallbackMessage);
}

/** 對外訊息做最後一道防線：若仍疑似含敏感內容，整段換成固定訊息。 */
export function redactMessage(message: string, fallback = "發生內部錯誤，請稍後再試"): string {
  return containsSensitiveContent(message) ? fallback : message;
}
