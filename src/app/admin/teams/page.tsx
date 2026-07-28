import { requireCurrentUser } from "@/lib/auth";
import { listTeamsForActor } from "@/lib/peopleService";
import { getUserHasCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import TeamTable, { type TeamRow } from "@/components/teams/TeamTable";
import CreateTeamDrawer from "@/components/teams/CreateTeamDrawer";

export const dynamic = "force-dynamic";

// M1.5-C1-C 新增：Team 清單頁。可見範圍完全由 listTeamsForActor（C1-B row-level 查詢）
// 決定，本頁只做批次補充查詢（成員數／LEAD／對應系統），不重新拼接授權條件。
export default async function TeamsPage() {
  const actor = await requireCurrentUser();
  const [teams, isAdmin] = await Promise.all([listTeamsForActor(actor.id), getUserHasCapability(actor, "admin.full")]);
  const teamIds = teams.map((t) => t.id);

  const [members, systemMappings] = await Promise.all([
    teamIds.length > 0
      ? prisma.teamMember.findMany({ where: { teamId: { in: teamIds }, isActive: true }, include: { user: true } })
      : Promise.resolve([]),
    teamIds.length > 0
      ? prisma.systemTeamMapping.findMany({ where: { teamId: { in: teamIds }, isActive: true }, include: { system: true } })
      : Promise.resolve([]),
  ]);

  const rows: TeamRow[] = teams.map((t) => {
    const teamMembers = members.filter((m) => m.teamId === t.id);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      memberCount: teamMembers.length,
      leadNames: teamMembers.filter((m) => m.membershipRole === "LEAD").map((m) => m.user.name),
      systemNames: systemMappings.filter((s) => s.teamId === t.id).map((s) => s.system.name),
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">團隊管理</h1>
          <p className="mt-0.5 text-sm text-gray-500">共 {rows.length} 筆。團隊成員與 LEAD 異動皆會寫入 Audit Log。</p>
        </div>
        {isAdmin && <CreateTeamDrawer />}
      </div>

      <TeamTable teams={rows} />
    </div>
  );
}
