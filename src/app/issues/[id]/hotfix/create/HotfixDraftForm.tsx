"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText, ActionSuccessText } from "@/components/ActionResultBanner";
import { saveHotfixDraftAction, submitHotfixDraftAction } from "../create-actions";
import { ENVIRONMENTS, RISK_LEVELS } from "@/lib/constants";
import type { HotfixPriorityDef } from "@/lib/hotfix-ui/priority";
import TeamApplicantSelector from "@/components/team-applicant/TeamApplicantSelector";
import type { TeamOption, ApplicantOption } from "@/lib/team-applicant/teamApplicantService";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

interface DraftValues {
  title: string;
  description: string;
  systemName: string;
  environment: string;
  riskLevel: string;
  dueDate: string;
  hotfixPriority: string;
  teamId: string;
  applicantId: string;
}

export default function HotfixDraftForm({
  issueId,
  initialValues,
  priorities,
  teams,
  initialApplicants,
}: {
  issueId: string;
  initialValues: DraftValues;
  priorities: readonly HotfixPriorityDef[];
  teams: TeamOption[];
  /** 目前團隊的申請人選項（含正式角色名稱），由 Server Component 查好後傳入。 */
  initialApplicants?: ApplicantOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<DraftValues>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof DraftValues>(key: K, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("issueId", issueId);
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  }

  function run(action: (formData: FormData) => Promise<{ ok: boolean; message: string }>, successMsg?: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action(buildFormData());
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(successMsg ?? result.message);
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">編輯工單內容</h2>
      <ActionErrorText message={error} />
      <ActionSuccessText message={success} />
      <div className="mt-3 space-y-4">
        <TeamApplicantSelector
          teams={teams}
          teamId={values.teamId}
          applicantId={values.applicantId}
          onTeamIdChange={(v) => set("teamId", v)}
          onApplicantIdChange={(v) => set("applicantId", v)}
          initialApplicants={initialApplicants}
          disabled={isPending}
        />
        <div>
          <label className={labelCls}>
            標題<span className="ml-1 text-danger">*</span>
          </label>
          <input value={values.title} onChange={(e) => set("title", e.target.value)} disabled={isPending} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>
            問題現象<span className="ml-1 text-danger">*</span>
          </label>
          <textarea rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} disabled={isPending} className={inputCls} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>
              系統名稱<span className="ml-1 text-danger">*</span>
            </label>
            <input value={values.systemName} onChange={(e) => set("systemName", e.target.value)} disabled={isPending} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>
              環境<span className="ml-1 text-danger">*</span>
            </label>
            <select value={values.environment} onChange={(e) => set("environment", e.target.value)} disabled={isPending} className={inputCls}>
              <option value="">請選擇</option>
              {ENVIRONMENTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              風險等級<span className="ml-1 text-danger">*</span>
            </label>
            <select value={values.riskLevel} onChange={(e) => set("riskLevel", e.target.value)} disabled={isPending} className={inputCls}>
              <option value="">請選擇</option>
              {RISK_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              Hotfix 工單優先級<span className="ml-1 text-danger">*</span>
            </label>
            <select value={values.hotfixPriority} onChange={(e) => set("hotfixPriority", e.target.value)} disabled={isPending} className={inputCls}>
              <option value="">請選擇</option>
              {priorities.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              預計完成日<span className="ml-1 text-danger">*</span>
            </label>
            <input type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} disabled={isPending} className={inputCls} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(saveHotfixDraftAction, "已暫存")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          暫存
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(submitHotfixDraftAction)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {isPending ? "處理中…" : "建立工單"}
        </button>
      </div>
    </section>
  );
}
