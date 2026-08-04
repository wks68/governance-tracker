// C2-A LocalProvider Adapter。
//
// 目的僅止於證明「既有本機身分概念」可以套進 Provider Contract，作為未來
// 整合層可呼叫的 adapter。安全邊界：
//   - 不接管現行 Session（不 import next/headers、不讀寫 Cookie）。
//   - 不呼叫 loginAsUserAction，也不新增任何登入入口。
//   - 不 import Prisma、不複製 src/lib/peopleService 或 permissions.ts 的
//     授權規則——本 Provider 只負責把「呼叫端已經取得的本機身分資料」正規化，
//     不負責查詢資料庫、不負責 Capability 判斷。
//
// 呼叫端（未來的 C2-B 整合層）必須自行先取得本機使用者投影，再以該投影作為
// `authenticate` 的輸入；本檔案完全不知道資料從哪裡來。

import { AuthProviderAuthenticationError } from "../errors";
import { normalizeIdentity } from "../identity";
import { createProviderDescriptor } from "../provider";
import type { AuthProviderConfig } from "../config";
import type { AuthenticateRequest, AuthenticateResult, AuthProvider, HealthCheckResult } from "../types";

export function createLocalProvider(config: AuthProviderConfig): AuthProvider {
  const descriptor = createProviderDescriptor({
    key: config.key,
    kind: "LOCAL",
    displayName: config.displayName,
    enabled: config.enabled,
    capabilities: {
      supportsAuthentication: true,
      supportsGroupSync: false,
      supportsHealthCheck: true,
    },
  });

  return {
    descriptor,
    async authenticate(request: AuthenticateRequest): Promise<AuthenticateResult> {
      try {
        const identity = normalizeIdentity(descriptor.key, request);
        return { ok: true, identity };
      } catch (err) {
        const reason = err instanceof Error ? err.message : "本機身分資料無法正規化";
        return { ok: false, reason };
      }
    },
    async checkHealth(): Promise<HealthCheckResult> {
      return { status: "HEALTHY", checkedAt: new Date(), detail: "LocalProvider 無外部依賴" };
    },
  };
}

/** 明確拋出版本：呼叫端若希望「驗證失敗直接是例外」而非回傳值時使用。 */
export async function authenticateLocalOrThrow(provider: AuthProvider, request: AuthenticateRequest) {
  const result = await provider.authenticate(request);
  if (!result.ok) {
    throw new AuthProviderAuthenticationError(result.reason);
  }
  return result.identity;
}
