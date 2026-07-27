"use client";

// Hotfix 操作畫面收斂新增：處理紀錄時間軸（需求七）。改用「時間／執行人／執行動作／
// 來源階段／目標階段／原因意見／責任單位變更」欄位呈現，執行動作一律套用
// transitionCopy（不顯示 FORWARD／RETURN／CANCEL 等技術詞彙）。預設只顯示最近 5 筆，
// 可展開查看全部。資料本身完全沿用既有 IssueWorkflowStageHistory 唯讀查詢
// （historyService.getIssueWorkflowHistory），本檔案不查詢、不寫入任何資料。

import { useState } from "react";
import { transitionCopyOf } from "@/lib/hotfix-ui/transitionCopy";

export interface HotfixHistoryItem {
  id: string;
  transitionType: string; // ENTERED / FORWARDED / RETURNED / CANCELLED
  actionKey: string | null;
  fromStageLabel: string | null;
  toStageLabel: string;
  transitionLabel: string | null;
  actorName: string;
  reasonCode: string | null;
  terminalOutcome: string | null;
  assignedTeamNameBefore: string | null;
  assignedTeamNameAfter: string | null;
  executedAt: string; // ISO
}

const TRANSITION_TYPE_META: Record<string, { label: string; dotClass: string }> = {
  ENTERED: { label: "啟動", dotClass: "bg-gov-blue" },
  FORWARDED: { label: "前進", dotClass: "bg-gov-green" },
  RETURNED: { label: "退回", dotClass: "bg-gov-yellow" },
  CANCELLED: { label: "取消", dotClass: "bg-gov-red" },
};

function actionLabelOf(item: HotfixHistoryItem): string {
  if (item.transitionType === "ENTERED") return `啟動於「${item.toStageLabel}」`;
  if (!item.actionKey) return item.transitionLabel ?? "（未知動作）";
  return transitionCopyOf(item.actionKey, item.transitionLabel ?? item.actionKey).label;
}

function Row({ item }: { item: HotfixHistoryItem }) {
  const meta = TRANSITION_TYPE_META[item.transitionType] ?? { label: item.transitionType, dotClass: "bg-gray-400" };
  const teamChanged = item.assignedTeamNameBefore !== item.assignedTeamNameAfter;
  return (
    <li className="relative">
      <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>{new Date(item.executedAt).toLocaleString("zh-TW")}</span>
        <span className="font-medium text-gray-700">{item.actorName}</span>
        {item.terminalOutcome && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 font-medium text-white">{item.terminalOutcome === "COMPLETED" ? "已完成" : "已取消"}</span>
        )}
      </div>
      <p className="mt-0.5 text-sm text-gray-800">{actionLabelOf(item)}</p>
      {item.fromStageLabel && (
        <p className="mt-0.5 text-xs text-gray-500">
          來源階段：{item.fromStageLabel} → 目標階段：{item.toStageLabel}
        </p>
      )}
      {item.reasonCode && <p className="mt-0.5 text-xs text-gray-500">原因意見：{item.reasonCode}</p>}
      {teamChanged && (
        <p className="mt-0.5 text-xs text-gray-500">
          責任單位變更：{item.assignedTeamNameBefore ?? "（尚未指派）"} → {item.assignedTeamNameAfter ?? "（尚未指派）"}
        </p>
      )}
    </li>
  );
}

export default function HotfixHistoryTimeline({ items }: { items: HotfixHistoryItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return <p className="text-sm text-gray-400">尚無處理紀錄。</p>;

  const sorted = [...items].sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());
  const visible = expanded ? sorted : sorted.slice(0, 5);

  return (
    <div>
      <ol className="relative space-y-4 border-l border-gray-200 pl-4">
        {visible.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ol>
      {sorted.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "收合" : `查看全部 ${sorted.length} 筆紀錄`}
        </button>
      )}
    </div>
  );
}
