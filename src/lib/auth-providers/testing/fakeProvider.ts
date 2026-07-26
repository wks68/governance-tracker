// C2-A FakeProvider／TestProvider。
//
// 僅供測試使用：讓 registry／factory／identity 相關測試不需要依賴真正的
// LocalProvider 或未來的外部系統，即可控制「驗證成功／失敗」與健康狀態。

import { createProviderDescriptor } from "../provider";
import type { AuthProviderConfig } from "../config";
import type {
  AuthenticateRequest,
  AuthenticateResult,
  AuthProvider,
  HealthCheckResult,
  HealthStatus,
  NormalizedExternalIdentity,
  ProviderKind,
} from "../types";

export interface FakeProviderOptions {
  readonly key: string;
  readonly kind?: ProviderKind;
  readonly displayName?: string;
  readonly enabled?: boolean;
  readonly behavior: "success" | "failure";
  readonly identity?: NormalizedExternalIdentity;
  readonly failureReason?: string;
  readonly healthStatus?: HealthStatus;
}

export function createFakeIdentity(overrides: Partial<NormalizedExternalIdentity> = {}): NormalizedExternalIdentity {
  return {
    providerKey: overrides.providerKey ?? "fake-provider",
    subject: overrides.subject ?? "fake-subject-1",
    loginIdentifier: overrides.loginIdentifier ?? "fake.user",
    displayName: overrides.displayName ?? "Fake User",
    email: overrides.email ?? "fake.user@example.invalid",
    department: overrides.department ?? null,
    groups: overrides.groups ?? [],
    rawClaimsReference: overrides.rawClaimsReference ?? { knownFieldKeys: [], fieldCount: 0 },
  };
}

export function createFakeProvider(options: FakeProviderOptions): AuthProvider {
  const descriptor = createProviderDescriptor({
    key: options.key,
    kind: options.kind ?? "LOCAL",
    displayName: options.displayName ?? options.key,
    enabled: options.enabled ?? true,
    capabilities: {
      supportsAuthentication: true,
      supportsGroupSync: true,
      supportsHealthCheck: true,
    },
  });

  return {
    descriptor,
    async authenticate(_request: AuthenticateRequest): Promise<AuthenticateResult> {
      if (options.behavior === "success") {
        return { ok: true, identity: options.identity ?? createFakeIdentity({ providerKey: descriptor.key }) };
      }
      return { ok: false, reason: options.failureReason ?? "fake authentication failure" };
    },
    async checkHealth(): Promise<HealthCheckResult> {
      return {
        status: options.healthStatus ?? "HEALTHY",
        checkedAt: new Date(),
        detail: "FakeProvider 健康狀態由測試設定",
      };
    },
  };
}

export function fakeConfig(overrides: Partial<AuthProviderConfig> = {}): AuthProviderConfig {
  return {
    key: overrides.key ?? "fake-provider",
    kind: overrides.kind ?? "LOCAL",
    displayName: overrides.displayName ?? "Fake Provider",
    enabled: overrides.enabled ?? true,
    settings: overrides.settings ?? {},
    secrets: overrides.secrets ?? {},
  };
}
