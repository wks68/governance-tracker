import Link from "next/link";

// M1.5-C1-C 新增：Team 清單表格（純呈現）。可見範圍一律由 listTeamsForActor 決定。
export interface TeamRow {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  leadNames: string[];
  systemNames: string[];
}

export default function TeamTable({ teams }: { teams: TeamRow[] }) {
  if (teams.length === 0) {
    return <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">沒有可顯示的 Team。</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">名稱</th>
            <th className="px-3 py-2">說明</th>
            <th className="px-3 py-2">對應系統</th>
            <th className="px-3 py-2">啟用中成員數</th>
            <th className="px-3 py-2">LEAD</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {teams.map((t) => (
            <tr key={t.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">
                <Link href={`/admin/teams/${t.id}`} className="hover:text-primary hover:underline">
                  {t.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-gray-600">{t.description || "—"}</td>
              <td className="px-3 py-2 text-gray-600">{t.systemNames.length > 0 ? t.systemNames.join("、") : "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{t.memberCount}</td>
              <td className="px-3 py-2 text-gray-600">
                {t.leadNames.length > 0 ? (
                  t.leadNames.join("、")
                ) : (
                  <span className="text-warning-text">（無有效 LEAD）</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
