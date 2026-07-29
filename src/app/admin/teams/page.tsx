import { requireCurrentUser } from "@/lib/auth";
import { listTeamsForActor, resolveMemberManagementScope } from "@/lib/peopleService";
import { getUserHasCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import TeamTable, { type TeamRow } from "@/components/teams/TeamTable";
import CreateTeamDrawer from "@/components/teams/CreateTeamDrawer";

export const dynamic = "force-dynamic";

// M1.5-C1-C 新增：團隊清單頁。可見範圍完全由 listTeamsForActor（C1-B row-level 查詢）
// 決定，本頁只做批次補充查詢（成員數／主管／領域／啟用狀態／對應系統），不重新拼接授權條件。
//
// 成員管理權限收斂更新：每一列額外標示目前登入者「能不能管理這個團隊的成員」，
// 由 resolveMemberManagementScope 現場解析（Admin 能力 或 該團隊 active LEAD），
// 不可管理者只顯示唯讀連結。這只影響畫面呈現——實際授權一律由服務層重新驗證。
const DOMAIN_LABELS: Record<string, string> = {
  RD: "RD（研發）",
  QA: "QA（品管）",
  OP: "OP（維運）",
  BUSINESS: "BUSINESS（業務）",
  OTHER: "OTHER（其他）",
};

export default async function TeamsPage() {
  const actor = await requireCurrentUser();
  const [teams, isAdmin, scope] = await Promise.all([
    listTeamsForActor(actor.id),
    getUserHasCapability(actor, "admin.full"),
    resolveMemberManagementScope(actor.id),
  ]);
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
      domainLabel: t.domain ? DOMAIN_LABELS[t.domain] ?? t.domain : "（未分類）",
      isActive: t.isActive,
      memberCount: teamMembers.length,
      leadNames: teamMembers.filter((m) => m.membershipRole === "LEAD").map((m) => m.user.name),
      systemNames: systemMappings.filter((s) => s.teamId === t.id).map((s) => s.system.name),
      canManage: scope.canManageAllTeams || scope.ledTeamIds.includes(t.id),
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">團隊管理</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            共 {rows.length} 個團隊。團隊成員與主管異動皆會寫入稽核紀錄。
            {!scope.canManageAllTeams && scope.ledTeamIds.length > 0 && "您只能管理自己擔任主管的團隊，其他團隊為唯讀。"}
          </p>
        </div>
        {isAdmin && <CreateTeamDrawer />}
      </div>

      <TeamTable teams={rows} />
    </div>
  );
}
