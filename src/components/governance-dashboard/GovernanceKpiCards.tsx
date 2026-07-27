// 治理儀表板 MVP 新增：KPI 總覽卡片（Plan 第二節第 1 項）。
//
// Server Component：純展示＋下鑽連結，不做任何資料查詢或篩選判斷——所有數字直接來自
// page.tsx 傳入的 ViewModel（已套用目前使用者可見範圍與目前篩選條件）。

import Link from "next/link";
import clsx from "clsx";
import { withGovernanceFilterOverride } from "@/lib/governance-dashboard/filters";
import type { GovernanceDashboardFilters, GovernanceKpiSummary } from "@/lib/governance-dashboard/types";

function Tile({
  href,
  label,
  value,
  tone = "default",
}: {
  href: string;
  label: string;
  value: number | string;
  tone?: "default" | "red" | "yellow" | "blue" | "gray";
}) {
  const toneClass =
    tone === "red"
      ? "text-gov-red"
      : tone === "yellow"
      ? "text-gov-yellow"
      : tone === "blue"
      ? "text-gov-blue"
      : tone === "gray"
      ? "text-gov-gray"
      : "text-gray-900";
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary hover:shadow"
    >
      <div className="text-sm text-gray-500">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold", toneClass)}>{value}</div>
    </Link>
  );
}

export default function GovernanceKpiCards({
  kpi,
  filters,
}: {
  kpi: GovernanceKpiSummary;
  filters: GovernanceDashboardFilters;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      <Tile
        href={withGovernanceFilterOverride(filters, { lifecycleStatus: "IN_PROGRESS" })}
        label="進行中"
        value={kpi.inProgress}
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { lifecycleStatus: "COMPLETED" })}
        label="已完成"
        value={kpi.completed}
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { lifecycleStatus: "CANCELLED" })}
        label="已取消"
        value={kpi.cancelled}
        tone="gray"
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { pendingApprovalOnly: true })}
        label="待核准"
        value={kpi.pendingApproval}
        tone="blue"
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { riskStatus: "YES" })}
        label="高風險"
        value={kpi.highRisk}
        tone="red"
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { staleDaysThreshold: kpi.staleDaysThreshold })}
        label={`停留超過 ${kpi.staleDaysThreshold} 天`}
        value={kpi.stale}
        tone="yellow"
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { legacyOnly: true })}
        label="舊制案件"
        value={kpi.legacyCount}
        tone="gray"
      />
    </div>
  );
}
