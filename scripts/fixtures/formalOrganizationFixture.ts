// 正式組織測試資料 fixture（單一來源）。
//
// Preview seed（scripts/hotfix_ui_preview.ts）與各 targeted verify 一律共用本檔案定義的
// 同一份正式組織資料，不得各自硬編碼第二份團隊／人員清單。測試若需要特殊邊界案例的
// 臨時人員，請在各自的 scratch DB 內自行建立並於測試結束後清除，不得加入本 fixture、
// 不得寫入 Preview 正式組織資料。
//
// 設計原則：
//   - Team.domain 一律由本檔案明確宣告後透過正式服務層 setTeamDomain 寫入，
//     不依團隊名稱在 runtime 猜測。
//   - 主管（LEAD）與一般成員（MEMBER）分開宣告；未提供成員的團隊只建立主管，
//     不虛構任何一般成員。
//   - 直屬主管關係一律建立正式 UserSupervisorAssignment（active、isPrimary），
//     不依團隊 LEAD 身分 fallback 推導。
//   - seedFormalOrganization 必須冪等：重跑不得產生重複團隊、人員、membership 或主管指派。

import type { PrismaClient } from "@prisma/client";
import { setTeamDomain } from "../../src/lib/team-applicant/teamManagementService";
import type { RoleKey, TeamDomain, TeamMembershipRole } from "../../src/lib/constants";

// 本 fixture 建立的所有帳號統一使用此 email 網域，供 verify 判斷「屬於正式組織測試資料」。
export const FORMAL_ORG_EMAIL_DOMAIN = "formal-org.example.invalid";

export interface FormalTeamSpec {
  /** 團隊正式名稱（顯示與比對皆以此為準） */
  name: string;
  /** 明確宣告的 Team.domain，不得由名稱猜測 */
  domain: TeamDomain;
  description: string;
}

export interface FormalPersonSpec {
  /** 唯一測試識別值：同時作為 email local part 與 loginIdentifier */
  key: string;
  name: string;
  /** 系統角色：一律使用現有正式 RoleKey 值域，不新增 enum 值 */
  role: RoleKey;
  department: string;
  teamName: string;
  membershipRole: TeamMembershipRole;
  /** 正式直屬主管的 key；null 代表本輪未提供（不得虛構代理人） */
  supervisorKey: string | null;
}

// ---------------------------------------------------------------------------
// 一、七個正式團隊
// ---------------------------------------------------------------------------

export const FORMAL_TEAMS: FormalTeamSpec[] = [
  { name: "系統架構", domain: "OTHER", description: "系統架構規劃與技術治理" },
  { name: "品管", domain: "QA", description: "品質管理與驗證" },
  { name: "維運", domain: "OP", description: "系統維運與上版部署" },
  { name: "語音與AI技術", domain: "RD", description: "語音與人工智慧技術研發" },
  { name: "先進應用開發部", domain: "RD", description: "先進應用系統開發" },
  { name: "創新應用開發", domain: "RD", description: "創新應用系統開發" },
  { name: "解決方案部", domain: "RD", description: "整合解決方案開發" },
];

// ---------------------------------------------------------------------------
// 二、最高權限管理員
//
// 只在資料庫中「尚無任何具 active Admin UserRole 的使用者」時才建立；已存在時一律沿用
// 既有帳號，不建立第二位 Admin。
// ---------------------------------------------------------------------------

export const FORMAL_ADMIN: Omit<FormalPersonSpec, "teamName" | "membershipRole" | "supervisorKey"> = {
  key: "admin",
  name: "最高權限管理員",
  role: "Admin",
  department: "資訊處",
};

// ---------------------------------------------------------------------------
// 三、七位正式主管（每個團隊唯一 active LEAD）
//
// 系統架構主管 Alex：現有 RoleKey 值域中，唯一能支援系統技術人員的是 RD，因此使用 RD；
// 但「系統架構」團隊的 Team.domain 仍維持 OTHER——接單資格一律以 Team.domain 判斷，
// 不因主管個人的 RD 角色而讓系統架構團隊取得 RD 工單接單資格。
// ---------------------------------------------------------------------------

