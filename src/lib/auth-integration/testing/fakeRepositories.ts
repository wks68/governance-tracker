// C2-B1 Fake Ports — 僅供測試使用的記憶體實作。
//
// 目的：讓 orchestrateExternalLogin 的測試不需要依賴任何真正的資料庫或未來的
// C2-B2 adapter。每個 factory 函式都會建立獨立狀態，不提供任何模組層級的
// 全域可變 singleton（與 C2-A 的 ProviderRegistry 設計哲學一致）。

import type { ExistingIdentityLink, GroupMappingRule, IdentityLinkPolicy, IdentityLinkStatus, InternalUserProjection, JitProvisioningPolicy } from "../types";
import { createDefaultIdentityLinkPolicy, createDefaultJitProvisioningPolicy } from "../types";
import type { IdentityLinkRepository, ProviderConfigRepository, RoleAssignmentPort, TeamMembershipPort, TransactionBoundary, UserDirectoryPort } from "../ports";

export function createFakeUser(overrides: Partial<InternalUserProjection> = {}): InternalUserProjection {
  return {
    userId: overrides.userId ?? "user-1",
    loginIdentifier: overrides.loginIdentifier ?? "fake.user",
    email: overrides.email ?? "fake.user@example.invalid",
    displayName: overrides.displayName ?? "Fake User",
    isAdmin: overrides.isAdmin ?? false,
    active: overrides.active ?? true,
  };
}

export interface FakeLinkRecord {
  readonly providerKey: string;
  readonly subject: string;
  readonly userId: string;
  readonly status: IdentityLinkStatus;
}

export interface FakeIdentityLinkRepositoryOptions {
  readonly links?: readonly FakeLinkRecord[];
  readonly users?: readonly InternalUserProjection[];
}

/**
 * 以 (providerKey, subject) 複合鍵查詢——不同 providerKey 對同一個 subject 字串
 * 查詢一律回傳 null（除非該 providerKey 也有對應的 link 記錄），藉此在測試中
 * 驗證「不同 Provider 的 subject 不視為全域唯一」。
 */
export function createFakeIdentityLinkRepository(options: FakeIdentityLinkRepositoryOptions = {}): IdentityLinkRepository {
  const links = options.links ?? [];
  const users = options.users ?? [];
  return {
    async findLinkByProviderSubject(providerKey: string, subject: string): Promise<ExistingIdentityLink | null> {
      const found = links.find((link) => link.providerKey === providerKey && link.subject === subject);
      return found ? { userId: found.userId, providerKey: found.providerKey, status: found.status } : null;
    },
    async findCandidatesByLoginIdentifier(loginIdentifier: string): Promise<readonly InternalUserProjection[]> {
      return users.filter((user) => user.loginIdentifier === loginIdentifier);
    },
    async findCandidatesByEmail(email: string): Promise<readonly InternalUserProjection[]> {
      return users.filter((user) => user.email !== null && user.email.toLowerCase() === email.toLowerCase());
    },
  };
}

export function createFakeUserDirectory(options: { readonly users?: readonly InternalUserProjection[] } = {}): UserDirectoryPort {
  const users = options.users ?? [];
  return {
    async findActiveUserByLoginIdentifier(loginIdentifier: string): Promise<InternalUserProjection | null> {
      return users.find((user) => user.loginIdentifier === loginIdentifier && user.active) ?? null;
    },
  };
}

export function createFakeRoleAssignmentPort(options: { readonly rolesByUserId?: Readonly<Record<string, readonly string[]>> } = {}): RoleAssignmentPort {
  const rolesByUserId = options.rolesByUserId ?? {};
  return {
    async listCurrentRoleKeys(userId: string): Promise<readonly string[]> {
      return rolesByUserId[userId] ?? [];
    },
  };
}

export function createFakeTeamMembershipPort(options: { readonly teamsByUserId?: Readonly<Record<string, readonly string[]>> } = {}): TeamMembershipPort {
  const teamsByUserId = options.teamsByUserId ?? {};
  return {
    async listCurrentTeamKeys(userId: string): Promise<readonly string[]> {
      return teamsByUserId[userId] ?? [];
    },
  };
}

export interface FakeProviderConfigRepositoryOptions {
  readonly identityLinkPolicy?: IdentityLinkPolicy;
  readonly jitPolicy?: JitProvisioningPolicy;
  readonly groupRules?: readonly GroupMappingRule[];
}

export function createFakeProviderConfigRepository(options: FakeProviderConfigRepositoryOptions = {}): ProviderConfigRepository {
  const identityLinkPolicy = options.identityLinkPolicy ?? createDefaultIdentityLinkPolicy();
  const jitPolicy = options.jitPolicy ?? createDefaultJitProvisioningPolicy();
  const groupRules = options.groupRules ?? [];
  return {
    async getIdentityLinkPolicy(): Promise<IdentityLinkPolicy> {
      return identityLinkPolicy;
    },
    async getJitProvisioningPolicy(): Promise<JitProvisioningPolicy> {
      return jitPolicy;
    },
    async getGroupMappingRules(): Promise<readonly GroupMappingRule[]> {
      return groupRules;
    },
  };
}

/** 直接執行 fn，不做任何真正的 transaction 管理——本階段沒有任何寫入需要包在 transaction 內。 */
export function createFakeTransactionBoundary(): TransactionBoundary {
  return {
    async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}
