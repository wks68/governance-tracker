import { actionTypeLabel } from "@/lib/auditLabels";
import { formatDateTime } from "@/lib/datetime";

interface AuditItem {
  id: string;
  actionType: string;
  summary: string;
  actorRole: string;
  actorName: string;
  createdAt: string;
}

export default function AuditLogList({ logs }: { logs: AuditItem[] }) {
  if (logs.length === 0) return <p className="text-sm text-gray-400">尚無異動紀錄。</p>;
  return (
    <ol className="relative space-y-4 border-l border-gray-200 pl-4">
      {logs.map((log) => (
        <li key={log.id} className="relative">
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary-400" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{actionTypeLabel(log.actionType)}</span>
            <span>
              {log.actorName}（{log.actorRole}）
            </span>
            <span>{formatDateTime(log.createdAt)}</span>
          </div>
          <p className="mt-0.5 text-sm text-gray-800">{log.summary}</p>
        </li>
      ))}
    </ol>
  );
}
