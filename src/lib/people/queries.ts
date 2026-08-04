// C1-B5 新增：供 C1-C 使用的唯讀查詢 API（row-level authorization）。
//
// 一律只接受 actorId，範圍（是否可看全部／僅所屬 Team／僅自己）完全由服務內部依
// actorId 現場解析（user.view／team.view Capability ＋ 目前 active TeamMember 身分），
// 不接受呼叫端傳入 canViewAll／isAdmin／ledTeamIds／permittedUserIds 等旗標。
// 本檔案只執行讀取，不執行任何寫入。

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { hasPeopleCapability } from "./access";
import { PeopleAccessDeniedError } from "./types";

type Client = PrismaClient | Prisma.TransactionClient;

async function resolvePeopleViewScope(actorId: string, client: Client = prisma) {
  const canViewAll = await hasPeopleCapability(actorId, "user.view", client);
  const ledMemberships = await client.teamMember.findMany({
    where: { userId: actorId, isActive: true, membershipRole: "LEAD" },
  });
  return { canViewAll, ledTeamIds: ledMemberships.map((m) => m.teamId) };
}

// Admin／資安推動小組（user.view）：全部可見。Team LEAD：僅 ledTeamIds 範圍內的成員。
// 一般使用者：只看自己。
export async function listPeopleForActor(actorId: string) {
  const scope = await resolvePeopleViewScope(actorId);
  if (scope.canViewAll) {
    return prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  }
  if (scope.ledTeamIds.length > 0) {
    const memberships = await prisma.teamMember.findMany({
      where: { teamId: { in: scope.ledTeamIds }, isActive: true },
    });
    const userIds = [...new Set(memberships.map((m) => m.userId))];
    return prisma.user.findMany({ where: { id: { in: userIds } }, orderBy: { createdAt: "asc" } });
  }
  return prisma.user.findMany({ where: { id: actorId } });
}

export async function getPersonDetailForActor(actorId: string, targetUserId: string) {
  const scope = await resolvePeopleViewScope(actorId);
  if (scope.canViewAll || targetUserId === actorId) {
    return prisma.user.findUnique({ where: { id: targetUserId } });
  }
  if (scope.ledTeamIds.length > 0) {
    const membership = await prisma.teamMember.findFirst({
      where: { userId: targetUserId, teamId: { in: scope.ledTeamIds }, isActive: true },
    });
    if (membership) return prisma.user.findUnique({ where: { id: targetUserId } });
  }
  throw new PeopleAccessDeniedError("只能查看自己或所屬（LEAD）Team 範圍內的人員資料");
}

async function resolveTeamViewScope(actorId: string, client: Client = prisma) {
  const canViewAll = await hasPeopleCapability(actorId, "team.view", client);
  const memberships = await client.teamMember.findMany({ where: { userId: actorId, isActive: true } });
  return {
    canViewAll,
    memberTeamIds: memberships.map((m) => m.teamId),
  };
}

// Admin／資安推動小組（team.view）：全部可見。其餘（含 Team LEAD）：僅自己所屬 Team 範圍
// （不論 MEMBER 或 LEAD 身分）。Team LEAD 只能「查看」，不得經由本模組管理 TeamMember。
export async function listTeamsForActor(actorId: string) {
  const scope = await resolveTeamViewScope(actorId);
  if (scope.canViewAll) {
    return prisma.team.findMany({ orderBy: { createdAt: "asc" } });
  }
  if (scope.memberTeamIds.length === 0) return [];
  return prisma.team.findMany({ where: { id: { in: scope.memberTeamIds } }, orderBy: { createdAt: "asc" } });
}

export async function getTeamDetailForActor(actorId: string, teamId: string) {
  const scope = await resolveTeamViewScope(actorId);
  if (!scope.canViewAll && !scope.memberTeamIds.includes(teamId)) {
    throw new PeopleAccessDeniedError("只能查看自己所屬的 Team");
  }
  return prisma.team.findUnique({ where: { id: teamId } });
}
