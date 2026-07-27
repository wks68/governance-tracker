// 治理儀表板 UI 收斂：流程卡點（B 節）。以使用者可理解的階段語意呈現（需求／案件
// 確認、RD 修正、RD 主管核准、QA 驗證、QA 放行、OP 上版、正式環境確認），不直接顯示
// StageType／WorkflowStage key 等技術值——分組邏輯見 stagePhase.ts，統計來源仍是真實
// WorkflowStage 資料（見 metrics.computePhaseDistribution）。各關卡明細（含 Team 指派）
// 收合於下方，供需要更細顆粒度的使用者展開查看，不佔用首屏版面。

import Link from "next/link";
import EmptyDashboardState from "./EmptyDashboardState";
import WorkflowStageDistribution from "./WorkflowStageDistribution";
import { withGovernanceFilterOverride } from "@/lib/governance-dashboard/filters";
import type {
  GovernanceDashboardFilters,
  GovernancePhaseDistributionEntry,
  GovernanceStageDistributionEntry,
} from "@/lib/governance-dashboard/types";

export default function PhaseBottleneck({
  phases,
  stageDistribution,
  filters,
}: {
  phases: GovernancePhaseDistributionEntry[];
  stageDistribution: GovernanceStageDistributionEntry[];
  filters: GovernanceDashboardFilters;
}) {
  if (phases.length === 0) {
    return <EmptyDashboardState message="目前尚無使用新版流程的進行中案件。" />;
  }

  const maxCount = Math.max(...phases.map((p) => p.count));

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {phases.map((entry) => (
          <Link
            key={entry.phase}
            href={withGovernanceFilterOverride(filters, { stageIds: entry.stageIds })}
            className="block rounded-md border border-gray-200 p-3 hover:border-primary hover:shadow-sm"
          >
            <div className="text-xs text-gray-500">{entry.phase}</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">{entry.count} 件</div>
            <div className="mt-1.5 h-1.5 rounded-full bg-gray-100">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${Math.max(6, (entry.count / maxCount) * 100)}%` }}
              />
            </div>
          </Link>
        ))}
      </div>

      <details className="rounded-md border border-gray-100">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-500 hover:text-primary">
          各關卡明細
        </summary>
        <div className="border-t border-gray-100 p-3">
          <WorkflowStageDistribution entries={stageDistribution} filters={filters} />
        </div>
      </details>
    </div>
  );
}
