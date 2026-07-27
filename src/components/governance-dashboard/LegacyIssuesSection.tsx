// 治理儀表板 UI 收斂：舊制案件（F 節）。移至頁面最底部、預設收合，不納入新版
// Workflow Stage／風險／待核准 KPI 統計（見 metrics.computeLegacySummary 已獨立統計）。

import GovernanceIssueList from "./GovernanceIssueList";
import type { GovernanceLegacySummary } from "@/lib/governance-dashboard/types";

export default function LegacyIssuesSection({ legacy }: { legacy: GovernanceLegacySummary }) {
  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-600 hover:text-primary">
        舊制／歷史案件（共 {legacy.count} 筆，尚未納入新版流程）
      </summary>
      <div className="border-t border-gray-200 bg-white p-4">
        <GovernanceIssueList issues={legacy.issues} />
      </div>
    </details>
  );
}
