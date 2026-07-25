import { prisma } from "@/lib/prisma";
import type { GovernanceAccessContext } from "@/lib/permissions";
import { listDelegations } from "@/lib/approvalDelegationService";
import { CreateApprovalDelegationPanel, RevokeApprovalDelegationPanel } from "@/components/ApprovalDelegationPanel";

// M1.5-B2：核准代理列表。可見範圍完全由 listDelegations(actorId,...)（M1.5-B1
// approvalDelegationService.ts）的 row-level 授權決定；本檔案只額外查 User/Team 名稱
// 供顯示，並依「delegatorUserId===actorId 或 canManageAnyDelegation」決定要不要顯示
// 撤銷按鈕（純 UI 提示，實際撤銷權限仍由 revokeApprovalDelegationAction 呼叫的服務層
// 現場重新檢查）。
export default async function DelegationSection({ actorId, ctx }: { actorId: string; ctx: GovernanceAccessContext }) {
  const delegations = await listDelegations(actorId, { includeHistory: true });
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  const userMap = new Map(users.map((u) => [u.id, u]));
  const teams = await prisma.team.findMany({ orderBy: { name: "asc" } });
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const now = new Date();

  return (
    <div className="space-y-4">
      <CreateApprovalDelegationPanel
        actorId={actorId}
        canManageAnyDelegation={ctx.canManageAnyDelegation}
        users={users.map((u) => ({ id: u.id, name: u.name }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
      />

      {delegations.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">沒有可顯示的代理紀錄。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500">
                <th className="px-3 py-2">委託人</th>
                <th className="px-3 py-2">代理人</th>
                <th className="px-3 py-2">核准類型</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">validFrom</th>
                <th className="px-3 py-2">validUntil</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2">建立原因</th>
                <th className="px-3 py-2">撤銷資訊</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {delegations.map((d) => {
                let statusLabel: string;
                if (!d.isActive) statusLabel = "已撤銷";
                else if (d.validUntil.getTime() < now.getTime()) statusLabel = "已過期";
                else if (d.validFrom.getTime() > now.getTime()) statusLabel = "已排定（尚未生效）";
                else statusLabel = "有效";

                const canRevoke = d.isActive && (d.delegatorUserId === actorId || ctx.canManageAnyDelegation);

                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-800">{userMap.get(d.delegatorUserId)?.name ?? d.delegatorUserId}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-800">{userMap.get(d.delegateUserId)?.name ?? d.delegateUserId}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{d.approvalType}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{d.teamId ? teamMap.get(d.teamId)?.name ?? d.teamId : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{d.validFrom.toISOString().slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{d.validUntil.toISOString().slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{statusLabel}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{d.reason || "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {d.revokedAt
                        ? `${userMap.get(d.revokedByUserId ?? "")?.name ?? d.revokedByUserId ?? "—"}｜${d.revokedAt.toISOString().slice(0, 10)}｜${d.revocationReason ?? ""}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{canRevoke && <RevokeApprovalDelegationPanel delegationId={d.id} />}</td>
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
