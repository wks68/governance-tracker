// 治理儀表板第四輪：四區塊治理管理看板版型。首頁頂部 5 張緊湊 KPI，management-facing
// 語意（不顯示待主管核准／待 QA 驗證／待 OP 上版——這些改在 Hotfix 管理看板卡片上以
// badge 呈現）。每張皆可點擊，導向對應區塊；0 值時仍正常顯示（不得因為 0 筆就不渲染）。

import Link from "next/link";
import clsx from "clsx";
import type { GovernanceTodayOverview } from "@/lib/governance-dashboard/types";

function Tile({ href, label, value, tone = "default" }: { href: string; label: string; value: number; tone?: "default" | "red" | "yellow" }) {
  const toneClass = tone === "red" ? "text-gov-red" : tone === "yellow" ? "text-gov-yellow" : "text-gray-900";
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

export default function TopKpiRow({ overview }: { overview: GovernanceTodayOverview }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile href="#hotfix-board" label="進行中 Hotfix" value={overview.hotfixInProgress} />
      <Tile href="#rca-tracker" label="RCA 進行中" value={overview.rcaInProgress} />
      <Tile href="#incident-board" label="事件通報處理中" value={overview.incidentInProgress} />
      <Tile href="/issues?issueType=RiskException" label="風險／例外單" value={overview.riskExceptionOpen} tone="red" />
      <Tile href="#hotfix-board" label={`工單停留過久（＞${overview.staleDaysThreshold} 天）`} value={overview.stale} tone="yellow" />
    </div>
  );
}
