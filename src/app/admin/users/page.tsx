import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { roleLabel } from "@/lib/constants";
import UserRoleActions from "@/components/UserRoleActions";

export const dynamic = "force-dynamic";

// C1-B5：recentLogs 只篩選 entityType="User"，因此僅涵蓋這幾種 actionType（UserRoleAssigned／
// UserRoleRemoved／TeamMemberAdded／TeamMemberRemoved 等的 entityType 是 UserRole／TeamMember，
// 不會出現在這份清單）。
const ACTION_TYPE_LABELS: Record<string, string> = {
  RoleChange: "主要角色變更",
  UserCreated: "建立使用者",
  UserUpdated: "資料更新",
  UserActivated: "帳號啟用",
  UserDeactivated: "帳號停用",
};

export default async function AdminUsersPage() {
  await requireAdmin();

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const recentLogs = await prisma.auditLog.findMany({
    where: { entityType: "User" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { actor: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">使用者與角色</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          管理使用者帳號、指派角色與啟用狀態。所有角色與帳號狀態異動皆會寫入 Audit Log。
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium text-gray-500">
              <th className="px-3 py-2">姓名</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">部門</th>
              <th className="px-3 py-2">目前角色</th>
              <th className="px-3 py-2">帳號狀態</th>
              <th className="px-3 py-2">最後登入時間</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{u.name}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{u.email}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{u.department || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{roleLabel(u.role)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={
                      u.isActive
                        ? "rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-text"
                        : "rounded-full bg-secondary-bg px-2 py-0.5 text-xs font-medium text-secondary-text"
                    }
                  >
                    {u.isActive ? "啟用" : "停用"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("zh-TW") : "尚未登入"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <UserRoleActions userId={u.id} currentRole={u.role} isActive={u.isActive} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">角色 / 帳號異動紀錄</h2>
        {recentLogs.length === 0 ? (
          <p className="text-sm text-gray-400">尚無異動紀錄。</p>
        ) : (
          <ol className="relative space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            {recentLogs.map((log) => (
              <li key={log.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">
                    {ACTION_TYPE_LABELS[log.actionType] ?? "帳號狀態變更"}
                  </span>
                  <span>操作人：{log.actor?.name ?? "系統"}</span>
                  <span>{new Date(log.createdAt).toLocaleString("zh-TW")}</span>
                </div>
                <p className="mt-0.5 text-gray-800">{log.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
