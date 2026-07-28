"use client";

import { useState } from "react";
import { createIssueAction } from "@/lib/actions";
import { ISSUE_TYPES, ENVIRONMENTS, RISK_LEVELS, PRIORITIES, SYSTEM_NAME_EXAMPLES } from "@/lib/constants";
import { HOTFIX_PRIORITIES } from "@/lib/hotfix-ui/priority";
import { getWorkflow, getVisibleFieldTemplate } from "@/lib/workflow";
import DynamicFieldsForm from "@/components/DynamicFieldsForm";
import TeamApplicantSelector from "@/components/team-applicant/TeamApplicantSelector";
import type { TeamOption } from "@/lib/team-applicant/teamApplicantService";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export default function NewIssueForm({ teams }: { teams: TeamOption[] }) {
  const [issueType, setIssueType] = useState<string>(ISSUE_TYPES[0].key);
  const [teamId, setTeamId] = useState("");
  const [applicantId, setApplicantId] = useState("");
  const initialStatus = getWorkflow(issueType)[0]?.key ?? "";
  const template = getVisibleFieldTemplate(issueType, initialStatus);
  const isHotfix = issueType === "Hotfix";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">建立工單</h1>
        <p className="mt-0.5 text-sm text-gray-500">請選擇工單類型與團隊，並填寫相關欄位</p>
      </div>

      <form action={createIssueAction} className="space-y-6">
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>工單類型</label>
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
            </div>
          </div>
          <TeamApplicantSelector
            teams={teams}
            teamId={teamId}
            applicantId={applicantId}
            onTeamIdChange={setTeamId}
            onApplicantIdChange={setApplicantId}
          />
        </section>

        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">主要欄位</h2>
          <div>
            <label className={labelCls}>標題</label>
            <input
              name="title"
              required
              placeholder={isHotfix ? "[Hotfix][系統名稱][問題類型] 問題摘要" : "請輸入工單標題"}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{isHotfix ? "問題現象" : "問題現象／需求說明"}</label>
            <textarea
              name="description"
              rows={3}
              placeholder={isHotfix ? "請描述正式環境發生什麼問題" : "請描述問題現象或需求內容"}
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
              {isHotfix && (
                <p className="mt-1 text-xs text-gray-400">
                  高：影響主要服務、營運流程、資料正確性或資安風險／中：影響部分功能或特定使用者／低：影響有限，但需修正
                </p>
              )}
            </div>
            {isHotfix ? (
              <div>
                <label className={labelCls}>Hotfix 工單優先級</label>
                <select name="hotfixPriority" className={inputCls} defaultValue="">
                  <option value="">請選擇</option>
                  {HOTFIX_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
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
            )}
            <div>
              <label className={labelCls}>預計完成日</label>
              <input type="date" name="dueDate" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>附件（選填）</label>
            <p className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400">
              建立工單後，即可於工單頁面上傳附件。
            </p>
          </div>
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
