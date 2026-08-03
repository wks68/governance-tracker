"use client";

import GovernanceRelationSelector from "./GovernanceRelationSelector";
import type { GovernanceRelationCandidates } from "@/lib/issue-relations/viewService";

export default function HotfixGovernanceRelationFields({ candidates }: { candidates: GovernanceRelationCandidates }) {
  return <section aria-labelledby="governance-relations-create-title" className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
    <div><h2 id="governance-relations-create-title" className="text-sm font-semibold text-gray-800">關聯治理紀錄（選填）</h2><p className="mt-1 text-xs text-gray-500">可視實際情況關聯既有事件通報、RCA 或季度專案；未於建立時選擇者，仍可於 Hotfix 詳情頁補充或調整。</p></div>
    <GovernanceRelationSelector candidates={candidates} />
  </section>;
}
