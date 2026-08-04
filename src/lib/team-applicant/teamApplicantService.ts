// 建立工單／團隊整合修正新增：「團隊名稱」→「申請人」連動選擇的服務層。
//
// 成員管理權限收斂更新：Team.isActive 已新增（migration 20260729120000_add_team_is_active），
// 上一輪記載的「無法表示已停用團隊」缺口已補上——本檔案的團隊選項與 assertActorCanUseTeam
// 一律過濾 isActive=true，停用中的團隊不得再被選為新工單的所屬團隊（既有工單不受影響）。
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
  // 停用中的團隊不得再被選為新工單的所屬團隊（既有工單不受影響）。
  if (await actorIsAdmin(actorId)) {
    const teams = await prisma.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    return teams.map((t) => ({ id: t.id, name: t.name }));
  }
  const memberships = await prisma.teamMember.findMany({ where: { userId: actorId, isActive: true }, select: { teamId: true } });
  const teamIds = memberships.map((m) => m.teamId);
  if (teamIds.length === 0) return [];
  const teams = await prisma.team.findMany({ where: { id: { in: teamIds }, isActive: true }, orderBy: { name: "asc" } });
  return teams.map((t) => ({ id: t.id, name: t.name }));
}

// 唯讀檢查：actorId 是否有權以 teamId 建立工單（Admin 一律可，非 Admin 須為該團隊 active 成員）。
// 不接受呼叫端傳入的「我是 Admin」等宣稱，一律現場查 DB。
export async function assertActorCanUseTeam(actorId: string, teamId: string): Promise<void> {
  // 檢查順序刻意維持既有語意：非 Admin 一律先判斷成員資格，因此偽造（不存在或無關的）
  // teamId 對非 Admin 一律回報「無權使用此團隊」，不透露該團隊是否存在。
  if (await actorIsAdmin(actorId)) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new TeamApplicantValidationError("所選團隊不存在");
    if (!team.isActive) throw new TeamApplicantValidationError("所選團隊已停用，無法以此團隊建立工單");
    return;
  }

  const membership = await prisma.teamMember.findFirst({ where: { teamId, userId: actorId, isActive: true } });
  if (!membership) throw new TeamApplicantAccessDeniedError("您不是此團隊的有效成員，無權以此團隊建立工單");

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new TeamApplicantValidationError("所選團隊不存在");
  if (!team.isActive) throw new TeamApplicantValidationError("所選團隊已停用，無法以此團隊建立工單");
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
