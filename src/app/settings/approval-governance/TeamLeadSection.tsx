import { prisma } from "@/lib/prisma";
import type { GovernanceAccessContext } from "@/lib/permissions";
import { TeamLeadManagePanel } from "@/components/TeamLeadPanel";

// M1.5-B2：Team／成員／LEAD 列表。可見範圍（哪些 Team）完全依賴 page.tsx 傳入、由
// resolveGovernanceAccessContext（M1.5-B1 permissions.ts）現場解析出的 ctx.memberTeamIds／
// canViewAllGovernance，本檔案只做展示，不重新判斷授權範圍。設定/移除 LEAD 的實際規則
// （目標必須是啟用中成員、reasonCode 必填…）一律由 teamLeadService.ts／
// approvalGovernanceActions.ts 檢查。
export default async function TeamLeadSection({ actorId, ctx }: { actorId: string; ctx: GovernanceAccessContext }) {
  void actorId; // 目前列表資料完全來自 ctx 授權範圍 + 直接查詢，未額外呼叫需要 actorId 的服務

  const teamWhere = ctx.canViewAllGovernance ? {} : { id: { in: ctx.memberTeamIds } };
  const teams = await prisma.team.findMany({ where: teamWhere, orderBy: { name: "asc" } });
  const teamIds = teams.map((t) => t.id);

  const [members, users, systemMappings] = await Promise.all([
    prisma.teamMember.findMany({ where: { teamId: { in: teamIds } } }),
    prisma.user.findMany(),
    prisma.systemTeamMapping.findMany({ where: { teamId: { in: teamIds }, isActive: true }, include: { system: true } }),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const systemsByTeam = new Map<string, string[]>();
  for (const m of systemMappings) {
    const arr = systemsByTeam.get(m.teamId) ?? [];
    arr.push(m.system.name);
    systemsByTeam.set(m.teamId, arr);
  }

  return (
    <div className="space-y-6">
      {teams.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">沒有可顯示的 Team。</p>
      ) : (
        teams.map((team) => {
          const teamMembers = members.filter((m) => m.teamId === team.id);
          const leadCount = teamMembers.filter((m) => m.isActive && m.membershipRole === "LEAD").length;

          return (
            <div key={team.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
                <h3 className="text-sm font-semibold text-gray-900">{team.name}</h3>
                <p className="text-xs text-gray-500">
                  對應 System：{systemsByTeam.get(team.id)?.join("、") || "無"} ｜ 有效 LEAD 數量：{leadCount}
                  {leadCount === 0 && <span className="ml-1 text-warning-text">（無有效 LEAD）</span>}
                </p>
              </div>
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500">
                    <th className="px-3 py-2">成員</th>
                    <th className="px-3 py-2">membershipRole</th>
                    <th className="px-3 py-2">是否有效</th>
                    {ctx.canManageTeamLeads && <th className="px-3 py-2">操作</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {teamMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-800">{userMap.get(m.userId)?.name ?? m.userId}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.membershipRole}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.isActive ? "有效" : "停用"}</td>
                      {ctx.canManageTeamLeads && (
                        <td className="px-3 py-2">
                          {m.isActive && (
                            <TeamLeadManagePanel
                              teamId={team.id}
                              userId={m.userId}
                              userName={userMap.get(m.userId)?.name ?? m.userId}
                              currentRole={m.membershipRole}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {teamMembers.length === 0 && (
                    <tr>
                      <td colSpan={ctx.canManageTeamLeads ? 4 : 3} className="px-3 py-4 text-center text-xs text-gray-400">
                        無成員
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}