export const FORMAL_LEADS: FormalPersonSpec[] = [
  { key: "alex", name: "Alex", role: "RD", department: "系統架構", teamName: "系統架構", membershipRole: "LEAD", supervisorKey: null },
  { key: "aaron", name: "Aaron", role: "QA", department: "品管", teamName: "品管", membershipRole: "LEAD", supervisorKey: null },
  { key: "wallace", name: "Wallace", role: "OP", department: "維運", teamName: "維運", membershipRole: "LEAD", supervisorKey: null },
  { key: "tommy", name: "Tommy", role: "RD", department: "語音與AI技術", teamName: "語音與AI技術", membershipRole: "LEAD", supervisorKey: null },
  { key: "xutai", name: "序泰", role: "RD", department: "先進應用開發部", teamName: "先進應用開發部", membershipRole: "LEAD", supervisorKey: null },
  { key: "yonnve", name: "Yonnve", role: "RD", department: "創新應用開發", teamName: "創新應用開發", membershipRole: "LEAD", supervisorKey: null },
  { key: "kitty", name: "Kitty", role: "RD", department: "解決方案部", teamName: "解決方案部", membershipRole: "LEAD", supervisorKey: null },
];

// ---------------------------------------------------------------------------
// 四、正式一般成員（僅品管四位、維運兩位；其餘五個團隊本輪只有主管）
// ---------------------------------------------------------------------------

export const FORMAL_MEMBERS: FormalPersonSpec[] = [
  { key: "ken", name: "Ken", role: "QA", department: "品管", teamName: "品管", membershipRole: "MEMBER", supervisorKey: "aaron" },
  { key: "jonus", name: "Jonus", role: "QA", department: "品管", teamName: "品管", membershipRole: "MEMBER", supervisorKey: "aaron" },
  { key: "xiaoxin", name: "小新", role: "QA", department: "品管", teamName: "品管", membershipRole: "MEMBER", supervisorKey: "aaron" },
  { key: "selena", name: "Selena", role: "QA", department: "品管", teamName: "品管", membershipRole: "MEMBER", supervisorKey: "aaron" },
  { key: "min", name: "Min", role: "OP", department: "維運", teamName: "維運", membershipRole: "MEMBER", supervisorKey: "wallace" },
  { key: "howard", name: "Howard", role: "OP", department: "維運", teamName: "維運", membershipRole: "MEMBER", supervisorKey: "wallace" },
];

export const FORMAL_PEOPLE: FormalPersonSpec[] = [...FORMAL_LEADS, ...FORMAL_MEMBERS];

/** 本輪只有主管、沒有一般成員的團隊（不得虛構成員） */
export const TEAMS_WITHOUT_MEMBERS = FORMAL_TEAMS.filter(
  (t) => !FORMAL_MEMBERS.some((m) => m.teamName === t.name),
).map((t) => t.name);

