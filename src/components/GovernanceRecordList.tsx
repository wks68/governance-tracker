import Link from "next/link";
import { formatDate } from "@/lib/datetime";

export interface GovernanceRecordRow {
  id: string;
  issueKey: string;
  systemName: string;
  title: string;
  status: string;
  createdAt: string;
  relationLabels: string[];
}

export default function GovernanceRecordList({
  title,
  description,
  records,
}: {
  title: string;
  description: string;
  records: GovernanceRecordRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="mt-0.5 text-sm text-gray-500">{description}・共 {records.length} 筆</p>
        </div>
        <Link href="/issues/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover">
          建立治理紀錄
        </Link>
      </div>
      {records.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">目前沒有資料。</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500">
                <th className="px-3 py-2">編號</th>
                <th className="px-3 py-2">系統／服務</th>
                <th className="px-3 py-2">標題</th>
                <th className="px-3 py-2">目前狀態</th>
                <th className="px-3 py-2">關聯</th>
                <th className="px-3 py-2">建立日期</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link href={`/issues/${record.id}`} className="font-medium text-primary hover:underline">{record.issueKey}</Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{record.systemName || "—"}</td>
                  <td className="max-w-[320px] truncate px-3 py-2 text-gray-800" title={record.title}>{record.title}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{record.status}</td>
                  <td className="px-3 py-2">
                    {record.relationLabels.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {record.relationLabels.map((label) => (
                          <span key={label} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">{label}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">尚未關聯</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(record.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link href={`/issues/${record.id}`} className="text-xs font-medium text-primary hover:underline">查看</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
