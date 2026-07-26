"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ROLES } from "@/lib/constants";

// M1.5-C1-C 新增：人員清單篩選列。只負責更新網址查詢參數，實際篩選（在 row-level 授權
// 範圍內的一般屬性篩選）由 page.tsx 讀 searchParams 後於 Server Component 端進行，
// 與 src/components/FilterBar.tsx（工單清單篩選）同一慣例。
export interface TeamFilterOption {
  id: string;
  name: string;
}

export default function PeopleFilters({ teamOptions }: { teamOptions: TeamFilterOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  const sel = "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
      <input
        type="text"
        placeholder="搜尋姓名或 Email"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => update("q", e.target.value)}
        className="w-56 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
      />

      <select className={sel} defaultValue={searchParams.get("role") ?? ""} onChange={(e) => update("role", e.target.value)}>
        <option value="">主要角色：全部</option>
        {ROLES.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>

      <select className={sel} defaultValue={searchParams.get("active") ?? ""} onChange={(e) => update("active", e.target.value)}>
        <option value="">狀態：全部</option>
        <option value="1">僅啟用</option>
        <option value="0">僅停用</option>
      </select>

      {teamOptions.length > 0 && (
        <select className={sel} defaultValue={searchParams.get("team") ?? ""} onChange={(e) => update("team", e.target.value)}>
          <option value="">Team：全部</option>
          {teamOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {searchParams.toString() && (
        <button onClick={() => router.push(pathname)} className="text-xs text-gray-400 underline hover:text-gray-600">
          清除篩選
        </button>
      )}
    </div>
  );
}
