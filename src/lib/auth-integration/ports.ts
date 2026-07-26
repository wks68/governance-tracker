// C2-B1 Ports — 描述未來 C2-B2 資料存取層的介面，本階段完全不提供任何真正實作
// （真正的 Prisma-backed adapter 留給 C2-B2）。
//
// 安全邊界：本檔案只定義 interface，不 import Prisma、不 import next/headers。
// 服務層（identityLinking／jitProvisioning／groupMapping／loginOrchestration）
// 只透過這些 port 讀取資料、輸出決策，從不直接呼叫任何資料庫用戶端。

import type { AuthAuditEvent, ExistingIdentityLink, GroupMappingRule, IdentityLinkPolicy, InternalUserProjection, JitProvisioningPolicy } from "./types";

export interface IdentityLinkRepository {
  /** 以 (providerKey, subject) 複合鍵查詢既有連結；不同 Provider 的 subject 不共用同一筆連結。 */
  findLinkByProviderSubject(providerKey: string, subject: string): Promise<ExistingIdentityLink | null>;
  findCandidatesByLoginIdentifier(loginIdentifier: string): Promise<readonly InternalUserProjection[]>;
  findCandidatesByEmail(email: string): Promise<readonly InternalUserProjection[]>;
}

export interface UserDirectoryPort {
  /** 供 JIT 決策檢查 loginIdentifier 是否已被其他（未連結）帳號佔用。 */
  findActiveUserByLoginIdentifier(loginIdentifier: string): Promise<InternalUserProjection | null>;
}

export interface RoleAssignmentPort {
  listCurrentRoleKeys(userId: string): Promise<readonly string[]>;
}

export interface TeamMembershipPort {
  listCurrentTeamKeys(userId: string): Promise<readonly string[]>;
}

export interface ProviderConfigRepository {
  getIdentityLinkPolicy(providerKey: string): Promise<IdentityLinkPolicy>;
  getJitProvisioningPolicy(providerKey: string): Promise<JitProvisioningPolicy>;
  getGroupMappingRules(providerKey: string): Promise<readonly GroupMappingRule[]>;
}

export interface AuthAuditSink {
  record(event: AuthAuditEvent): Promise<void>;
}

/**
 * 描述「未來寫入需要在單一 transaction 內完成」的邊界。本階段的服務不寫入任何
 * User／UserRole／TeamMembership，因此本階段不會呼叫這個 port——它只是預留給
 * C2-B2 adapter 的形狀契約。
 */
export interface TransactionBoundary {
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>;
}
