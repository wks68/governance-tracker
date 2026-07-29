import Link from "next/link";
import { roleLabel } from "@/lib/constants";
import { formatDateTime } from "@/lib/datetime";

// M1.5-C1-C 新增：人員清單表格（純呈現）。資料範圍一律由呼叫端（page.tsx）透過
// listPeopleForActor 取得後再組成 PersonRow，本元件不做任何授權判斷、不額外查詢。
export interface PersonRow {
  id: string;
  name: string;
  email: string;
  department: string;
  primaryRole: string;
  activeRoles: string[];
  isActive: boolean;
  teamNames: string[];
  updatedAt: string; // ISO
}

export default function PeopleTable({ people }: { people: PersonRow[] }) {
  if (people.length === 0) {
    return <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">沒有符合條件的人員。</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">姓名</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">部門</th>
            <th className="px-3 py-2">主要角色</th>
            <th className="px-3 py-2">Active Roles</th>
            <th className="px-3 py-2">狀態</th>
            <th className="px-3 py-2">團隊</th>
            <th className="px-3 py-2">最後更新</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {people.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">
                <Link href={`/admin/people/${p.id}`} className="hover:text-primary hover:underline">
                  {p.name}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{p.email}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{p.department || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{roleLabel(p.primaryRole)}</td>
              <td className="px-3 py-2 text-gray-600">
                {p.activeRoles.length > 0 ? p.activeRoles.map((r) => roleLabel(r)).join("、") : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span
                  className={
                    p.isActive
                      ? "rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-text"
                      : "rounded-full bg-secondary-bg px-2 py-0.5 text-xs font-medium text-secondary-text"
                  }
                >
                  {p.isActive ? "啟用" : "停用"}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-600">{p.teamNames.length > 0 ? p.teamNames.join("、") : "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-500">{formatDateTime(p.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
