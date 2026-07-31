import { requireCurrentUser } from "@/lib/auth";
import { listPeopleForActor, hasPeopleCapability, resolveMemberManagementScope } from "@/lib/peopleService";
import { prisma } from "@/lib/prisma";
import PeopleFilters from "@/components/people/PeopleFilters";
import PeopleTable, { type PersonRow } from "@/components/people/PeopleTable";
import CreatePersonDrawer from "@/components/people/CreatePersonDrawer";

export const dynamic = "force-dynamic";

// M1.5-C1-C 新增：人員清單頁。
//
// 可見範圍完全由 listPeopleForActor（C1-B row-level 查詢）決定——Admin／資安推動小組
// 看得到全部，Team LEAD 只看得到自己所屬 Team 的成員，一般使用者只看得到自己。本頁
// 不重新拼接任何 row-level 條件；下方僅對「已經在授權範圍內」的清單做一般屬性篩選
// （關鍵字／角色／狀態／Team），並以兩個批次查詢（UserRole／TeamMember，皆已 scope
// 在授權範圍內的 userId 集合）組出清單所需的角色摘要與 Team 摘要，避免逐列 N+1。
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: { q?: string; role?: string; active?: string; team?: string };
}) {
  const actor = await requireCurrentUser();
  const people = await listPeopleForActor(actor.id);
  const ids = people.map((p) => p.id);

  const [activeRoleRows, membershipRows, teamRows, canCreate, managementScope] = await Promise.all([
    ids.length > 0 ? prisma.userRole.findMany({ where: { userId: { in: ids }, isActive: true } }) : Promise.resolve([]),
    ids.length > 0 ? prisma.teamMember.findMany({ where: { userId: { in: ids }, isActive: true } }) : Promise.resolve([]),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
    hasPeopleCapability(actor.id, "user.create"),
    resolveMemberManagementScope(actor.id),
  ]);

  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name] as const));
  const activeRolesByUser = new Map<string, string[]>();
  for (const r of activeRoleRows) {
    const arr = activeRolesByUser.get(r.userId) ?? [];
    arr.push(r.role);
    activeRolesByUser.set(r.userId, arr);
  }
  const teamIdsByUser = new Map<string, string[]>();
  for (const m of membershipRows) {
    const arr = teamIdsByUser.get(m.userId) ?? [];
    arr.push(m.teamId);
    teamIdsByUser.set(m.userId, arr);
  }

  let rows: PersonRow[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    primaryRole: p.role,
    activeRoles: activeRolesByUser.get(p.id) ?? [],
    isActive: p.isActive,
    teamNames: (teamIdsByUser.get(p.id) ?? []).map((tid) => teamNameById.get(tid) ?? tid),
    updatedAt: p.updatedAt.toISOString(),
  }));

  const q = searchParams.q?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
  if (searchParams.role) rows = rows.filter((r) => r.primaryRole === searchParams.role);
  if (searchParams.active === "1") rows = rows.filter((r) => r.isActive);
  if (searchParams.active === "0") rows = rows.filter((r) => !r.isActive);
  if (searchParams.team) {
    const teamName = teamNameById.get(searchParams.team);
    rows = rows.filter((r) => (teamName ? r.teamNames.includes(teamName) : false));
  }
  const visibleTeamIds = new Set(membershipRows.map((membership) => membership.teamId));
  const filterTeams = teamRows.filter((team) => visibleTeamIds.has(team.id));
  const creatableTeams = teamRows.filter(
    (team) => team.isActive && (managementScope.canManageAllTeams || managementScope.ledTeamIds.includes(team.id)),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">人員管理</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            共 {rows.length} 筆（可見範圍 {people.length} 筆）。所有角色與帳號狀態異動皆會寫入 Audit Log。
          </p>
        </div>
        {canCreate && creatableTeams.length > 0 && <CreatePersonDrawer teamOptions={creatableTeams.map((team) => ({ id: team.id, name: team.name }))} />}
      </div>

      <PeopleFilters teamOptions={filterTeams.map((team) => ({ id: team.id, name: team.name }))} />

      <PeopleTable people={rows} />
    </div>
  );
}
