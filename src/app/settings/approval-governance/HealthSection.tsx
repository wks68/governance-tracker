import { getApprovalGovernanceHealth } from "@/lib/approvalGovernanceHealthService";
import HealthBadge from "@/components/HealthBadge";

// M1.5-B2：核准治理健康檢查。即時計算（不落地存表），完全透過
// getApprovalGovernanceHealth(actorId,...)（M1.5-B1 approvalGovernanceHealthService.ts）
// 取得 12 項檢查結果與 overallSeverity；本檔案只負責呈現與（依 severity／checkKey）
// 篩選已回傳的結果，不重新計算或改動任何一項判斷邏輯。天數／篩選條件皆以 GET
// query string 驅動（純 Server Component 重新渲染，不需要額外的 client 篩選元件）。
export default async function HealthSection({
  actorId,
  days,
  severityFilter,
  checkKeyFilter,
}: {
  actorId: string;
  days: number;
  severityFilter: string;
  checkKeyFilter: string;
}) {
  const report = await getApprovalGovernanceHealth(actorId, { expiringWithinDays: days });

  const filteredFindings = report.findings.filter(
    (f) => (severityFilter === "all" || f.severity === severityFilter) && (checkKeyFilter === "all" || f.checkKey === checkKeyFilter),
  );
  const hasAnyItem = filteredFindings.some((f) => f.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">整體狀態：</span>
          <HealthBadge severity={report.overallSeverity} />
        </div>
        <span className="text-xs text-gray-400">計算時間：{report.computedAt.toLocaleString("zh-TW")}</span>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <input type="hidden" name="tab" value="health" />
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="days">
            即將到期代理天數
          </label>
          <input
            id="days"
            type="number"
            name="days"
            min={1}
            defaultValue={days}
            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="severity">
            依嚴重度篩選
          </label>
          <select id="severity" name="severity" defaultValue={severityFilter} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="all">全部</option>
            <option value="critical">異常</option>
            <option value="warning">注意</option>
            <option value="normal">正常</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="checkKey">
            依檢查項目篩選
          </label>
          <select id="checkKey" name="checkKey" defaultValue={checkKeyFilter} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="all">全部</option>
            {report.findings.map((f) => (
              <option key={f.checkKey} value={f.checkKey}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover">
          套用
        </button>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {report.findings.map((f) => (
          <div key={f.checkKey} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-800">{f.label}</span>
              <HealthBadge severity={f.severity} size="sm" />
            </div>
            <p className="mt-1 text-xs text-gray-500">問題數量：{f.items.length}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">問題明細</h3>
        {!hasAnyItem ? (
          <p className="py-6 text-center text-sm text-gray-400">目前篩選範圍內沒有問題項目。</p>
        ) : (
          <div className="space-y-4">
            {filteredFindings.map((f) =>
              f.items.length === 0 ? null : (
                <div key={f.checkKey}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{f.label}</span>
                    <HealthBadge severity={f.severity} size="sm" />
                    <span className="text-xs text-gray-400">（{f.items.length} 筆）</span>
                  </div>
                  <ul className="space-y-1 rounded-md border border-gray-100 bg-gray-50 p-2">
                    {f.items.map((item) => (
                      <li key={item.id} className="text-xs text-gray-600">
                        {item.description}
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
