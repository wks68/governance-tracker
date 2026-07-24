// M1 新增：集中式權限判斷模組
//
// 設計原則（deny-by-default）：
// - 任何未被明確授予的能力（Capability）一律視為「不允許」，不得有隱性放行。
// - 無法辨識的角色字串（例如未來資料髒污或打字錯誤）視為「無任何能力」，而非退回某個預設能力組合。
//
// 相容性：
// - User.role（既有單一角色欄位）繼續作為主要角色來源，不刪除、不改名、不改型別。
// - UserRole（M1 新增，允許同一帳號擁有多個角色）與 User.role 取「聯集」，任一來源授予的能力即視為擁有。
//
// 本檔案的純邏輯函式（roleCapabilities / unionCapabilities / hasCapability 等）刻意不依賴 Prisma 查詢，
// 可在 Migration 套用前即可單元測試；DB 查詢型的便利函式（getUserCapabilities 等）需要 UserRole /
// TeamMember 資料表已存在，須等 M1-B 套用 Migration 後才能實際驗證。

import type { User } from "@prisma/client";
import type { RoleKey } from "./constants";
import { ROLES } from "./constants";
import { prisma } from "./prisma";

export type Capability =
  | "issue.view"
  | "issue.edit"
  | "issue.approve"
  | "issue.assignTeam"
  | "team.manageMembers"
  | "user.manageRoles"
  | "admin.full";

const VALID_ROLE_KEYS: ReadonlySet<string> = new Set(ROLES.map((r) => r.key));

// 既有角色 → 能力對照表（M1-A 範圍內的合理預設；未來里程碑可再擴充，但既有 key 不得移除）
const ROLE_CAPABILITIES: Record<RoleKey, readonly Capability[]> = {
  PM: ["issue.view", "issue.edit"],
  RD: ["issue.view", "issue.edit"],
  QA: ["issue.view", "issue.edit", "issue.approve"],
  OP: ["issue.view", "issue.edit"],
  資安推動小組: ["issue.view", "issue.approve"],
  DMS主管: ["issue.view", "issue.edit", "issue.approve", "issue.assignTeam"],
  Admin: [
    "issue.view",
    "issue.edit",
    "issue.approve",
    "issue.assignTeam",
    "team.manageMembers",
    "user.manageRoles",
    "admin.full",
  ],
};

function isKnownRoleKey(role: string): role is RoleKey {
  return VALID_ROLE_KEYS.has(role);
}

// 單一角色字串 → 能力集合。deny-by-default：無法辨識的角色回傳空集合，不套用任何預設能力。
export function roleCapabilities(role: string): ReadonlySet<Capability> {
  if (!isKnownRoleKey(role)) return new Set();
  return new Set(ROLE_CAPABILITIES[role]);
}

// 多個角色字串（例如 legacy User.role + UserRole 多筆）取聯集
export function unionCapabilities(roles: readonly string[]): ReadonlySet<Capability> {
  const result = new Set<Capability>();
  for (const role of roles) {
    for (const cap of roleCapabilities(role)) result.add(cap);
  }
  return result;
}

// 使用者目前所有有效角色（legacy User.role 與 UserRole 多角色聯集，並去重）
export function effectiveRoles(user: Pick<User, "role">, extraRoles: readonly string[] = []): string[] {
  const roles = new Set<string>();
  if (user.role) roles.add(user.role);
  for (const r of extraRoles) roles.add(r);
  return [...roles];
}

// 純邏輯版本：已知使用者角色（legacy + 多角色）時，是否擁有指定能力
export function hasCapability(
  user: Pick<User, "role">,
  capability: Capability,
  extraRoles: readonly string[] = [],
): boolean {
  const caps = unionCapabilities(effectiveRoles(user, extraRoles));
  return caps.has(capability);
}

export class PermissionDeniedError extends Error {
  constructor(capability: Capability) {
    super(`權限不足：缺少能力 "${capability}"`);
    this.name = "PermissionDeniedError";
  }
}

// 純邏輯版本：deny-by-default，未擁有能力時拋出 PermissionDeniedError
export function requireCapabilitySync(
  user: Pick<User, "role">,
  capability: Capability,
  extraRoles: readonly string[] = [],
): void {
  if (!hasCapability(user, capability, extraRoles)) {
    throw new PermissionDeniedError(capability);
  }
}

// ---------------------------------------------------------------------------
// Team 成員身分（MEMBER／LEAD）判斷
// ---------------------------------------------------------------------------

export type TeamMembershipRoleValue = "MEMBER" | "LEAD";

export interface TeamMembershipLike {
  teamId: string;
  userId: string;
  membershipRole: TeamMembershipRoleValue;
  isActive: boolean;
}

// 純邏輯版本：由已取得的成員名單判斷是否為（啟用中的）團隊成員
export function isTeamMember(memberships: readonly TeamMembershipLike[], teamId: string, userId: string): boolean {
  return memberships.some((m) => m.teamId === teamId && m.userId === userId && m.isActive);
}

// 純邏輯版本：由已取得的成員名單判斷是否為（啟用中的）團隊 LEAD
export function isTeamLead(memberships: readonly TeamMembershipLike[], teamId: string, userId: string): boolean {
  return memberships.some(
    (m) => m.teamId === teamId && m.userId === userId && m.isActive && m.membershipRole === "LEAD",
  );
}

// ---------------------------------------------------------------------------
// DB 查詢便利函式（需 UserRole / TeamMember 資料表已存在，等 M1-B 套用 Migration 後才可執行）
// ---------------------------------------------------------------------------

// 查詢使用者目前所有有效角色（legacy User.role + UserRole 多角色資料表）
export async function getUserEffectiveRoles(user: Pick<User, "id" | "role">): Promise<string[]> {
  const userRoles = await prisma.userRole.findMany({ where: { userId: user.id } });
  return effectiveRoles(user, userRoles.map((r) => r.role));
}

// 查詢使用者目前是否擁有指定能力（DB 版本）
export async function getUserHasCapability(user: Pick<User, "id" | "role">, capability: Capability): Promise<boolean> {
  const roles = await getUserEffectiveRoles(user);
  return unionCapabilities(roles).has(capability);
}

// Server-side 強制檢查（DB 版本）：deny-by-default，未擁有能力時拋出 PermissionDeniedError
export async function requireCapability(user: Pick<User, "id" | "role">, capability: Capability): Promise<void> {
  const allowed = await getUserHasCapability(user, capability);
  if (!allowed) {
    throw new PermissionDeniedError(capability);
  }
}

// 查詢使用者在指定團隊的成員身分（DB 版本）
export async function getTeamMembershipRole(
  teamId: string,
  userId: string,
): Promise<TeamMembershipRoleValue | null> {
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId, isActive: true },
  });
  return membership ? (membership.membershipRole as TeamMembershipRoleValue) : null;
}

export async function isUserTeamMember(teamId: string, userId: string): Promise<boolean> {
  return (await getTeamMembershipRole(teamId, userId)) !== null;
}

export async function isUserTeamLead(teamId: string, userId: string): Promise<boolean> {
  return (await getTeamMembershipRole(teamId, userId)) === "LEAD";
}
