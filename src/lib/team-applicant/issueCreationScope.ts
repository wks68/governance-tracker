// 建立工單頁權限收斂新增：依「目前登入者的正式身分」決定他能以哪個團隊、代表哪位申請人
// 建立工單。這是團隊／申請人授權的單一信任邊界——建立、暫存、草稿編輯與申請人下拉查詢
// 全部走本檔案，不得各自實作一套。
//
// 身分一律由正式資料現場推導，不得使用 User.role（那是顯示用的舊欄位，不是授權來源）：
//   - Admin：具 active UserRole 且該角色具備 admin.full 能力。
//   - 團隊主管：該團隊 active TeamMember 且 membershipRole=LEAD。
//   - 一般成員：active User＋active UserRole＋active TeamMember，但不是任何團隊的 active
//     LEAD，也沒有 active Admin 能力。
//
// 前端傳入的 isAdmin／isLead／role／teamId／applicantId 一律不採信：畫面上算出來的 scope
// 只決定「要不要顯示下拉選單」，實際寫入時一律再呼叫 assertCreationTeamAndApplicant
// 重新推導一次，偽造請求 fail closed。

import { prisma } from "../prisma";
import { getUserHasCapability } from "../permissions";
import { roleLabel } from "../constants";
import { TeamApplicantAccessDeniedError, TeamApplicantValidationError, type TeamOption, type ApplicantOption } from "./teamApplicantService";
import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CreationScopeKind = "ADMIN" | "TEAM_LEAD" | "MEMBER" | "NONE";

export interface IssueCreationScope {
  kind: CreationScopeKind;
  /** 此使用者可選用的團隊；MEMBER 與「只帶一個團隊的主管」為單一元素。 */
  teams: TeamOption[];
  /** 非 null 時團隊欄位唯讀（畫面不得提供切換）。 */
  fixedTeamId: string | null;
  /** 非 null 時申請人欄位唯讀（一般成員固定為本人）。 */
  fixedApplicant: ApplicantOption | null;
  /** 是否可從下拉選單挑選申請人（主管與 Admin 為 true）。 */
  canChooseApplicant: boolean;
  /** 畫面上的簡短說明文字。 */
  notice: string;
  /** 非 null 時完全不得建立工單，畫面只顯示此訊息。 */
  blockedReason: string | null;
}

const MULTI_TEAM_BLOCKED_MESSAGE = "目前帳號同時隸屬多個團隊，尚未設定主要申請團隊，請聯絡系統管理員確認。";
const NO_TEAM_BLOCKED_MESSAGE = "目前帳號尚未隸屬任何有效團隊，無法建立工單。請聯絡系統管理員確認團隊設定。";

const MEMBER_NOTICE = "團隊與申請人已依目前登入帳號自動帶入。";
const LEAD_NOTICE = "主管可代表自己團隊的成員建立工單。";
const ADMIN_NOTICE = "最高權限管理員可代表各團隊成員建立工單，實際建立者將另行保留於稽核紀錄。";

function emptyScope(kind: CreationScopeKind, blockedReason: string): IssueCreationScope {
  return { kind, teams: [], fixedTeamId: null, fixedApplicant: null, canChooseApplicant: false, notice: "", blockedReason };
}

async function actorIsAdmin(actorId: string, client: DbClient): Promise<boolean> {
  return getUserHasCapability({ id: actorId }, "admin.full", client);
}

// active TeamMember（含團隊本身仍 active）——已停用團隊不得再被選為新工單的所屬團隊。
async function activeMembershipsOf(actorId: string, client: DbClient) {
  return client.teamMember.findMany({
    where: { userId: actorId, isActive: true, team: { isActive: true } },
    include: { team: true },
    orderBy: { team: { name: "asc" } },
  });
}

async function applicantOptionFor(userId: string, client: DbClient): Promise<ApplicantOption | null> {
  const user = await client.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return null;
  return { id: user.id, name: user.name, roleLabel: roleLabel(user.role) };
}

// 供建立工單頁組裝畫面使用。只回報「可以怎麼選」，不是授權本身。
export async function resolveIssueCreationScope(
  actorId: string,
  client: DbClient = prisma,
): Promise<IssueCreationScope> {
  const actor = await client.user.findUnique({ where: { id: actorId } });
  if (!actor || !actor.isActive) return emptyScope("NONE", NO_TEAM_BLOCKED_MESSAGE);

  // 帳號必須至少有一個 active UserRole，才算是正式可建立工單的使用者。
  const activeRoles = await client.userRole.count({ where: { userId: actorId, isActive: true } });
  if (activeRoles === 0) return emptyScope("NONE", NO_TEAM_BLOCKED_MESSAGE);

  if (await actorIsAdmin(actorId, client)) {
    const teams = await client.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    return {
      kind: "ADMIN",
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      fixedTeamId: null,
      fixedApplicant: null,
      canChooseApplicant: true,
      notice: ADMIN_NOTICE,
      blockedReason: teams.length === 0 ? NO_TEAM_BLOCKED_MESSAGE : null,
    };
  }

  const memberships = await activeMembershipsOf(actorId, client);
  const leadMemberships = memberships.filter((m) => m.membershipRole === "LEAD");

  // 團隊主管：只能使用自己擔任 active LEAD 的團隊（即使他同時是別團隊的一般成員，
  // 也不得以那個團隊代建——代建權來自「主管身分」，不是「成員身分」）。
  if (leadMemberships.length > 0) {
    return {
      kind: "TEAM_LEAD",
      teams: leadMemberships.map((m) => ({ id: m.teamId, name: m.team.name })),
      fixedTeamId: leadMemberships.length === 1 ? leadMemberships[0].teamId : null,
      fixedApplicant: null,
      canChooseApplicant: true,
      notice: LEAD_NOTICE,
      blockedReason: null,
    };
  }

  // 一般成員：申請人固定為本人，團隊固定為自己唯一的正式團隊。
  if (memberships.length === 0) return emptyScope("MEMBER", NO_TEAM_BLOCKED_MESSAGE);
  // 現有資料模型沒有「主要申請團隊」欄位，多個團隊時不得任選第一筆，一律 fail closed。
  if (memberships.length > 1) return emptyScope("MEMBER", MULTI_TEAM_BLOCKED_MESSAGE);

  const self = await applicantOptionFor(actorId, client);
  if (!self) return emptyScope("MEMBER", NO_TEAM_BLOCKED_MESSAGE);

  return {
    kind: "MEMBER",
    teams: [{ id: memberships[0].teamId, name: memberships[0].team.name }],
    fixedTeamId: memberships[0].teamId,
    fixedApplicant: self,
    canChooseApplicant: false,
    notice: MEMBER_NOTICE,
    blockedReason: null,
  };
}

