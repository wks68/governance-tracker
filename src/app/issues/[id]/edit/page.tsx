import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateIssueAction } from "@/lib/actions";
import { requireCurrentUser } from "@/lib/auth";
import { issueTypeLabel, roleLabel, ENVIRONMENTS, RISK_LEVELS, PRIORITIES, ALERT_LEVELS, SYSTEM_NAME_EXAMPLES } from "@/lib/constants";
import { getVisibleFieldTemplate } from "@/lib/workflow";
import DynamicFieldsForm, { DynamicOption } from "@/components/DynamicFieldsForm";

export const dynamic = "force-dynamic";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export default async function EditIssuePage({ params }: { params: { id: string } }) {
  await requireCurrentUser();
  const issue = await prisma.issue.findUnique({ where: { id: params.id }, include: { fieldValues: true } });
  if (!issue) notFound();

  const fieldsMap: Record<string, string> = {};
  for (const f of issue.fieldValues) fieldsMap[f.fieldKey] = f.fieldValue;
  const template = getVisibleFieldTemplate(issue.issueType, issue.workflowStatus);
  const updateWithId = updateIssueAction.bind(null, issue.id);
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  // 動態欄位若設定 dynamicOptionsRole（例如 RD 自測人下拉選單），依角色從已啟用使用者中查詢選項
  const dynamicOptions: Record<string, DynamicOption[]> = {};
  const rolesNeeded = Array.from(new Set(template.map((f) => f.dynamicOptionsRole).filter((r): r is string => !!r)));
  for (const role of rolesNeeded) {
    const roleUsers = await prisma.user.findMany({
      where: { isActive: true, role },
      orderBy: { name: "asc" },
      select: { name: true },
    });
    for (const f of template) {
      if (f.dynamicOptionsRole === role) {
        dynamicOptions[f.key] = roleUsers.map((u) => ({ value: u.name, label: u.name }));
      }
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">編輯工單</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {issue.issueKey} · {issueTypeLabel(issue.issueType)}
        </p>
      </div>

      <form action={updateWithId} className="space-y-6">
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">基本欄位</h2>
          <div>
            <label className={labelCls}>標題</label>
            <input name="title" required defaultValue={issue.title} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>問題描述</label>
            <textarea name="description" rows={3} defaultValue={issue.description} className={inputCls} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>系統名稱</label>
              <input name="systemName" list="system-name-list" defaultValue={issue.systemName} className={inputCls} />
              <datalist id="system-name-list">
                {SYSTEM_NAME_EXAMPLES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelCls}>環境</label>
              <select name="environment" defaultValue={issue.environment} className={inputCls}>
                <option value="">請選擇</option>
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>風險等級</label>
              <select name="riskLevel" defaultValue={issue.riskLevel} className={inputCls}>
                <option value="">請選擇</option>
                {RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>優先級</label>
              <select name="priority" defaultValue={issue.priority} className={inputCls}>
                <option value="">請選擇</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>負責人</label>
              <select name="ownerUserId" defaultValue={issue.ownerUserId ?? ""} className={inputCls}>
                <option value="">維持原負責人（{issue.ownerName || "—"}）</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{roleLabel(u.role)}）
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">轉派時僅可選擇已啟用的使用者。</p>
            </div>
            <div>
              <label className={labelCls}>建立人</label>
              <select name="reporterUserId" defaultValue={issue.reporterUserId ?? ""} className={inputCls}>
                <option value="">維持原建立人（{issue.reporter || "—"}）</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{roleLabel(u.role)}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>到期日</label>
              <input type="date" name="dueDate" defaultValue={issue.dueDate ? issue.dueDate.toISOString().slice(0, 10) : ""} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>告警等級</label>
              <select name="alertLevel" defaultValue={issue.alertLevel} className={inputCls}>
                <option value="">不適用</option>
                {ALERT_LEVELS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-6 pt-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="needRca" defaultChecked={issue.needRca} className="h-4 w-4" />
              是否需 RCA
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="needRiskException" defaultChecked={issue.needRiskException} className="h-4 w-4" />
              是否需風險例外
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="impactProduction" defaultChecked={issue.impactProduction} className="h-4 w-4" />
              是否影響正式環境
            </label>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">{issueTypeLabel(issue.issueType)} 專屬欄位</h2>
          <DynamicFieldsForm template={template} values={fieldsMap} dynamicOptions={dynamicOptions} />
        </section>

        <div className="flex gap-3">
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
            儲存
          </button>
          <a
            href={`/issues/${issue.id}`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            取消
          </a>
        </div>
      </form>
    </div>
  );
}
