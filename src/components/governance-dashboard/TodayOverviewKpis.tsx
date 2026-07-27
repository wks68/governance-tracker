// 治理儀表板 UI 收斂：今日治理總覽（A 節）。最多 6 張主要 KPI，管理者語意，不將舊制
// 案件放入主要 KPI（舊制案件統計見頁面下方「舊制／歷史案件」收合區塊）。

import Link from "next/link";
import clsx from "clsx";
import { withGovernanceFilterOverride } from "@/lib/governance-dashboard/filters";
import type {
  GovernanceDashboardFilters,
  GovernancePhaseDistributionEntry,
  GovernanceTodayOverview,
} from "@/lib/governance-dashboard/types";

function Tile({
  href,
  label,
  value,
  tone = "default",
}: {
  href: string;
  label: string;
  value: number;
  tone?: "default" | "red" | "yellow" | "blue";
}) {
  const toneClass =
    tone === "red" ? "text-gov-red" : tone === "yellow" ? "text-gov-yellow" : tone === "blue" ? "text-gov-blue" : "text-gray-900";
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:border-primary hover:shadow"
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold", toneClass)}>{value}</div>
    </Link>
  );
}

export default function TodayOverviewKpis({
  overview,
  phases,
  filters,
}: {
  overview: GovernanceTodayOverview;
  phases: GovernancePhaseDistributionEntry[];
  filters: GovernanceDashboardFilters;
}) {
  const phaseStageIds = (phase: string): string[] => phases.find((p) => p.phase === phase)?.stageIds ?? [];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile
        href={withGovernanceFilterOverride(filters, { lifecycleStatus: "IN_PROGRESS", issueType: "Hotfix" })}
        label="進行中 Hotfix"
        value={overview.hotfixInProgress}
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { pendingApprovalOnly: true })}
        label="待主管核准"
        value={overview.pendingApproval}
        tone="blue"
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { stageIds: phaseStageIds("QA 驗證") })}
        label="待 QA 驗證"
        value={overview.pendingQaVerification}
        tone="blue"
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { stageIds: phaseStageIds("OP 上版") })}
        label="待 OP 上版"
        value={overview.pendingOpDeployment}
        tone="blue"
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { riskStatus: "YES" })}
        label="有風險／例外"
        value={overview.riskOrException}
        tone="red"
      />
      <Tile
        href={withGovernanceFilterOverride(filters, { staleDaysThreshold: overview.staleDaysThreshold })}
        label={`停留過久（＞${overview.staleDaysThreshold} 天）`}
        value={overview.stale}
        tone="yellow"
      />
    </div>
  );
}
