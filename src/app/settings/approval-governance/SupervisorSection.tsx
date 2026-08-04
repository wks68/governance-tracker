import { prisma } from "@/lib/prisma";
import type { GovernanceAccessContext } from "@/lib/permissions";
import { listCurrentSupervisors, listSupervisorHistory } from "@/lib/supervisorAssignmentService";
import {
  CreateSupervisorAssignmentPanel,
  ManageSupervisorAssignmentPanel,
  type CurrentAssignmentInfo,
} from "@/components/SupervisorAssignmentPanel";

function toDateInputValue(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

export default async function SupervisorSection({ actorId, ctx }: { actorId: string; ctx: GovernanceAccessContext }) {
  const now = new Date();
  const currentRows = await listCurrentSupervisors(actorId, now);
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  const userMap = new Map(users.map((u) => [u.id, u]));
  const userOptions = users.map((u) => ({ id: u.id, name: u.name }));

  const historyByUser = new Map<string, Awaited<ReturnType<typeof listSupervisorHistory>>>();
  for (const row of currentRows) {
    historyByUser.set(row.userId, await listSupervisorHistory(actorId, row.userId));
  }

  return (
    <div className="space-y-4">
      {ctx.canManageSupervisors && <CreateSupervisorAssignmentPanel users={userOptions} />}

      {currentRows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">沒有可顯示的主管指派資料。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500">
                <th className="px-3 py-2">使用者</th>
                <th className="px-3 py-2">目前主管</th>
                <th className="px-3 py-2">validFrom</th>
                <th className="px-3 py-2">validUntil</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2">建立人</th>
                {ctx.canManageSupervisors && <th className="px-3 py-2">操作</th>}
                <th className="px-3 py-2">歷史紀錄</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {currentRows.map((row) => {
                const history = historyByUser.get(row.userId) ?? [];
                const result = row.result;
                const currentRaw = result.kind === "resolved" ? history.find((h) => h.id === result.assignment.id) : null;
                const current: CurrentAssignmentInfo | null = currentRaw
                  ? {
                      id: currentRaw.id,
                      supervisorUserId: currentRaw.supervisorUserId,
                      validFrom: toDateInputValue(currentRaw.validFrom),
                      isFuture: currentRaw.validFrom.getTime() > now.getTime(),
                    }
                  : null;

                const statusLabel =
                  result.kind === "resolved"
                    ? current?.isFuture
                      ? "已排定（尚未生效）"
                      : "已指派"
                    : result.kind === "configError"
                      ? "設定衝突（多筆有效 primary）"
                      : "無有效主管";

                return (
                  <tr key={row.userId} className="align-top hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{userMap.get(row.userId)?.name ?? row.userId}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                      {result.kind === "resolved" ? userMap.get(result.assignment.supervisorUserId)?.name ?? result.assignment.supervisorUserId : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{currentRaw ? toDateInputValue(currentRaw.validFrom) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{currentRaw?.validUntil ? toDateInputValue(currentRaw.validUntil) : "未設定"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{statusLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{currentRaw ? userMap.get(currentRaw.createdByUserId)?.name ?? currentRaw.createdByUserId : "—"}</td>
                    {ctx.canManageSupervisors && (
                      <td className="px-3 py-2">
                        <ManageSupervisorAssignmentPanel targetUserId={row.userId} current={current} users={userOptions} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-xs text-gray-500">
                      <details>
                        <summary className="cursor-pointer text-primary">{history.length} 筆</summary>
                        <ul className="mt-1 space-y-1">
                          {history.map((h) => (
                            <li key={h.id}>
                              {userMap.get(h.supervisorUserId)?.name ?? h.supervisorUserId}｜{toDateInputValue(h.validFrom)} ~{" "}
                              {h.validUntil ? toDateInputValue(h.validUntil) : "未設定"}
                              {!h.isActive && "（已取消）"}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
