"use client";

// 治理儀表板 UI 收斂：篩選列（第四節）。
//
// Client Component 只處理篩選互動，透過 URL search params 讀寫（可分享／可重新整理／
// 可返回／可下鑽），不直接查詢資料庫、不自行計算統計。首頁預設只顯示最常用的 6 種
// 篩選（日期區間／流程類型／目前階段／Team／風險例外／停留天數），其餘技術性條件
// （工單類型、案件狀態）收合於「更多篩選」。

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { issueTypeShortLabel } from "@/lib/constants";
import { STALE_DAYS_OPTIONS } from "@/lib/governance-dashboard/types";
import type { GovernanceFilterOptions } from "@/lib/governance-dashboard/types";

export default function GovernanceFilters({ options }: { options: GovernanceFilterOptions }) {
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
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-gray-500">
          起始日期
          <input
            type="date"
            className={sel}
            defaultValue={searchParams.get("dateFrom") ?? ""}
            onChange={(e) => update("dateFrom", e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          結束日期
          <input
            type="date"
            className={sel}
            defaultValue={searchParams.get("dateTo") ?? ""}
            onChange={(e) => update("dateTo", e.target.value)}
          />
        </label>

        <select
          className={sel}
          defaultValue={searchParams.get("workflowDefinitionId") ?? ""}
          onChange={(e) => update("workflowDefinitionId", e.target.value)}
        >
          <option value="">流程類型：全部</option>
          {options.workflowDefinitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <select className={sel} defaultValue={searchParams.get("stageId") ?? ""} onChange={(e) => update("stageId", e.target.value)}>
          <option value="">目前階段：全部</option>
          {options.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <select className={sel} defaultValue={searchParams.get("teamId") ?? ""} onChange={(e) => update("teamId", e.target.value)}>
          <option value="">Team：全部</option>
          {options.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          className={sel}
          defaultValue={searchParams.get("riskStatus") ?? ""}
          onChange={(e) => update("riskStatus", e.target.value)}
        >
          <option value="">風險／例外：全部</option>
          <option value="YES">已確認有風險</option>
          <option value="UNKNOWN">風險狀況待釐清</option>
          <option value="UNANSWERED">尚未填寫風險確認</option>
        </select>

        <select
          className={sel}
          defaultValue={searchParams.get("staleDaysThreshold") ?? ""}
          onChange={(e) => update("staleDaysThreshold", e.target.value)}
        >
          <option value="">停留天數門檻：預設</option>
          {STALE_DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              超過 {d} 天
            </option>
          ))}
        </select>

        {searchParams.toString() && (
          <button onClick={() => router.push(pathname)} className="text-xs text-gray-400 underline hover:text-gray-600">
            清除篩選
          </button>
        )}
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-primary">更多篩選</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
          <select
            className={sel}
            defaultValue={searchParams.get("issueType") ?? ""}
            onChange={(e) => update("issueType", e.target.value)}
          >
            <option value="">工單類型：全部</option>
            {options.issueTypes.map((t) => (
              <option key={t} value={t}>
                {issueTypeShortLabel(t)}
              </option>
            ))}
          </select>

          <select
            className={sel}
            defaultValue={searchParams.get("lifecycleStatus") ?? ""}
            onChange={(e) => update("lifecycleStatus", e.target.value)}
          >
            <option value="">案件狀態：全部</option>
            <option value="IN_PROGRESS">進行中</option>
            <option value="COMPLETED">已完成</option>
            <option value="CANCELLED">已取消</option>
          </select>
        </div>
      </details>
    </div>
  );
}
