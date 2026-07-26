import { roleLabel } from "@/lib/constants";

// M1.5-C1-C 新增：人員明細頁的基本資料摘要區（純呈現）。
export interface TeamBadge {
  teamId: string;
  teamName: string;
  membershipRole: string;
  isActive: boolean;
}

export default function PersonSummary({
  person,
  activeRoles,
  teamBadges,
}: {
  person: {
    name: string;
    email: string;
    department: string;
    loginIdentifier: string | null;
    role: string;
    isActive: boolean;
    isBreakGlassAdmin: boolean;
  };
  activeRoles: string[];
  teamBadges: TeamBadge[];
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-900">{person.name}</h2>
        <span
          className={
            person.isActive
              ? "rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-text"
              : "rounded-full bg-secondary-bg px-2 py-0.5 text-xs font-medium text-secondary-text"
          }
        >
          {person.isActive ? "啟用" : "停用"}
        </span>
        <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary">主要角色：{roleLabel(person.role)}</span>
        {person.isBreakGlassAdmin && (
          <span className="rounded bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-text">Break-glass Admin</span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-gray-500">Email</dt>
          <dd className="text-gray-800">{person.email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-gray-500">部門</dt>
          <dd className="text-gray-800">{person.department || "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-gray-500">loginIdentifier</dt>
          <dd className="text-gray-800">{person.loginIdentifier || "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-gray-500">Active Roles</dt>
          <dd className="text-gray-800">{activeRoles.length > 0 ? activeRoles.map((r) => roleLabel(r)).join("、") : "—"}</dd>
        </div>
      </dl>

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-gray-500">Team</p>
        {teamBadges.length === 0 ? (
          <p className="text-xs text-gray-400">無所屬 Team</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {teamBadges.map((t) => (
              <span
                key={t.teamId}
                className={
                  t.membershipRole === "LEAD"
                    ? "rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary"
                    : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600"
                }
              >
                {t.teamName}（{t.membershipRole === "LEAD" ? "LEAD" : "成員"}）
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
