import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getTeamDetailForActor, hasPeopleCapability, PeopleAccessDeniedError } from "@/lib/peopleService";
import { resolveGovernanceAccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import TeamMemberTable, { type TeamMemberRow } from "@/components/teams/TeamMemberTable";
import { AddTeamMemberDrawer } from "@/components/teams/TeamMemberManager";

export const dynamic = "force-dynamic";

// M1.5-C1-C 新增：Team 明細頁。
//
// 可見範圍由 getTeamDetailForActor 決定，查不到／被拒絕一律 notFound()。
// MEMBER 新增／移除（team.manageMembers，People 領域）與 LEAD 指派／移除
// （governance.manageTeamLeads，治理領域）是兩種不同的 Capability 來源，各自解析、
// 各自傳入 TeamMemberTable，不混用、不由本頁重新判斷規則。
export default async function TeamDetailPage({ params }: { params: { teamId: string } }) {
  const actor = await requireCurrentUser();

  let team;
  try {
    team = await getTeamDetailForActor(actor.id, params.teamId);
  } catch (err) {
    if (err instanceof PeopleAccessDeniedError) notFound();
    throw err;
  }
  if (!team) notFound();

  const [members, systemMappings, canManageMembers, govCtx] = await Promise.all([
    prisma.teamMember.findMany({ where: { teamId: team.id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    prisma.systemTeamMapping.findMany({ where: { teamId: team.id, isActive: true }, include: { system: true } }),
    hasPeopleCapability(actor.id, "team.manageMembers"),
    resolveGovernanceAccessContext(actor.id),
  ]);

  const memberRows: TeamMemberRow[] = members.map((m) => ({
    id: m.id,
    userId: m.userId,
    userName: m.user.name,
    userEmail: m.user.email,
    membershipRole: m.membershipRole,
    isActive: m.isActive,
  }));

  let candidates: { id: string; name: string; email: string }[] = [];
  if (canManageMembers) {
    const memberUserIds = new Set(members.filter((m) => m.isActive).map((m) => m.userId));
    const activeUsers = await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    candidates = activeUsers.filter((u) => !memberUserIds.has(u.id)).map((u) => ({ id: u.id, name: u.name, email: u.email }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{team.name}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {team.description || "無說明"}
            {systemMappings.length > 0 && <> ｜ 對應系統：{systemMappings.map((s) => s.system.name).join("、")}</>}
          </p>
        </div>
        {canManageMembers && <AddTeamMemberDrawer teamId={team.id} candidates={candidates} />}
      </div>

      <TeamMemberTable
        teamId={team.id}
        members={memberRows}
        canManageMembers={canManageMembers}
        canManageLeads={govCtx.canManageTeamLeads}
      />
    </div>
  );
}
