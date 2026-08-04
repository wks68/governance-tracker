// C2-B1 錯誤模型。
//
// 安全邊界：與 C2-A 一致——.message 是唯一保證會被記錄／顯示的欄位，因此不得
// 包含密碼、Token、Cookie、bind credential、assertion 或原始例外內容。本模組
// 刻意不重新實作 redaction 規則，敏感內容偵測與訊息淨化一律沿用 C2-A 的
// containsSensitiveContent／redactMessage（見 auditEvents.ts）。這裡只新增
// C2-B1 自己領域的設定／驗證失敗類型。

export class AuthIntegrationConfigurationError extends Error {
  readonly code = "AUTH_INTEGRATION_CONFIGURATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthIntegrationConfigurationError";
  }
}

export class AuthIntegrationPlanValidationError extends Error {
  readonly code = "AUTH_INTEGRATION_PLAN_VALIDATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthIntegrationPlanValidationError";
  }
}

export type KnownAuthIntegrationError = AuthIntegrationConfigurationError | AuthIntegrationPlanValidationError;

const KNOWN_ERROR_CTORS = [AuthIntegrationConfigurationError, AuthIntegrationPlanValidationError] as const;

export function isKnownAuthIntegrationError(err: unknown): err is KnownAuthIntegrationError {
  return KNOWN_ERROR_CTORS.some((ctor) => err instanceof ctor);
}
