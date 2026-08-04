import Link from "next/link";
import { issueTypeLabel } from "@/lib/constants";

// M2-A3 新增：Workflow 定義清單表格（純呈現）。資料範圍一律由呼叫端（page.tsx）透過
// listWorkflowDefinitionsForActor 取得，本元件不做任何授權判斷、不額外查詢、不直接使用 Prisma。
export interface WorkflowDefinitionRow {
  id: string;
  key: string;
  name: string;
  issueType: string;
  isActive: boolean;
  versions: { id: string; versionNo: number; status: string; publishedAt: string | null }[];
}

const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已發布", ARCHIVED: "已封存" };

export default function WorkflowDefinitionTable({ definitions }: { definitions: WorkflowDefinitionRow[] }) {
  if (definitions.length === 0) {
    return <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">尚未建立任何 Workflow 定義。</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">名稱</th>
            <th className="px-3 py-2">key</th>
            <th className="px-3 py-2">工單類型</th>
            <th className="px-3 py-2">狀態</th>
            <th className="px-3 py-2">版本</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {definitions.map((d) => {
            const published = d.versions.filter((v) => v.status === "PUBLISHED");
            const draft = d.versions.filter((v) => v.status === "DRAFT");
            return (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">
                  <Link href={`/admin/workflows/${d.id}`} className="hover:text-primary hover:underline">
                    {d.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">{d.key}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{issueTypeLabel(d.issueType)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={
                      "rounded-full border px-2 py-0.5 text-xs " +
                      (d.isActive ? "border-success-border bg-success-bg text-success-text" : "border-secondary-border bg-gray-100 text-gray-500")
                    }
                  >
                    {d.isActive ? "啟用中" : "已停用"}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  共 {d.versions.length} 版
                  {published.length > 0 && <span className="ml-1 text-success-text">（{published.length} 個已發布）</span>}
                  {draft.length > 0 && <span className="ml-1 text-gray-500">（{draft.length} 個草稿）</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function workflowVersionStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
