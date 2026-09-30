import Link from "next/link";
import { BrainCircuit, Clock3, Filter, ShieldAlert } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import { db } from "@/lib/db";
import { ENVIRONMENTS, ISSUE_TYPES, RISK_LEVELS, ROLES, STATUS_LIGHTS } from "@/lib/governance";
import {
  AI_DISCLAIMER,
  displayBlockReason,
  displayEnvironment,
  displayEvidenceStatus,
  displayIssueType,
  displayNextStep,
  displayRiskLevel,
  displayRole,
  displayStatusLight,
  displayWorkflowStatus,
  displayYesNo
} from "@/lib/i18n";
import { isCriticalMonitoringUnanswered } from "@/lib/rules";
import type { IssueWithRelations } from "@/lib/types";
import { formatDate, overdueDays, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ResolvedSearchParams = Awaited<DashboardPageProps["searchParams"]>;

const severityOrder = new Map([
  ["Red", 1],
  ["Yellow", 2],
  ["Blue", 3],
  ["Green", 4],
  ["Gray", 5]
]);

function param(searchParams: ResolvedSearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function matches(issue: IssueWithRelations, searchParams: ResolvedSearchParams) {
  const filters = {
    issueType: param(searchParams, "issueType"),
    statusLight: param(searchParams, "statusLight"),
    systemName: param(searchParams, "systemName"),
    environment: param(searchParams, "environment"),
    owner: param(searchParams, "owner"),
    waitingRole: param(searchParams, "waitingRole"),
    riskLevel: param(searchParams, "riskLevel"),
    overdueOnly: param(searchParams, "overdueOnly")
  };

  return (
    (!filters.issueType || issue.issueType === filters.issueType) &&
    (!filters.statusLight || issue.statusLight === filters.statusLight) &&
    (!filters.systemName ||
      issue.systemName.toLowerCase().includes(filters.systemName.toLowerCase())) &&
    (!filters.environment || issue.environment === filters.environment) &&
    (!filters.owner ||
      issue.ownerName.toLowerCase().includes(filters.owner.toLowerCase()) ||
      issue.ownerRole === filters.owner) &&
    (!filters.waitingRole || issue.waitingRole === filters.waitingRole) &&
    (!filters.riskLevel || issue.riskLevel === filters.riskLevel) &&
    (!filters.overdueOnly || overdueDays(issue.dueDate, issue.workflowStatus) > 0)
  );
}

function SelectFilter({
  name,
  label,
  options,
  value,
  optionLabel = (option) => option
}: {
  name: string;
  label: string;
  options: readonly string[];
  value: string;
  optionLabel?: (option: string) => string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        name={name}
        defaultValue={value}
          className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
      >
        <option value="">全部</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = await searchParams;
  const issues = await db.issue.findMany({
    include: {
      fieldValues: true,
      evidence: true,
      comments: true
    },
    orderBy: [{ updatedAt: "desc" }]
  });
  const filteredIssues = issues
    .filter((issue) => matches(issue, resolvedSearchParams))
    .sort((a, b) => {
      const severity = (severityOrder.get(a.statusLight) ?? 9) - (severityOrder.get(b.statusLight) ?? 9);
      if (severity !== 0) {
        return severity;
      }

      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  const openIssues = issues.filter((issue) => issue.workflowStatus !== "Closed");
  const redIssues = issues.filter((issue) => issue.statusLight === "Red");
  const waitingIssues = issues.filter((issue) => issue.statusLight === "Blue" || issue.waitingRole);
  const statusCounts = STATUS_LIGHTS.map((status) => ({
    status,
    count: issues.filter((issue) => issue.statusLight === status).length
  }));

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">儀表板</h1>
          <p className="mt-1 text-sm text-slate-500">
            DMS 內部治理流程、風險燈號與待辦狀態總覽。
          </p>
        </div>
        <Link
          href="/issues/new"
          className="inline-flex h-10 items-center justify-center rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800"
        >
          建立治理議題
        </Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="未關閉議題" value={openIssues.length} detail="尚未結案" />
        <KpiCard label="紅燈項目" value={redIssues.length} detail="阻擋、逾期或關鍵告警" />
        <KpiCard
          label="黃燈項目"
          value={issues.filter((issue) => issue.statusLight === "Yellow").length}
          detail="等待處理"
        />
        <KpiCard label="藍燈等候項目" value={waitingIssues.length} detail="等待角色確認" />
        <KpiCard
          label="逾期項目"
          value={issues.filter((issue) => overdueDays(issue.dueDate, issue.workflowStatus) > 0).length}
          detail="超過到期日"
        />
        <KpiCard
          label="未關閉熱修復"
          value={openIssues.filter((issue) => issue.issueType === "Hotfix").length}
          detail="熱修復流程"
        />
        <KpiCard
          label="未關閉 RCA"
          value={openIssues.filter((issue) => issue.issueType === "RCA").length}
          detail="根因分析"
        />
        <KpiCard
          label="未關閉風險例外"
          value={openIssues.filter((issue) => issue.issueType === "Risk Exception").length}
          detail="例外追蹤"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-950">智慧篩選</h2>
          </div>
          <form className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SelectFilter
              name="issueType"
              label="議題類型"
              value={param(resolvedSearchParams, "issueType")}
              options={ISSUE_TYPES}
              optionLabel={displayIssueType}
            />
            <SelectFilter
              name="statusLight"
              label="燈號"
              value={param(resolvedSearchParams, "statusLight")}
              options={STATUS_LIGHTS}
              optionLabel={displayStatusLight}
            />
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                系統名稱
              </span>
              <input
                name="systemName"
                defaultValue={param(resolvedSearchParams, "systemName")}
                className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
              />
            </label>
            <SelectFilter
              name="environment"
              label="環境"
              value={param(resolvedSearchParams, "environment")}
              options={ENVIRONMENTS}
              optionLabel={displayEnvironment}
            />
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">負責人</span>
              <input
                name="owner"
                defaultValue={param(resolvedSearchParams, "owner")}
                className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
              />
            </label>
            <SelectFilter
              name="waitingRole"
              label="等候角色"
              value={param(resolvedSearchParams, "waitingRole")}
              options={ROLES}
              optionLabel={displayRole}
            />
            <SelectFilter
              name="riskLevel"
              label="風險等級"
              value={param(resolvedSearchParams, "riskLevel")}
              options={RISK_LEVELS}
              optionLabel={displayRiskLevel}
            />
            <label className="mt-6 flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                name="overdueOnly"
                value="true"
                defaultChecked={param(resolvedSearchParams, "overdueOnly") === "true"}
                className="h-4 w-4 rounded border-line text-delta-700"
              />
              只看逾期
            </label>
            <div className="flex items-end gap-2 xl:col-span-4">
              <button className="h-9 rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800">
                套用
              </button>
              <Link
                href="/dashboard"
                className="inline-flex h-9 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                重設
              </Link>
            </div>
          </form>
        </div>

        <div className="rounded-lg border border-line bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold text-slate-950">燈號摘要</h2>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {statusCounts.map((item) => (
              <div key={item.status} className="rounded-md border border-line bg-slate-50 p-3">
                <StatusBadge statusLight={item.status} />
                <div className="mt-3 text-2xl font-semibold text-slate-950">{item.count}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white shadow-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-950">重要議題清單</h2>
          <span className="text-xs text-slate-500">{filteredIssues.length} 筆</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1500px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                {[
                  "燈號",
                  "議題編號",
                  "類型",
                  "系統",
                  "環境",
                  "標題",
                  "流程",
                  "阻擋原因",
                  "等候",
                  "負責人",
                  "到期日",
                  "逾期",
                  "需 RCA",
                  "風險例外",
                  "佐證",
                  "下一步"
                ].map((header) => (
                  <th key={header} className="border-b border-line px-3 py-3">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredIssues.slice(0, 18).map((issue) => (
                <tr key={issue.id} className="border-b border-line last:border-b-0 hover:bg-slate-50">
                  <td className="px-3 py-3">
                    <StatusBadge
                      statusLight={issue.statusLight}
                      pulse={issue.statusLight === "Red" && isCriticalMonitoringUnanswered(issue)}
                    />
                  </td>
                  <td className="px-3 py-3 font-semibold text-delta-700">
                    <Link href={`/issues/${issue.id}`}>{issue.issueKey}</Link>
                  </td>
                  <td className="px-3 py-3 text-slate-700">{displayIssueType(issue.issueType)}</td>
                  <td className="px-3 py-3 text-slate-700">{issue.systemName}</td>
                  <td className="px-3 py-3 text-slate-700">{displayEnvironment(issue.environment)}</td>
                  <td className="max-w-[260px] px-3 py-3 font-medium text-slate-950">
                    {truncate(issue.title, 70)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {displayWorkflowStatus(issue.workflowStatus)}
                  </td>
                  <td className="max-w-[220px] px-3 py-3 text-slate-600">
                    {truncate(displayBlockReason(issue.blockReason), 80)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{displayRole(issue.waitingRole)}</td>
                  <td className="px-3 py-3 text-slate-700">
                    {issue.ownerName}
                    <span className="block text-xs text-slate-400">{displayRole(issue.ownerRole)}</span>
                  </td>
                  <td className="px-3 py-3 text-slate-700">{formatDate(issue.dueDate)}</td>
                  <td className="px-3 py-3 text-slate-700">
                    {overdueDays(issue.dueDate, issue.workflowStatus)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{displayYesNo(issue.needRca)}</td>
                  <td className="px-3 py-3 text-slate-700">
                    {displayYesNo(issue.needRiskException)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {displayEvidenceStatus(issue.evidenceStatus)}
                  </td>
                  <td className="max-w-[220px] px-3 py-3 text-slate-600">
                    {truncate(displayNextStep(issue.nextStep), 80)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-4 shadow-panel xl:col-span-1">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-600" />
            <h2 className="text-sm font-semibold text-slate-950">紅燈項目</h2>
          </div>
          <div className="mt-4 space-y-3">
            {redIssues.slice(0, 6).map((issue) => (
              <Link
                key={issue.id}
                href={`/issues/${issue.id}`}
                className="block rounded-md border border-red-100 bg-red-50 px-3 py-2 hover:bg-red-100"
              >
                <div className="text-sm font-semibold text-red-900">{issue.issueKey}</div>
                <div className="text-sm text-red-800">{truncate(issue.title, 78)}</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-4 shadow-panel xl:col-span-1">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-delta-700" />
            <h2 className="text-sm font-semibold text-slate-950">等候核准</h2>
          </div>
          <div className="mt-4 space-y-3">
            {waitingIssues.slice(0, 6).map((issue) => (
              <Link
                key={issue.id}
                href={`/issues/${issue.id}`}
                className="block rounded-md border border-delta-100 bg-delta-50 px-3 py-2 hover:bg-delta-100"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-delta-900">{issue.issueKey}</span>
                  <span className="text-xs text-delta-700">
                    {issue.waitingRole ? displayRole(issue.waitingRole) : "負責人"}
                  </span>
                </div>
                <div className="text-sm text-delta-800">{truncate(issue.title, 78)}</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-4 shadow-panel xl:col-span-1">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-950">AI 每日摘要模擬</h2>
          </div>
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <p>
              目前有 {redIssues.length} 筆紅燈項目需要優先檢視，
              {waitingIssues.length} 筆項目正在等待角色確認。
            </p>
            <p>
              請先處理逾期的生產問題、QA 或備份失敗結果，以及缺少核准佐證的高風險例外。
            </p>
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
              {AI_DISCLAIMER}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
