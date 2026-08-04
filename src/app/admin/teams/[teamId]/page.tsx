import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getTeamDetailForActor, hasPeopleCapability, resolveMemberManagementScope, PeopleAccessDeniedError } from "@/lib/peopleService";
import { resolveGovernanceAccessContext, getUserHasCapability, getEffectiveSupervisor } from "@/lib/permissions";
import { isTeamDeletable } from "@/lib/team-applicant/teamManagementService";
import { ROLES, roleLabel } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import TeamMemberTable, { type TeamMemberRow } from "@/components/teams/TeamMemberTable";
import { AddTeamMemberDrawer } from "@/components/teams/TeamMemberManager";
import { CreateMemberDrawer, ManagedMemberTable, type ManagedMemberRow, type PanelContext } from "@/components/teams/MemberManagementPanel";
import EditTeamPanel from "@/components/teams/EditTeamPanel";

export const dynamic = "force-dynamic";

const DOMAIN_LABELS: Record<string, string> = {
  RD: "RD（研發）",
  QA: "QA（品管）",
  OP: "OP（維運）",
  BUSINESS: "BUSINESS（業務）",
  OTHER: "OTHER（其他）",
};

// M1.5-C1-C 新增：團隊明細頁。
//
// 可見範圍由 getTeamDetailForActor 決定，查不到／被拒絕一律 notFound()。
//
// 成員管理權限收斂更新：成員 CRUD 的可見性改由 resolveMemberManagementScope 解析
// （Admin 能力 或「本團隊」active LEAD）。不可管理者看到的是完全唯讀的成員清單，
// 不顯示任何新增／編輯／停用／移除按鈕；但隱藏按鈕不是授權機制——每個 Server Action
// 都會把 teamId 交回服務層重新驗證，偽造請求一律被拒。
//
// LEAD 指派／移除仍走既有治理領域能力（governance.manageTeamLeads，Admin only），
// 與成員 CRUD 是兩套不同來源，不混用。
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

  const [members, systemMappings, legacyCanManageMembers, govCtx, isAdmin, deletable, scope] = await Promise.all([
    prisma.teamMember.findMany({ where: { teamId: team.id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    prisma.systemTeamMapping.findMany({ where: { teamId: team.id, isActive: true }, include: { system: true } }),
    hasPeopleCapability(actor.id, "team.manageMembers"),
    resolveGovernanceAccessContext(actor.id),
    getUserHasCapability(actor, "admin.full"),
    isTeamDeletable(team.id),
    resolveMemberManagementScope(actor.id),
  ]);

  const canManageMembers = scope.canManageAllTeams || scope.ledTeamIds.includes(team.id);
  // 團隊主管範圍：非 Admin，但是本團隊的 active LEAD——表單需固定所屬團隊與直屬主管。
  const leadScoped = canManageMembers && !scope.canManageAllTeams;

  const memberUserIds = members.map((m) => m.userId);
  const supervisorAssignments =
    memberUserIds.length > 0
      ? await prisma.userSupervisorAssignment.findMany({ where: { userId: { in: memberUserIds } } })
      : [];
  const supervisorUserIds = [...new Set(supervisorAssignments.map((a) => a.supervisorUserId))];
  const supervisorUsers =
    supervisorUserIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: supervisorUserIds } } }) : [];
  const supervisorNameById = new Map(supervisorUsers.map((u) => [u.id, u.name]));

  const now = new Date();
  function currentSupervisorName(userId: string): string | null {
    const result = getEffectiveSupervisor(supervisorAssignments, userId, now);
    if (result.kind !== "resolved") return null;
    return supervisorNameById.get(result.assignment.supervisorUserId) ?? null;
  }

  const managedRows: ManagedMemberRow[] = members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    loginIdentifier: m.user.loginIdentifier,
    department: m.user.department,
    role: m.user.role,
    roleLabel: roleLabel(m.user.role),
    membershipRole: m.membershipRole,
    isActive: m.isActive && m.user.isActive,
    supervisorName: currentSupervisorName(m.userId),
  }));

  const leadNames = members.filter((m) => m.isActive && m.membershipRole === "LEAD").map((m) => m.user.name);

  // 直屬主管候選人：Admin 操作時列出所有 active 使用者；團隊主管操作時前端固定為自己，
  // 這份清單只是顯示用，實際限制由 setTeamMemberSupervisor 服務層強制。
  const supervisorOptions = scope.canManageAllTeams
    ? (await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })).map((u) => ({ id: u.id, name: u.name }))
    : [];

  const panelCtx: PanelContext = {
    teamId: team.id,
    teamName: team.name,
    leadScoped,
    actorId: actor.id,
    actorName: actor.name,
    // 團隊主管不得授予 Admin：選單不列出 Admin，服務層另有 assertLeadMayUseRole 強制。
    roleOptions: ROLES.filter((r) => scope.canManageAllTeams || r.key !== "Admin").map((r) => ({ key: r.key, label: r.label })),
    supervisorOptions,
  };

  const legacyMemberRows: TeamMemberRow[] = members.map((m) => ({
    id: m.id,
    userId: m.userId,
    userName: m.user.name,
    userEmail: m.user.email,
    membershipRole: m.membershipRole,
    isActive: m.isActive,
  }));

  let candidates: { id: string; name: string; email: string }[] = [];
  if (legacyCanManageMembers) {
    const activeMemberUserIds = new Set(members.filter((m) => m.isActive).map((m) => m.userId));
    const activeUsers = await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    candidates = activeUsers.filter((u) => !activeMemberUserIds.has(u.id)).map((u) => ({ id: u.id, name: u.name, email: u.email }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{team.name}</h1>
          <p className="mt-0.5 text-sm text-gray-500">{team.description || "無說明"}</p>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <div>
              <dt className="inline text-gray-500">團隊主管：</dt>
              <dd className="inline">{leadNames.length > 0 ? leadNames.join("、") : "（尚未設定主管）"}</dd>
            </div>
            <div>
              <dt className="inline text-gray-500">團隊領域：</dt>
              <dd className="inline">{team.domain ? DOMAIN_LABELS[team.domain] ?? team.domain : "（未分類）"}</dd>
            </div>
            <div>
              <dt className="inline text-gray-500">啟用狀態：</dt>
              <dd className="inline">{team.isActive ? "啟用" : "停用"}</dd>
            </div>
            <div>
              <dt className="inline text-gray-500">成員人數：</dt>
              <dd className="inline">{members.filter((m) => m.isActive).length}</dd>
            </div>
            {systemMappings.length > 0 && (
              <div>
                <dt className="inline text-gray-500">對應系統：</dt>
                <dd className="inline">{systemMappings.map((s) => s.system.name).join("、")}</dd>
              </div>
            )}
          </dl>
        </div>
        {canManageMembers && <CreateMemberDrawer ctx={panelCtx} />}
      </div>

      {isAdmin && <EditTeamPanel teamId={team.id} initialName={team.name} initialDescription={team.description} canDelete={deletable} isActive={team.isActive} />}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-800">
          成員清單
          {!canManageMembers && <span className="ml-2 text-xs font-normal text-gray-500">（唯讀：您不是此團隊的主管）</span>}
        </h2>
        <ManagedMemberTable ctx={panelCtx} members={managedRows} canManage={canManageMembers} />
      </div>

      {(legacyCanManageMembers || govCtx.canManageTeamLeads) && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-800">團隊身分與既有成員關係管理</h2>
          <p className="text-xs text-gray-500">
            將既有使用者加入本團隊，或調整團隊主管（LEAD）身分。主管身分異動僅限最高權限管理員。
          </p>
          <div className="flex justify-end">{legacyCanManageMembers && <AddTeamMemberDrawer teamId={team.id} candidates={candidates} />}</div>
          <TeamMemberTable
            teamId={team.id}
            members={legacyMemberRows}
            canManageMembers={legacyCanManageMembers}
            canManageLeads={govCtx.canManageTeamLeads}
          />
        </div>
      )}
    </div>
  );
}
