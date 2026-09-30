import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { db } from "@/lib/db";
import { ISSUE_TYPES, STATUS_LIGHTS } from "@/lib/governance";
import {
  displayEnvironment,
  displayEvidenceStatus,
  displayIssueType,
  displayRole,
  displayStatusLight,
  displayWorkflowStatus
} from "@/lib/i18n";
import { formatDate, overdueDays, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type IssuesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ResolvedSearchParams = Awaited<IssuesPageProps["searchParams"]>;

function param(searchParams: ResolvedSearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function IssuesPage({ searchParams }: IssuesPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = param(resolvedSearchParams, "q").toLowerCase();
  const issueType = param(resolvedSearchParams, "issueType");
  const statusLight = param(resolvedSearchParams, "statusLight");
  const issues = await db.issue.findMany({
    include: {
      fieldValues: true,
      evidence: true,
      comments: true
    },
    orderBy: [{ updatedAt: "desc" }]
  });
  const filtered = issues.filter((issue) => {
    const matchesQuery =
      !query ||
      issue.issueKey.toLowerCase().includes(query) ||
      issue.title.toLowerCase().includes(query) ||
      issue.systemName.toLowerCase().includes(query) ||
      issue.ownerName.toLowerCase().includes(query);

    return (
      matchesQuery &&
      (!issueType || issue.issueType === issueType) &&
      (!statusLight || issue.statusLight === statusLight)
    );
  });

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">議題清單</h1>
          <p className="mt-1 text-sm text-slate-500">瀏覽、搜尋並開啟治理流程項目。</p>
        </div>
        <Link
          href="/issues/new"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800"
        >
          <Plus className="h-4 w-4" />
          建立治理議題
        </Link>
      </section>

      <section className="rounded-lg border border-line bg-white p-4 shadow-panel">
        <form className="grid gap-3 md:grid-cols-[1fr_220px_180px_auto]">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">搜尋</span>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                name="q"
                defaultValue={param(resolvedSearchParams, "q")}
                className="h-9 w-full rounded-md border border-line bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">類型</span>
            <select
              name="issueType"
              defaultValue={issueType}
              className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
            >
              <option value="">全部</option>
              {ISSUE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {displayIssueType(item)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">燈號</span>
            <select
              name="statusLight"
              defaultValue={statusLight}
              className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
            >
              <option value="">全部</option>
              {STATUS_LIGHTS.map((item) => (
                <option key={item} value={item}>
                  {displayStatusLight(item)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button className="h-9 rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800">
              套用
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-line bg-white shadow-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-950">議題登錄表</h2>
          <span className="text-xs text-slate-500">{filtered.length} 筆</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                {[
                  "燈號",
                  "議題編號",
                  "標題",
                  "類型",
                  "系統",
                  "環境",
                  "流程",
                  "負責人",
                  "到期日",
                  "逾期",
                  "佐證"
                ].map((header) => (
                  <th key={header} className="border-b border-line px-3 py-3">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue) => (
                <tr key={issue.id} className="border-b border-line last:border-b-0 hover:bg-slate-50">
                  <td className="px-3 py-3">
                    <StatusBadge statusLight={issue.statusLight} />
                  </td>
                  <td className="px-3 py-3 font-semibold text-delta-700">
                    <Link href={`/issues/${issue.id}`}>{issue.issueKey}</Link>
                  </td>
                  <td className="max-w-[360px] px-3 py-3 font-medium text-slate-950">
                    {truncate(issue.title, 90)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{displayIssueType(issue.issueType)}</td>
                  <td className="px-3 py-3 text-slate-700">{issue.systemName}</td>
                  <td className="px-3 py-3 text-slate-700">{displayEnvironment(issue.environment)}</td>
                  <td className="px-3 py-3 text-slate-700">
                    {displayWorkflowStatus(issue.workflowStatus)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {issue.ownerName}
                    <span className="block text-xs text-slate-400">{displayRole(issue.ownerRole)}</span>
                  </td>
                  <td className="px-3 py-3 text-slate-700">{formatDate(issue.dueDate)}</td>
                  <td className="px-3 py-3 text-slate-700">
                    {overdueDays(issue.dueDate, issue.workflowStatus)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {displayEvidenceStatus(issue.evidenceStatus)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
