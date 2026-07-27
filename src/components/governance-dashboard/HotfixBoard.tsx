// 治理儀表板第四輪：Hotfix 管理看板（四區塊版型 A 區）。
//
// 5 桶固定管線：開單／待處理 → RD 修正 → QA 驗證 → OP 上版 → 正式環境確認。
// 桶內卡片顯示工單編號／標題／目前責任單位／已停留天數／風險例外 badge／核准放行
// badge，點擊進入 Issue 明細。各桶數量加總＝「進行中 Hotfix」KPI（見
// metrics.computeHotfixBoard，同一份資料來源，天然保證一致）。0 件時只顯示一行小型
// 空狀態，不留大面積空白框。

import Link from "next/link";
import { hotfixBoardApprovalBadge } from "@/lib/governance-dashboard/stagePhase";
import { RISK_STATUS_LABEL, RISK_STATUS_TONE, returnBadgeLabel } from "@/lib/governance-dashboard/labels";
import type { GovernanceHotfixBoardEntry, GovernanceIssueRow } from "@/lib/governance-dashboard/types";

function HotfixCard({ issue }: { issue: GovernanceIssueRow }) {
  const approvalBadge = issue.currentStage ? hotfixBoardApprovalBadge(issue.currentStage) : null;
  const returnBadge = returnBadgeLabel(issue);
  const showRiskBadge = issue.riskStatus === "YES" || issue.riskStatus === "UNKNOWN";

  return (
    <Link
      href={`/issues/${issue.id}`}
      className="block rounded-md border border-gray-200 bg-white p-2.5 text-sm hover:border-primary hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-primary">{issue.issueKey}</span>
        <span className="text-xs text-gray-400">{issue.dwellDays !== null ? `已停留 ${issue.dwellDays} 天` : "—"}</span>
      </div>
      <div className="mt-0.5 truncate text-gray-700">{issue.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-gray-500">{issue.assignedTeamName ?? "尚未指派責任單位"}</span>
        {showRiskBadge && (
          <span className={`rounded px-1.5 py-0.5 font-medium ${RISK_STATUS_TONE[issue.riskStatus]} bg-opacity-10`}>
            {RISK_STATUS_LABEL[issue.riskStatus]}
          </span>
        )}
        {approvalBadge && <span className="rounded bg-gov-blue/10 px-1.5 py-0.5 font-medium text-gov-blue">{approvalBadge}</span>}
        {returnBadge && <span className="rounded bg-gov-red/10 px-1.5 py-0.5 font-medium text-gov-red">{returnBadge}</span>}
      </div>
    </Link>
  );
}

function BucketColumn({ entry }: { entry: GovernanceHotfixBoardEntry }) {
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">{entry.bucket}</span>
        <span className="text-xs text-gray-400">{entry.count} 件</span>
      </div>
      {entry.preview.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-2 text-center text-xs text-gray-400">無案件</div>
      ) : (
        <div className="space-y-1.5">
          {entry.preview.map((issue) => (
            <HotfixCard key={issue.id} issue={issue} />
          ))}
          {entry.count > entry.preview.length && (
            <div className="text-center text-xs text-gray-400">還有 {entry.count - entry.preview.length} 件…</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HotfixBoard({ board }: { board: GovernanceHotfixBoardEntry[] }) {
  const total = board.reduce((sum, e) => sum + e.count, 0);

  return (
    <div id="hotfix-board" className="rounded-lg border border-gray-200 bg-white p-3">
      {total === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-400">
          目前沒有進行中的 Hotfix 案件。
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto">
          {board.map((entry) => (
            <BucketColumn key={entry.bucket} entry={entry} />
          ))}
        </div>
      )}
      <div className="mt-3 text-right">
        <Link href="/issues?issueType=Hotfix" className="text-xs text-gray-400 underline hover:text-primary">
          查看全部 Hotfix
        </Link>
      </div>
    </div>
  );
}