// 寫入時的信任邊界：建立／暫存／草稿編輯一律呼叫本函式，不接受前端傳入的任何身分宣稱。
// 回傳通過驗證的申請人 User，供呼叫端寫入 reporterUserId／reporter。
export async function resolveCreationTeamAndApplicant(
  actorId: string,
  teamId: string,
  applicantId: string,
  client: DbClient = prisma,
): Promise<{ teamId: string; applicant: Awaited<ReturnType<DbClient["user"]["findUniqueOrThrow"]>> }> {
  const scope = await resolveIssueCreationScope(actorId, client);
  if (scope.blockedReason) throw new TeamApplicantAccessDeniedError(scope.blockedReason);

  let effectiveTeamId = teamId;
  let effectiveApplicantId = applicantId;

  if (scope.kind === "MEMBER") {
    // 一般成員的正式值直接來自 server 現場解析的 scope。前端 hidden 欄位可以完全缺少；
    // 若有傳值則只作防偽造比對，不作為寫入來源。
    if (applicantId && applicantId !== actorId) {
      throw new TeamApplicantAccessDeniedError("您只能以自己的名義建立工單，無法代表其他人員送出。");
    }
    if (teamId && teamId !== scope.fixedTeamId) {
      throw new TeamApplicantAccessDeniedError("您只能以自己所屬的團隊建立工單，無法使用其他團隊。");
    }
    if (!scope.fixedTeamId || !scope.fixedApplicant) {
      throw new TeamApplicantAccessDeniedError(NO_TEAM_BLOCKED_MESSAGE);
    }
    effectiveTeamId = scope.fixedTeamId;
    effectiveApplicantId = scope.fixedApplicant.id;
  } else if (scope.kind === "TEAM_LEAD") {
    if (!teamId) throw new TeamApplicantValidationError("請選擇團隊名稱");
    if (!applicantId) throw new TeamApplicantValidationError("請選擇申請人");
    if (!scope.teams.some((t) => t.id === teamId)) {
      throw new TeamApplicantAccessDeniedError("您只能以自己擔任主管的團隊建立工單，無法使用其他團隊。");
    }
  } else if (scope.kind === "ADMIN") {
    if (!teamId) throw new TeamApplicantValidationError("請選擇團隊名稱");
    if (!applicantId) throw new TeamApplicantValidationError("請選擇申請人");
  } else {
    throw new TeamApplicantAccessDeniedError(NO_TEAM_BLOCKED_MESSAGE);
  }

  // 團隊必須存在且仍啟用（Admin 可跨團隊，但不得使用已停用團隊）。
  const team = await client.team.findUnique({ where: { id: effectiveTeamId } });
  if (!team) throw new TeamApplicantValidationError("所選團隊不存在");
  if (!team.isActive) throw new TeamApplicantValidationError("所選團隊已停用，無法以此團隊建立工單");

  // 申請人必須是該團隊目前的 active 成員（active TeamMember + active User）。
  const membership = await client.teamMember.findFirst({
    where: { teamId: effectiveTeamId, userId: effectiveApplicantId, isActive: true, user: { isActive: true } },
    include: { user: true },
  });
  if (!membership) {
    throw new TeamApplicantValidationError("所選申請人不是所選團隊目前的有效成員，請重新選擇");
  }
  return { teamId: effectiveTeamId, applicant: membership.user };
}

export async function assertCreationTeamAndApplicant(
  actorId: string,
  teamId: string,
  applicantId: string,
  client: DbClient = prisma,
) {
  const resolved = await resolveCreationTeamAndApplicant(actorId, teamId, applicantId, client);
  return resolved.applicant;
}

// 申請人下拉選單資料來源。一般成員不得透過此入口探測任何團隊的成員名單——他們的申請人
// 是固定的本人，畫面上根本沒有下拉選單。
export async function listSelectableApplicants(
  actorId: string,
  teamId: string,
  client: DbClient = prisma,
): Promise<ApplicantOption[]> {
  const scope = await resolveIssueCreationScope(actorId, client);
  if (scope.blockedReason) throw new TeamApplicantAccessDeniedError(scope.blockedReason);
  if (!scope.canChooseApplicant) {
    throw new TeamApplicantAccessDeniedError("您只能以自己的名義建立工單，無法選擇其他申請人。");
  }
  if (scope.kind === "TEAM_LEAD" && !scope.teams.some((t) => t.id === teamId)) {
    throw new TeamApplicantAccessDeniedError("您只能以自己擔任主管的團隊建立工單，無法使用其他團隊。");
  }
  const members = await client.teamMember.findMany({
    where: { teamId, isActive: true, user: { isActive: true }, team: { isActive: true } },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
  return members.map((m) => ({ id: m.user.id, name: m.user.name, roleLabel: roleLabel(m.user.role) }));
}
