import { prisma } from "@/lib/prisma";
import { isClosed } from "@/lib/workflow";
import KpiCard from "@/components/KpiCard";
import FilterBar from "@/components/FilterBar";
import IssueTable, { IssueRow } from "@/components/IssueTable";
import StatusBadge from "@/components/StatusBadge";
import { STATUS_LIGHT_META } from "@/lib/constants";
import { requireCurrentUser } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

function toRow(issue: any): IssueRow {
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    issueType: issue.issueType,
    systemName: issue.systemName,
    environment: issue.environment,
    title: issue.title,
    workflowStatus: issue.workflowStatus,
    statusLight: issue.statusLight,
    blockReason: issue.blockReason,
    waitingRole: issue.waitingRole,
    ownerName: issue.ownerName,
    dueDate: issue.dueDate ? issue.dueDate.toISOString() : null,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    evidenceStatus: issue.evidenceStatus,
    nextStep: issue.nextStep,
    alertLevel: issue.alertLevel,
    firstResponseAt: issue.firstResponseAt ? issue.firstResponseAt.toISOString() : null,
  };
}

export default async function DashboardPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireCurrentUser();
  const allIssues = await prisma.issue.findMany({ orderBy: { updatedAt: "desc" } });

  const now = Date.now();
  const notClosed = (i: (typeof allIssues)[number]) => !isClosed(i.issueType, i.workflowStatus);
  const isOverdue = (i: (typeof allIssues)[number]) => !!i.dueDate && i.dueDate.getTime() < now && notClosed(i);

  // ---- KPI ----
  const kpi = {
    openTotal: allIssues.filter(notClosed).length,
    red: allIssues.filter((i) => i.statusLight === "Red").length,
    yellow: allIssues.filter((i) => i.statusLight === "Yellow").length,
    blue: allIssues.filter((i) => i.statusLight === "Blue").length,
    overdue: allIssues.filter(isOverdue).length,
    openHotfix: allIssues.filter((i) => i.issueType === "Hotfix" && notClosed(i)).length,
    openRca: allIssues.filter((i) => i.issueType === "RCA" && notClosed(i)).length,
    openRiskException: allIssues.filter((i) => i.issueType === "RiskException" && notClosed(i)).length,
  };

  const lightCounts: Record<string, number> = { Red: 0, Yellow: 0, Blue: 0, Green: 0, Gray: 0 };
  for (const i of allIssues) lightCounts[i.statusLight] = (lightCounts[i.statusLight] ?? 0) + 1;

  // ---- 篩選 ----
  const systemNames = Array.from(new Set(allIssues.map((i) => i.systemName).filter(Boolean))).sort();
  const owners = Array.from(new Set(allIssues.map((i) => i.ownerName).filter(Boolean))).sort();

  let filtered = allIssues;
  if (searchParams.issueType) filtered = filtered.filter((i) => i.issueType === searchParams.issueType);
  if (searchParams.light) filtered = filtered.filter((i) => i.statusLight === searchParams.light);
  if (searchParams.systemName) filtered = filtered.filter((i) => i.systemName === searchParams.systemName);
  if (searchParams.environment) filtered = filtered.filter((i) => i.environment === searchParams.environment);
  if (searchParams.owner) filtered = filtered.filter((i) => i.ownerName === searchParams.owner);
  if (searchParams.waitingRole) filtered = filtered.filter((i) => i.waitingRole === searchParams.waitingRole);
  if (searchParams.riskLevel) filtered = filtered.filter((i) => i.riskLevel === searchParams.riskLevel);
  if (searchParams.overdue === "1") filtered = filtered.filter(isOverdue);

  const lightPriority: Record<string, number> = { Red: 0, Yellow: 1, Blue: 2, Green: 3, Gray: 4 };
  const sorted = [...filtered].sort((a, b) => (lightPriority[a.statusLight] ?? 9) - (lightPriority[b.statusLight] ?? 9));

  const redIssues = allIssues.filter((i) => i.statusLight === "Red").slice(0, 8);
  const blueIssues = allIssues.filter((i) => i.statusLight === "Blue").slice(0, 8);

  const aiSummary = `今日治理摘要：目前共有 ${kpi.openTotal} 筆未結案工單，其中紅燈異常 / 逾期 ${kpi.red} 筆、黃燈待處理 ${kpi.yellow} 筆、藍燈等待確認 ${kpi.blue} 筆。已逾期項目共 ${kpi.overdue} 筆，建議優先處理。未結案 Hotfix ${kpi.openHotfix} 筆、RCA ${kpi.openRca} 筆、風險例外 ${kpi.openRiskException} 筆，請相關權責角色留意關卡卡控提示並儘速確認。`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">治理儀表板</h1>
        <p className="mt-0.5 text-sm text-gray-500">DMS 資安治理工單總覽</p>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard label="未結案總數" value={kpi.openTotal} />
        <KpiCard label="紅燈項目數" value={kpi.red} tone="red" />
        <KpiCard label="黃燈項目數" value={kpi.yellow} tone="yellow" />
        <KpiCard label="等待確認項目數" value={kpi.blue} tone="blue" />
        <KpiCard label="逾期項目數" value={kpi.overdue} tone="red" />
        <KpiCard label="未結案 Hotfix 數" value={kpi.openHotfix} />
        <KpiCard label="未結案 RCA 數" value={kpi.openRca} />
        <KpiCard label="未結案風險例外數" value={kpi.openRiskException} />
      </div>

      {/* 狀態燈號統計 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <span className="text-sm font-semibold text-gray-700">狀態燈號統計：</span>
        {Object.keys(STATUS_LIGHT_META).map((key) => (
          <div key={key} className="flex items-center gap-1.5">
            <StatusBadge light={key} size="sm" />
            <span className="text-sm text-gray-600">{lightCounts[key] ?? 0} 筆</span>
          </div>
        ))}
      </div>

      {/* Mock AI 今日摘要卡片 */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800">Mock AI 今日摘要</div>
        <p className="mt-1 text-sm text-indigo-900">{aiSummary}</p>
        <p className="mt-2 text-xs text-indigo-500">AI 建議僅供參考，需由權責人員確認後採用。</p>
      </div>

      {/* 智慧篩選器 */}
      <FilterBar options={{ systemNames, owners }} />

      {/* 重要工單清單 */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">重要工單清單（共 {sorted.length} 筆）</h2>
        <IssueTable issues={sorted.slice(0, 100).map(toRow)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 紅燈項目區 */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gov-red">紅燈項目區（異常 / 逾期）</h2>
          <div className="space-y-2">
            {redIssues.length === 0 && <p className="text-sm text-gray-400">目前無紅燈項目。</p>}
            {redIssues.map((i) => (
              <Link
                key={i.id}
                href={`/issues/${i.id}`}
                className="block rounded-md border border-danger-border bg-danger-bg p-3 text-sm hover:opacity-90"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">
                    {i.issueKey} · {i.title}
                  </span>
                  <StatusBadge light={i.statusLight} size="sm" pulse={i.alertLevel === "Critical" && !i.firstResponseAt} />
                </div>
                <p className="mt-1 text-xs text-gray-600">{i.blockReason || "無說明"}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* 等待確認區 */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gov-blue">等待確認區</h2>
          <div className="space-y-2">
            {blueIssues.length === 0 && <p className="text-sm text-gray-400">目前無等待確認項目。</p>}
            {blueIssues.map((i) => (
              <Link
                key={i.id}
                href={`/issues/${i.id}`}
                className="block rounded-md border border-info-border bg-info-bg p-3 text-sm hover:opacity-90"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">
                    {i.issueKey} · {i.title}
                  </span>
                  <StatusBadge light={i.statusLight} size="sm" />
                </div>
                <p className="mt-1 text-xs text-gray-600">等待角色：{i.waitingRole || "—"}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
