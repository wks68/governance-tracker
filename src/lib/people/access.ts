// C1-B3 新增：People 領域 Capability 檢查。
//
// 只包裝既有 src/lib/permissions.ts 的 requireCapability／getUserHasCapability，
// 不重建第二套權限判斷邏輯、不快取、不接受呼叫端傳入的旗標——一律以 actorId
// 現場（在呼叫端提供的 tx 內）重新解析。

import type { Prisma, PrismaClient } from "@prisma/client";
import { requireCapability, getUserHasCapability, type Capability } from "../permissions";
import { prisma } from "../prisma";
import { PeopleAccessDeniedError } from "./types";

type Client = PrismaClient | Prisma.TransactionClient;

// deny-by-default：actorId 不具備指定 Capability（含 actor 本身 inactive／不存在）時拋出
// PeopleAccessDeniedError，統一 People 領域對外的存取拒絕錯誤型別。
export async function requirePeopleCapability(
  actorId: string,
  capability: Capability,
  client: Client = prisma,
): Promise<void> {
  try {
    await requireCapability({ id: actorId }, capability, client);
  } catch {
    throw new PeopleAccessDeniedError(`僅具備 "${capability}" 能力者可執行此操作`);
  }
}

export async function hasPeopleCapability(actorId: string, capability: Capability, client: Client = prisma): Promise<boolean> {
  return getUserHasCapability({ id: actorId }, capability, client);
}

// ---------------------------------------------------------------------------
// 成員管理權限收斂新增：團隊主管（active TeamMember.membershipRole=LEAD）在「自己主管的
// 團隊」範圍內的人員管理授權。
//
// 這是第二種授權來源（範圍型），與既有的 Capability（角色型）並存但語意分離：
//   - CAPABILITY：Admin 依 active UserRole 取得的跨團隊能力。
//   - TEAM_LEAD ：僅限 teamScopeId 指定的那一個團隊，且只涵蓋下方白名單能力。
//
// 授權一律以 actorId 於呼叫當下（呼叫端提供的 tx 內）重新解析：active User ＋ active
// UserRole ＋ active TeamMember ＋ membershipRole=LEAD ＋ 實際 teamId，不接受呼叫端傳入
// 任何旗標，也不從 User.role 推導。前端隱藏按鈕不構成授權。
// ---------------------------------------------------------------------------

const TEAM_LEAD_SCOPED_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "user.view",
  "user.create",
  "user.update",
  "user.activate",
  "user.deactivate",
  "user.assignRole",
  "user.removeRole",
  "team.view",
  "team.manageMembers",
]);

// 刻意不列入白名單（團隊主管永遠不得取得，即使在自己團隊範圍內）：
//   admin.full／user.manageRoles       ：不得授予或提升 Admin。
//   team.manageDomain                  ：不得修改 Team.domain。
//   governance.*                       ：不得管理治理設定。
// 上述能力只能由 Capability 來源取得，走 requirePeopleCapability 既有路徑。

export type PeopleGrantKind = "CAPABILITY" | "TEAM_LEAD";

export async function resolveLedTeamIds(actorId: string, client: Client = prisma): Promise<string[]> {
  const actor = await client.user.findUnique({ where: { id: actorId } });
  if (!actor || !actor.isActive) return [];
  const memberships = await client.teamMember.findMany({
    where: { userId: actorId, isActive: true, membershipRole: "LEAD" },
  });
  return memberships.map((m) => m.teamId);
}

export async function isActiveLeadOfTeam(actorId: string, teamId: string, client: Client = prisma): Promise<boolean> {
  return (await resolveLedTeamIds(actorId, client)).includes(teamId);
}

/**
 * deny-by-default：允許時回傳授權來源，否則拋出 PeopleAccessDeniedError。
 *
 * teamScopeId 為 null 時完全等同既有的 requirePeopleCapability（純能力判斷）；
 * 有值時額外允許「該團隊目前 active LEAD」執行白名單內的能力。
 */
export async function requirePeopleCapabilityInTeamScope(
  actorId: string,
  capability: Capability,
  teamScopeId: string | null | undefined,
  client: Client = prisma,
): Promise<PeopleGrantKind> {
  if (await hasPeopleCapability(actorId, capability, client)) return "CAPABILITY";

  if (teamScopeId && TEAM_LEAD_SCOPED_CAPABILITIES.has(capability)) {
    if (await isActiveLeadOfTeam(actorId, teamScopeId, client)) return "TEAM_LEAD";
  }

  throw new PeopleAccessDeniedError(
    `僅具備 "${capability}" 能力者，或該團隊目前的啟用中主管，可執行此操作`,
  );
}
