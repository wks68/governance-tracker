// 建立工單／團隊整合修正新增：「團隊名稱」→「申請人」連動選擇的服務層。
//
// 重要限制（見本輪最終報告「資料模型缺口」章節）：Team model 目前沒有 isActive／停用欄位，
// 本輪不新增 Schema／Migration，因此本檔案將「目前存在的 Team」一律視為可選（無法表示
// 「已停用團隊」這個狀態）。若日後補上 Team.isActive，僅需在 listAllTeamsAsOptions 與
// assertActorCanUseTeam 內加上 where: { isActive: true } 過濾，其餘呼叫端不需變動。
//
// 「有權建立工單的團隊」定義（無既有 Schema 可表示更細的授權設定，採最貼近既有資料模型的
// 解釋）：Admin（active UserRole 的 admin.full 能力）可選任何團隊；非 Admin 僅能選自己目前
// 是 active 成員（MEMBER 或 LEAD 皆可）的團隊。

import { prisma } from "../prisma";
import { getUserHasCapability } from "../permissions";
import { roleLabel } from "../constants";

export class TeamApplicantAccessDeniedError extends Error {
  constructor(message = "沒有權限使用此團隊建立工單") {
    super(message);
    this.name = "TeamApplicantAccessDeniedError";
  }
}

export class TeamApplicantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamApplicantValidationError";
  }
}

export interface TeamOption {
  id: string;
  name: string;
}

export interface ApplicantOption {
  id: string;
  name: string;
  roleLabel: string;
}

async function actorIsAdmin(actorId: string): Promise<boolean> {
  return getUserHasCapability({ id: actorId }, "admin.full");
}

// 供建立工單頁「團隊名稱」下拉選單使用：Admin 看全部團隊，非 Admin 只看自己 active 成員的團隊。
export async function listCreatableTeamsForActor(actorId: string): Promise<TeamOption[]> {
  if (await actorIsAdmin(actorId)) {
    const teams = await prisma.team.findMany({ orderBy: { name: "asc" } });
    return teams.map((t) => ({ id: t.id, name: t.name }));
  }
  const memberships = await prisma.teamMember.findMany({ where: { userId: actorId, isActive: true }, select: { teamId: true } });
  const teamIds = memberships.map((m) => m.teamId);
  if (teamIds.length === 0) return [];
  const teams = await prisma.team.findMany({ where: { id: { in: teamIds } }, orderBy: { name: "asc" } });
  return teams.map((t) => ({ id: t.id, name: t.name }));
}

// 唯讀檢查：actorId 是否有權以 teamId 建立工單（Admin 一律可，非 Admin 須為該團隊 active 成員）。
// 不接受呼叫端傳入的「我是 Admin」等宣稱，一律現場查 DB。
export async function assertActorCanUseTeam(actorId: string, teamId: string): Promise<void> {
  if (await actorIsAdmin(actorId)) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new TeamApplicantValidationError("所選團隊不存在");
    return;
  }
  const membership = await prisma.teamMember.findFirst({ where: { teamId, userId: actorId, isActive: true } });
  if (!membership) throw new TeamApplicantAccessDeniedError("您不是此團隊的有效成員，無權以此團隊建立工單");
}

// 供建立工單頁「申請人」下拉選單使用：選定團隊後，只列出該團隊目前 active 的成員
// （active TeamMember + active User），不得回傳其他團隊成員／已停用成員／已停用帳號。
// 呼叫前一律先驗證 actor 有權使用此團隊，避免非授權使用者探測其他團隊成員名單。
export async function listActiveApplicantsForTeam(actorId: string, teamId: string): Promise<ApplicantOption[]> {
  await assertActorCanUseTeam(actorId, teamId);
  const members = await prisma.teamMember.findMany({
    where: { teamId, isActive: true, user: { isActive: true } },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
  return members.map((m) => ({ id: m.user.id, name: m.user.name, roleLabel: roleLabel(m.user.role) }));
}

// 寫入時（建立工單／暫存／正式送簽／Admin 改派）一律重新驗證，不信任前端傳入的下拉選單結果：
// applicantId 必須是 active User 且是 teamId 目前 active 的成員。
export async function assertValidApplicantForTeam(teamId: string, applicantId: string) {
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId: applicantId, isActive: true, user: { isActive: true } },
    include: { user: true },
  });
  if (!membership) {
    throw new TeamApplicantValidationError("所選申請人不是所選團隊目前的有效成員，請重新選擇");
  }
  return membership.user;
}
