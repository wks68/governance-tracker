// 成員管理權限收斂新增：團隊主管（TEAM_LEAD 授權來源）在自己團隊範圍內的額外限制。
//
// 這裡集中定義「即使是自己團隊的主管，也一律不得做的事」，供各 People 服務在取得
// TEAM_LEAD 授權後統一套用，不得由各服務各自寫一份。Admin（CAPABILITY 授權來源）
// 不受本檔案限制——跨團隊管理是 Admin 的正式權限。

import type { Prisma, PrismaClient } from "@prisma/client";
import type { RoleKey } from "../constants";
import { PeopleAccessDeniedError, PeopleStateError } from "./types";

type Client = PrismaClient | Prisma.TransactionClient;

/** 團隊主管一律不得授予或指派的系統角色（不得把成員提升為 Admin）。 */
export function assertLeadMayUseRole(role: RoleKey): void {
  if (role === "Admin") {
    throw new PeopleAccessDeniedError("團隊主管不得授予或指派 Admin 角色");
  }
}

/** 團隊主管不得對自己執行的操作（停用、移除 membership、變更自己的角色等）。 */
export function assertLeadTargetIsNotSelf(actorId: string, targetUserId: string, action: string): void {
  if (actorId === targetUserId) {
    throw new PeopleAccessDeniedError(`團隊主管不得對自己執行「${action}」，請改由最高權限管理員處理`);
  }
}

/** 目標必須是該團隊目前的啟用中成員；否則團隊主管無權管理（含偽造其他 teamId 的請求）。 */
export async function assertLeadTargetInTeam(
  client: Client,
  teamId: string,
  targetUserId: string,
): Promise<void> {
  const membership = await client.teamMember.findFirst({
    where: { teamId, userId: targetUserId, isActive: true },
  });
  if (!membership) {
    throw new PeopleAccessDeniedError("團隊主管只能管理自己團隊目前的啟用中成員");
  }
}

/** 團隊主管不得管理同團隊的其他主管（LEAD 異動一律由最高權限管理員處理）。 */
export async function assertLeadTargetIsNotAnotherLead(
  client: Client,
  teamId: string,
  targetUserId: string,
): Promise<void> {
  const membership = await client.teamMember.findFirst({
    where: { teamId, userId: targetUserId, isActive: true },
  });
  if (membership?.membershipRole === "LEAD") {
    throw new PeopleAccessDeniedError("團隊主管不得管理其他團隊主管，請改由最高權限管理員處理");
  }
}

/**
 * 移除／停用後不得讓團隊沒有主管。
 *
 * 由呼叫端在「即將讓 targetUserId 失去該團隊 active membership」之前呼叫。
 */
export async function assertTeamKeepsAtLeastOneLead(
  client: Client,
  teamId: string,
  losingUserId: string,
): Promise<void> {
  const remainingLeads = await client.teamMember.count({
    where: { teamId, isActive: true, membershipRole: "LEAD", userId: { not: losingUserId } },
  });
  if (remainingLeads === 0) {
    const isLead = await client.teamMember.findFirst({
      where: { teamId, userId: losingUserId, isActive: true, membershipRole: "LEAD" },
    });
    if (isLead) {
      throw new PeopleStateError("此操作會讓團隊沒有任何啟用中主管，不得執行");
    }
  }
}