export function formalEmail(key: string): string {
  return `${key}@${FORMAL_ORG_EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export interface FormalOrganizationResult {
  admin: { id: string; name: string; email: string };
  /** 團隊名稱 → id */
  teamIdByName: Map<string, string>;
  /** 人員 key → { id, name } */
  personByKey: Map<string, { id: string; name: string; teamName: string; role: RoleKey }>;
}

async function resolveOrCreateAdmin(client: PrismaClient) {
  // 既有最高權限管理員優先沿用（不得建立第二個 Admin）。
  const existingAdminRole = await client.userRole.findFirst({
    where: { role: "Admin", isActive: true, user: { isActive: true } },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  if (existingAdminRole) return existingAdminRole.user;

  const email = formalEmail(FORMAL_ADMIN.key);
  const existingByEmail = await client.user.findUnique({ where: { email } });
  const user =
    existingByEmail ??
    (await client.user.create({
      data: {
        name: FORMAL_ADMIN.name,
        email,
        loginIdentifier: FORMAL_ADMIN.key,
        department: FORMAL_ADMIN.department,
        role: "Admin",
        isActive: true,
      },
    }));

  const existingRole = await client.userRole.findUnique({ where: { userId_role: { userId: user.id, role: "Admin" } } });
  if (!existingRole) {
    await client.userRole.create({ data: { userId: user.id, role: "Admin", isActive: true } });
  } else if (!existingRole.isActive) {
    await client.userRole.update({ where: { id: existingRole.id }, data: { isActive: true } });
  }
  return user;
}

async function upsertTeam(client: PrismaClient, spec: FormalTeamSpec, adminId: string) {
  const existing = await client.team.findFirst({ where: { name: spec.name } });
  const team =
    existing ??
    (await client.team.create({ data: { name: spec.name, description: spec.description } }));

  // domain 一律透過正式服務層明確寫入（同值重設為 no-op，不重複寫 AuditLog）。
  await setTeamDomain({ teamId: team.id, domain: spec.domain, actorId: adminId, reasonCode: "FORMAL_ORG_FIXTURE" });
  return team;
}

async function upsertPerson(client: PrismaClient, spec: FormalPersonSpec) {
  const email = formalEmail(spec.key);
  const existing = await client.user.findUnique({ where: { email } });
  const user =
    existing ??
    (await client.user.create({
      data: {
        name: spec.name,
        email,
        loginIdentifier: spec.key,
        department: spec.department,
        role: spec.role,
        isActive: true,
      },
    }));

  const existingRole = await client.userRole.findUnique({ where: { userId_role: { userId: user.id, role: spec.role } } });
  if (!existingRole) {
    await client.userRole.create({ data: { userId: user.id, role: spec.role, isActive: true } });
  } else if (!existingRole.isActive) {
    await client.userRole.update({ where: { id: existingRole.id }, data: { isActive: true } });
  }
  return user;
}

async function upsertMembership(client: PrismaClient, teamId: string, userId: string, membershipRole: TeamMembershipRole) {
  const existing = await client.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (existing) {
    if (existing.isActive && existing.membershipRole === membershipRole) return existing;
    return client.teamMember.update({ where: { id: existing.id }, data: { isActive: true, membershipRole } });
  }
  return client.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
}

async function upsertSupervisorAssignment(client: PrismaClient, userId: string, supervisorUserId: string, createdByUserId: string) {
  if (userId === supervisorUserId) {
    throw new Error(`fixture 設定錯誤：不得將使用者設為自己的主管（userId=${userId}）`);
  }
  const existing = await client.userSupervisorAssignment.findFirst({
    where: { userId, supervisorUserId, isActive: true, isPrimary: true },
  });
  if (existing) return existing;
  return client.userSupervisorAssignment.create({
    data: {
      userId,
      supervisorUserId,
      validFrom: new Date(Date.now() - 86_400_000),
      isPrimary: true,
      isActive: true,
      createdByUserId,
    },
  });
}

/**
 * 冪等地建立（或補齊）正式組織測試資料。
 *
 * 只負責「正式組織」本身：團隊、Team.domain、最高權限管理員、七位主管、六位一般成員、
 * membership 與直屬主管關係。不建立任何工單，也不清除呼叫端自己建立的其他資料。
 */
export async function seedFormalOrganization(client: PrismaClient): Promise<FormalOrganizationResult> {
  const admin = await resolveOrCreateAdmin(client);

  const teamIdByName = new Map<string, string>();
  for (const spec of FORMAL_TEAMS) {
    const team = await upsertTeam(client, spec, admin.id);
    teamIdByName.set(spec.name, team.id);
  }

  const personByKey = new Map<string, { id: string; name: string; teamName: string; role: RoleKey }>();
  for (const spec of FORMAL_PEOPLE) {
    const user = await upsertPerson(client, spec);
    const teamId = teamIdByName.get(spec.teamName);
    if (!teamId) throw new Error(`fixture 設定錯誤：找不到團隊「${spec.teamName}」`);
    await upsertMembership(client, teamId, user.id, spec.membershipRole);
    personByKey.set(spec.key, { id: user.id, name: user.name, teamName: spec.teamName, role: spec.role });
  }

  for (const spec of FORMAL_PEOPLE) {
    if (!spec.supervisorKey) continue;
    const target = personByKey.get(spec.key);
    const supervisor = personByKey.get(spec.supervisorKey);
    if (!target || !supervisor) throw new Error(`fixture 設定錯誤：找不到主管關係對應人員（${spec.key} → ${spec.supervisorKey}）`);
    await upsertSupervisorAssignment(client, target.id, supervisor.id, admin.id);
  }

  return {
    admin: { id: admin.id, name: admin.name, email: admin.email },
    teamIdByName,
    personByKey,
  };
}
