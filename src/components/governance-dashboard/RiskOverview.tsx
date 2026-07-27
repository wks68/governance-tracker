// 治理儀表板 MVP 新增：風險監控（Plan 第二節第 3 項）。

import Link from "next/link";
import { withGovernanceFilterOverride } from "@/lib/governance-dashboard/filters";
import type { GovernanceDashboardFilters, GovernanceRiskOverview as RiskOverviewData } from "@/lib/governance-dashboard/types";

export default function RiskOverview({
  overview,
  filters,
}: {
  overview: RiskOverviewData;
  filters: GovernanceDashboardFilters;
}) {
  const totalWithRecord = overview.yes + overview.unknown + overview.unanswered;
  if (totalWithRecord === 0 && overview.noRecord === 0) {
    return null;
  }

  const tiles: { label: string; value: number; tone: string; href: string }[] = [
    {
      label: "有風險",
      value: overview.yes,
      tone: "text-gov-red",
      href: withGovernanceFilterOverride(filters, { riskStatus: "YES" }),
    },
    {
      label: "風險待確認",
      value: overview.unknown,
      tone: "text-gov-yellow",
      href: withGovernanceFilterOverride(filters, { riskStatus: "UNKNOWN" }),
    },
    {
      label: "尚未完成風險確認",
      value: overview.unanswered,
      tone: "text-gov-blue",
      href: withGovernanceFilterOverride(filters, { riskStatus: "UNANSWERED" }),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary hover:shadow"
        >
          <div className="text-sm text-gray-500">{t.label}</div>
          <div className={`mt-1 text-2xl font-semibold ${t.tone}`}>{t.value}</div>
        </Link>
      ))}
      {overview.noRecord > 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-400 sm:col-span-3">
          另有 {overview.noRecord} 筆案件尚無風險紀錄。
        </div>
      )}
    </div>
  );
}
