"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ISSUE_TYPES, ROLES, RISK_LEVELS, STATUS_LIGHT_META, ENVIRONMENTS } from "@/lib/constants";

export interface FilterOptions {
  systemNames: string[];
  owners: string[];
}

export default function FilterBar({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleOverdue() {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("overdue") === "1") params.delete("overdue");
    else params.set("overdue", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  const sel = "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
      <select className={sel} defaultValue={searchParams.get("issueType") ?? ""} onChange={(e) => update("issueType", e.target.value)}>
        <option value="">工單類型：全部</option>
        {ISSUE_TYPES.map((t) => (
          <option key={t.key} value={t.key}>
            {t.shortLabel}
          </option>
        ))}
      </select>

      <select className={sel} defaultValue={searchParams.get("light") ?? ""} onChange={(e) => update("light", e.target.value)}>
        <option value="">狀態燈號：全部</option>
        {Object.entries(STATUS_LIGHT_META).map(([key, meta]) => (
          <option key={key} value={key}>
            {meta.label}
          </option>
        ))}
      </select>

      <select className={sel} defaultValue={searchParams.get("systemName") ?? ""} onChange={(e) => update("systemName", e.target.value)}>
        <option value="">系統名稱：全部</option>
        {options.systemNames.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select className={sel} defaultValue={searchParams.get("environment") ?? ""} onChange={(e) => update("environment", e.target.value)}>
        <option value="">環境：全部</option>
        {ENVIRONMENTS.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>

      <select className={sel} defaultValue={searchParams.get("owner") ?? ""} onChange={(e) => update("owner", e.target.value)}>
        <option value="">負責人：全部</option>
        {options.owners.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>

      <select className={sel} defaultValue={searchParams.get("waitingRole") ?? ""} onChange={(e) => update("waitingRole", e.target.value)}>
        <option value="">等待角色：全部</option>
        {ROLES.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>

      <select className={sel} defaultValue={searchParams.get("riskLevel") ?? ""} onChange={(e) => update("riskLevel", e.target.value)}>
        <option value="">風險等級：全部</option>
        {RISK_LEVELS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-sm text-gray-700">
        <input type="checkbox" checked={searchParams.get("overdue") === "1"} onChange={toggleOverdue} className="h-4 w-4" />
        只看逾期項目
      </label>

      {searchParams.toString() && (
        <button onClick={() => router.push(pathname)} className="text-xs text-gray-400 underline hover:text-gray-600">
          清除篩選
        </button>
      )}
    </div>
  );
}
