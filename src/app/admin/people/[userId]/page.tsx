import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getPersonDetailForActor, hasPeopleCapability, PeopleAccessDeniedError } from "@/lib/peopleService";
import { prisma } from "@/lib/prisma";
import PersonSummary from "@/components/people/PersonSummary";
import PersonProfileForm from "@/components/people/PersonProfileForm";
import PersonRoleManager from "@/components/people/PersonRoleManager";
import PersonStatusManager from "@/components/people/PersonStatusManager";
import AuditLogList from "@/components/AuditLogList";

export const dynamic = "force-dynamic";

// M1.5-C1-C 新增：人員明細頁。
//
// 可見範圍由 getPersonDetailForActor 決定（row-level）；查不到或被拒絕一律 notFound()，
// 不額外洩漏「存在但無權限」與「根本不存在」的差異。各操作區塊是否可互動（能不能編輯
// Profile／指派角色／啟停用）由 hasPeopleCapability 唯讀查詢決定，僅供決定要不要顯示
// 控制項——實際授權仍由各 Server Action 呼叫的服務層重新檢查。
export default async function PersonDetailPage({ params }: { params: { userId: string } }) {
  const actor = await requireCurrentUser();

  let person;
  try {
    person = await getPersonDetailForActor(actor.id, params.userId);
  } catch (err) {
    if (err instanceof PeopleAccessDeniedError) notFound();
    throw err;
  }
  if (!person) notFound();

  const userRoles = await prisma.userRole.findMany({ where: { userId: person.id }, orderBy: { createdAt: "asc" } });
  const userRoleIds = userRoles.map((r) => r.id);

  const [memberships, auditLogRows, canUpdate, canAssignRole, canRemoveRole, canActivate, canDeactivate] = await Promise.all([
    prisma.teamMember.findMany({ where: { userId: person.id }, include: { team: true }, orderBy: { createdAt: "asc" } }),
    prisma.auditLog.findMany({
      where: { OR: [{ entityType: "User", entityId: person.id }, { entityType: "UserRole", entityId: { in: userRoleIds } }] },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: true },
    }),
    hasPeopleCapability(actor.id, "user.update"),
    hasPeopleCapability(actor.id, "user.assignRole"),
    hasPeopleCapability(actor.id, "user.removeRole"),
    hasPeopleCapability(actor.id, "user.activate"),
    hasPeopleCapability(actor.id, "user.deactivate"),
  ]);

  const activeRoles = userRoles.filter((r) => r.isActive).map((r) => r.role);
  const teamBadges = memberships
    .filter((m) => m.isActive)
    .map((m) => ({ teamId: m.teamId, teamName: m.team.name, membershipRole: m.membershipRole, isActive: m.isActive }));

  const auditItems = auditLogRows.map((log) => ({
    id: log.id,
    actionType: log.actionType,
    summary: log.summary,
    actorRole: log.actor?.role ?? "系統",
    actorName: log.actor?.name ?? "系統",
    createdAt: log.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">人員明細</h1>
        <p className="mt-0.5 text-sm text-gray-500">所有角色、帳號狀態與 Team 成員異動皆會寫入 Audit Log。</p>
      </div>

      <PersonSummary
        person={{
          name: person.name,
          email: person.email,
          department: person.department,
          loginIdentifier: person.loginIdentifier,
          role: person.role,
          isActive: person.isActive,
          isBreakGlassAdmin: person.isBreakGlassAdmin,
        }}
        activeRoles={activeRoles}
        teamBadges={teamBadges}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {canUpdate && (
          <PersonProfileForm
            userId={person.id}
            initialName={person.name}
            initialDepartment={person.department}
            initialLoginIdentifier={person.loginIdentifier}
          />
        )}

        {(person.isActive ? canDeactivate : canActivate) && (
          <PersonStatusManager userId={person.id} isActive={person.isActive} />
        )}
      </div>

      {(canAssignRole || canRemoveRole || userRoles.length > 0) && (
        <PersonRoleManager
          userId={person.id}
          primaryRole={person.role}
          roles={userRoles.map((r) => ({ id: r.id, role: r.role, isActive: r.isActive }))}
          canAssignRole={canAssignRole}
          canRemoveRole={canRemoveRole}
        />
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">近期歷程</h3>
        <AuditLogList logs={auditItems} />
      </div>
    </div>
  );
}
