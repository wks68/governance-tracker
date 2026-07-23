"use client";

import { useState } from "react";
import { createIssueAction } from "@/lib/actions";
import { ISSUE_TYPES, ENVIRONMENTS, RISK_LEVELS, PRIORITIES, ALERT_LEVELS, SYSTEM_NAME_EXAMPLES, roleLabel } from "@/lib/constants";
import { getWorkflow, getVisibleFieldTemplate } from "@/lib/workflow";
import DynamicFieldsForm from "@/components/DynamicFieldsForm";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export interface ActiveUserOption {
  id: string;
  name: string;
  role: string;
}

export default function NewIssueForm({ users, currentUserId }: { users: ActiveUserOption[]; currentUserId: string }) {
  const [issueType, setIssueType] = useState<string>(ISSUE_TYPES[0].key);
  const initialStatus = getWorkflow(issueType)[0] ?? "";
  const template = getVisibleFieldTemplate(issueType, initialStatus);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">建立工單</h1>
        <p className="mt-0.5 text-sm text-gray-500">請選擇工單類型並填寫相關欄位</p>
      </div>

      <form action={createIssueAction} className="space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">工單類型</h2>
          <select
            name="issueType"
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
            className={inputCls}
          >
            {ISSUE_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </section>

        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">基本欄位</h2>
          <div>
            <label className={labelCls}>標題</label>
            <input
              name="title"
              required
              placeholder={issueType === "Hotfix" ? "[Hotfix][系統名稱][問題類型] 問題摘要" : "請輸入工單標題"}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{issueType === "Hotfix" ? "問題現象" : "問題描述"}</label>
            <textarea
              name="description"
              rows={3}
              placeholder={issueType === "Hotfix" ? "請描述正式環境發生什麼問題" : "請描述問題內容"}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>系統名稱</label>
              <input name="systemName" list="system-name-list" placeholder="例如：MyDMS" className={inputCls} />
              <datalist id="system-name-list">
                {SYSTEM_NAME_EXAMPLES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelCls}>環境</label>
              <select name="environment" className={inputCls} defaultValue="">
                <option value="">請選擇</option>
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>風險等級（= 影響程度）</label>
              <select name="riskLevel" className={inputCls} defaultValue="">
                <option value="">請選擇</option>
                {RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {issueType === "Hotfix" && (
                <p className="mt-1 text-xs text-gray-400">
                  高：影響主要服務、營運流程、資料正確性或資安風險／中：影響部分功能或特定使用者／低：影響有限，但需修正
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>優先級</label>
              <select name="priority" className={inputCls} defaultValue="">
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
              <select name="ownerUserId" className={inputCls} defaultValue="">
                <option value="">請選擇（僅列出已啟用使用者）</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{roleLabel(u.role)}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>建立人</label>
              <select name="reporterUserId" className={inputCls} defaultValue={currentUserId}>
                <option value="">請選擇（僅列出已啟用使用者）</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{roleLabel(u.role)}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>到期日</label>
              <input type="date" name="dueDate" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>告警等級（Monitoring Inventory / Incident 適用）</label>
              <select name="alertLevel" className={inputCls} defaultValue="">
                <option value="">不適用</option>
                {ALERT_LEVELS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {issueType !== "Hotfix" && (
            <div className="flex flex-wrap gap-6 pt-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="needRca" className="h-4 w-4" />
                是否需 RCA
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="needRiskException" className="h-4 w-4" />
                是否需風險例外
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="impactProduction" className="h-4 w-4" />
                是否影響正式環境
              </label>
            </div>
          )}
        </section>

        {template.length > 0 && (
          <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700">依工單類型的動態欄位</h2>
            <DynamicFieldsForm template={template} values={{}} />
          </section>
        )}

        <div className="flex gap-3">
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
            送出
          </button>
          <a href="/issues" className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            取消
          </a>
        </div>
      </form>
    </div>
  );
}
