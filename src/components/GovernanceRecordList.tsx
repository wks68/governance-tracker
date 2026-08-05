import Link from "next/link";
import { formatDate } from "@/lib/datetime";
import PageHeader from "@/components/ui/PageHeader";
import DataTableFrame from "@/components/ui/DataTableFrame";
import { EmptyState } from "@/components/ui/FeedbackState";
import { FilePlus2 } from "lucide-react";
import ScrollDownChevron from "@/components/ui/ScrollDownChevron";

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
  createLabel,
  createHref,
}: {
  title: string;
  description: string;
  records: GovernanceRecordRow[];
  createLabel: string;
  createHref: string;
}) {
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={`${description}・共 ${records.length} 筆`}
        actions={
          <Link href={createHref} className="ui-button-primary">
            <FilePlus2 className="h-4 w-4" aria-hidden />
            {createLabel}
          </Link>
        }
      />
      {records.length === 0 ? (
        <EmptyState title="目前沒有資料" description={`建立後的${title}會顯示在這裡。`} />
      ) : (
        <div data-hotfix-scroll-section>
        <DataTableFrame label={`${title}資料表`}>
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
        </DataTableFrame>
        </div>
      )}
      <ScrollDownChevron />
    </div>
  );
}
