// M2-B 新增：Issue Workflow 執行歷程時間軸（唯讀）。純 Server Component，比照既有
// src/components/AuditLogList.tsx 樣式慣例。

export interface WorkflowHistoryItem {
  id: string;
  transitionType: string; // ENTERED / FORWARDED / RETURNED / CANCELLED
  fromStageLabel: string | null;
  toStageLabel: string;
  transitionLabel: string | null;
  actorName: string;
  reasonCode: string | null;
  terminalOutcome: string | null;
  executedAt: string; // ISO
}

const TRANSITION_TYPE_META: Record<string, { label: string; dotClass: string }> = {
  ENTERED: { label: "啟動", dotClass: "bg-gov-blue" },
  FORWARDED: { label: "前進", dotClass: "bg-gov-green" },
  RETURNED: { label: "退回", dotClass: "bg-gov-yellow" },
  CANCELLED: { label: "取消", dotClass: "bg-gov-red" },
};

export default function WorkflowHistoryTimeline({ items }: { items: WorkflowHistoryItem[] }) {
  if (items.length === 0) return <p className="text-sm text-gray-400">尚無 Workflow 執行歷程。</p>;
  return (
    <ol className="relative space-y-4 border-l border-gray-200 pl-4">
      {items.map((item) => {
        const meta = TRANSITION_TYPE_META[item.transitionType] ?? { label: item.transitionType, dotClass: "bg-gray-400" };
        return (
          <li key={item.id} className="relative">
            <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{meta.label}</span>
              <span>{item.actorName}</span>
              <span>{new Date(item.executedAt).toLocaleString("zh-TW")}</span>
              {item.terminalOutcome && (
                <span className="rounded bg-gray-800 px-1.5 py-0.5 font-medium text-white">{item.terminalOutcome === "COMPLETED" ? "已完成" : "已取消"}</span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-gray-800">
              {item.fromStageLabel ? (
                <>
                  「{item.fromStageLabel}」→「{item.toStageLabel}」{item.transitionLabel ? `（${item.transitionLabel}）` : ""}
                </>
              ) : (
                <>啟動於「{item.toStageLabel}」</>
              )}
            </p>
            {item.reasonCode && <p className="mt-0.5 text-xs text-gray-500">原因：{item.reasonCode}</p>}
          </li>
        );
      })}
    </ol>
  );
}
