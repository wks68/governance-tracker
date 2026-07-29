import Link from "next/link";

// M1.5-C1-C 新增：團隊清單表格（純呈現）。可見範圍一律由 listTeamsForActor 決定。
// 成員管理權限收斂更新：欄位改為「團隊名稱／主管／團隊領域／啟用狀態／成員人數／操作」。
export interface TeamRow {
  id: string;
  name: string;
  description: string;
  domainLabel: string;
  isActive: boolean;
  memberCount: number;
  leadNames: string[];
  systemNames: string[];
  /** 目前登入者是否可管理此團隊的成員（Admin 或該團隊主管）；否則唯讀 */
  canManage: boolean;
}

export default function TeamTable({ teams }: { teams: TeamRow[] }) {
  if (teams.length === 0) {
    return <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">沒有可顯示的團隊。</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">團隊名稱</th>
            <th className="px-3 py-2">主管</th>
            <th className="px-3 py-2">團隊領域</th>
            <th className="px-3 py-2">啟用狀態</th>
            <th className="px-3 py-2">成員人數</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {teams.map((t) => (
            <tr key={t.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">
                <Link href={`/admin/teams/${t.id}`} className="hover:text-primary hover:underline">
                  {t.name}
                </Link>
                {t.systemNames.length > 0 && (
                  <span className="ml-1 text-xs text-gray-400">對應系統：{t.systemNames.join("、")}</span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {t.leadNames.length > 0 ? t.leadNames.join("、") : <span className="text-warning-text">（尚未設定主管）</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{t.domainLabel}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{t.isActive ? "啟用" : "停用"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{t.memberCount}</td>
              <td className="whitespace-nowrap px-3 py-2">
                <Link href={`/admin/teams/${t.id}`} className="text-xs font-medium text-primary hover:underline">
                  {t.canManage ? "管理成員" : "檢視"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
