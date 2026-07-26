// C2-A Provider Registry。
//
// 設計上刻意「不」提供任何模組層級的全域可變單例（例如 `export const registry
// = new ProviderRegistry()`）。每個呼叫端（含測試）自行 `new ProviderRegistry()`，
// 避免不同測試檔案之間互相污染註冊表狀態。

import { AuthProviderNotFoundError, AuthProviderUnavailableError, AuthProviderConfigurationError } from "./errors";
import type { AuthProvider } from "./types";

export class ProviderRegistry {
  private readonly providers = new Map<string, AuthProvider>();

  register(provider: AuthProvider): void {
    const key = provider.descriptor.key;
    if (this.providers.has(key)) {
      throw new AuthProviderConfigurationError(`Provider key 重複，已存在同名的 Provider：${key}`);
    }
    this.providers.set(key, provider);
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  get(key: string): AuthProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new AuthProviderNotFoundError(`找不到指定的 Provider：${key}`);
    }
    return provider;
  }

  list(): readonly AuthProvider[] {
    return Array.from(this.providers.values());
  }

  /** 取得可用於 authenticate 的 Provider；disabled 的 Provider 一律拒絕。 */
  getEnabledOrThrow(key: string): AuthProvider {
    const provider = this.get(key);
    if (!provider.descriptor.enabled) {
      throw new AuthProviderUnavailableError(`Provider 已停用，無法用於驗證：${key}`);
    }
    return provider;
  }
}
