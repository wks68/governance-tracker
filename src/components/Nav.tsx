import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/constants";
import { listActionableTasksForActor } from "@/lib/workflowExecutionService";
import { getUserEffectiveRoles, hasCapability, resolveGovernanceAccessContext } from "@/lib/permissions";
import { resolveMemberManagementScope } from "@/lib/peopleService";
import { prisma } from "@/lib/prisma";
import AppShell from "./app-shell/AppShell";
import type { ReactNode } from "react";

export default async function Nav({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
            <span>
              <span className="block text-base font-bold text-text-primary">DMS WorkHub</span>
              <span className="block text-xs text-text-muted">DMS 工作管理平台</span>
            </span>
            <Link href="/login" className="text-sm font-semibold text-primary hover:text-primary-hover">
            登入
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </div>
    );
  }

  const [roles, managementScope, governanceAccess, supervisorCount] = await Promise.all([
    getUserEffectiveRoles(user),
    resolveMemberManagementScope(user.id),
    resolveGovernanceAccessContext(user.id),
    prisma.userSupervisorAssignment.count({
      where: {
        supervisorUserId: user.id,
        isActive: true,
        isPrimary: true,
        validFrom: { lte: new Date() },
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
    }),
  ]);
  const canUseWorkManagement = hasCapability(roles, "issue.view");
  const actionableTasks = canUseWorkManagement ? await listActionableTasksForActor(user.id) : [];
  const notificationTasks = actionableTasks.map((task) => ({
    issueId: task.issueId,
    issueKey: task.issueKey,
    title: task.title,
    actionLabel: task.actionLabel,
    actionHref: task.actionHref,
    currentStageLabel: task.currentStageLabel,
    enteredAt: task.enteredAt?.toISOString() ?? null,
  }));
  const canManagePeople =
    managementScope.ledTeamIds.length > 0 ||
    ["user.create", "user.update", "user.activate", "user.deactivate", "user.assignRole", "user.removeRole"].some(
      (capability) => hasCapability(roles, capability as Parameters<typeof hasCapability>[1]),
    );
  const canManageTeams =
    managementScope.canManageAllTeams ||
    managementScope.ledTeamIds.length > 0 ||
    hasCapability(roles, "team.manageDomain");
  const canManageResponsibility =
    governanceAccess.canManageSupervisors ||
    governanceAccess.canManageTeamLeads ||
    governanceAccess.canManageAnyDelegation ||
    governanceAccess.canViewAllGovernance ||
    governanceAccess.ledTeamIds.length > 0 ||
    supervisorCount > 0;

  return (
    <AppShell
      user={{
        id: user.id,
        name: user.name,
        roleLabel: `${roles.map(roleLabel).join("、") || "未指派角色"}${managementScope.ledTeamIds.length > 0 ? " Lead" : ""}`,
      }}
      tasks={notificationTasks}
      canUseWorkManagement={canUseWorkManagement}
      settingsAccess={{ people: canManagePeople, teams: canManageTeams, responsibility: canManageResponsibility }}
    >
      {children}
    </AppShell>
  );
}
