import TeamLeadManager from "./TeamLeadManager";
import { RemoveTeamMemberButton } from "./TeamMemberManager";

// M1.5-C1-C 新增：Team 明細頁的成員清單（含操作欄位）。canManageMembers／canManageLeads
// 分別對應 team.manageMembers（People 領域）與 governance.manageTeamLeads（治理領域）
// 兩種不同 Capability 來源，由呼叫端（page.tsx）各自解析後傳入，本元件不重新判斷授權。
export interface TeamMemberRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  membershipRole: string;
  isActive: boolean;
}

export default function TeamMemberTable({
  teamId,
  members,
  canManageMembers,
  canManageLeads,
}: {
  teamId: string;
  members: TeamMemberRow[];
  canManageMembers: boolean;
  canManageLeads: boolean;
}) {
  const showActions = canManageMembers || canManageLeads;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">成員</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">身分</th>
            <th className="px-3 py-2">狀態</th>
            {showActions && <th className="px-3 py-2">操作</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {members.map((m) => (
            <tr key={m.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 text-gray-800">{m.userName}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.userEmail}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.membershipRole === "LEAD" ? "LEAD" : "成員"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.isActive ? "有效" : "停用"}</td>
              {showActions && (
                <td className="px-3 py-2">
                  {m.isActive && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {canManageLeads && (
                        <TeamLeadManager teamId={teamId} userId={m.userId} userName={m.userName} membershipRole={m.membershipRole} />
                      )}
                      {canManageMembers && (
                        <RemoveTeamMemberButton
                          teamId={teamId}
                          userId={m.userId}
                          userName={m.userName}
                          isLead={m.membershipRole === "LEAD"}
                        />
                      )}
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={showActions ? 5 : 4} className="px-3 py-4 text-center text-xs text-gray-400">
                無成員
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
