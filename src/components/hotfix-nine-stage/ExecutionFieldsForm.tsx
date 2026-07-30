"use client";

// Hotfix 九階段 UI：RD／QA／OP 執行頁（stage3／5／7／OP 上版結果）共用的欄位表單。
// readOnly=true 時（主管簽核頁「本關資訊」區塊、或非目前責任角色時）改為純唯讀清單，
// 兩種模式共用同一份欄位定義與版面，避免各頁各自重複刻一份。

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionErrorText, ActionSuccessText } from "@/components/ActionResultBanner";
import { displayExecutionValue, type ExecutionFieldDef } from "@/lib/hotfix-ui/executionFields";
import type { ActionResult } from "@/lib/actionResult";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

// 送簽核准人規則修正：承接團隊找不到「其他」可核准的主管／代理人時，錯誤訊息本身已是完整的
// 業務說明（不含 stageKey、例外類別或資料表名稱），這裡只在訊息下方補上可實際完成設定的入口。
// 沒有對應治理設定權限的一般執行人不會看到連結，只看到聯絡管理員的提示——不得給出按了會被
// 擋下的連結。
export interface GovernanceFixLinks {
  canManageTeams: boolean;
  canManageApprovalGovernance: boolean;
}

const linkCls = "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50";

function NoApproverGuidance({ links }: { links: GovernanceFixLinks }) {
  const hasAny = links.canManageTeams || links.canManageApprovalGovernance;
  if (!hasAny) {
    return <p className="mb-3 text-xs text-gray-500">您目前沒有調整團隊主管或核准代理人設定的權限，請聯絡系統管理員協助完成設定。</p>;
  }
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {links.canManageTeams && (
        <Link href="/admin/teams" className={linkCls}>
          前往團隊管理
        </Link>
      )}
      {links.canManageApprovalGovernance && (
        <Link href="/settings/approval-governance" className={linkCls}>
          前往核准治理設定
        </Link>
      )}
    </div>
  );
}

export function ExecutionFieldsReadOnly({ fields, values, title }: { fields: readonly ExecutionFieldDef[]; values: Record<string, string>; title: string }) {
  const populated = fields.filter((field) => values[field.key]?.trim());
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {populated.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">尚未正式提交。</p>
      ) : (
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {populated.map((f) => (
          <div key={f.key}>
            <dt className="text-xs text-gray-400">{f.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{displayExecutionValue(values[f.key])}</dd>
          </div>
        ))}
      </dl>
      )}
    </section>
  );
}

export default function ExecutionFieldsForm({
  issueId,
  stageKey,
  title,
  fields,
  initialValues,
  saveAction,
  submitAction,
  submitLabel,
  governanceFixLinks,
}: {
  issueId: string;
  stageKey: string;
  title: string;
  fields: readonly ExecutionFieldDef[];
  initialValues: Record<string, string>;
  saveAction: (formData: FormData) => Promise<ActionResult>;
  submitAction: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  governanceFixLinks?: GovernanceFixLinks;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("stageKey", stageKey);
    for (const f of fields) fd.set(f.key, values[f.key] ?? "");
    return fd;
  }

  function run(action: (formData: FormData) => Promise<ActionResult>, successMsg?: string) {
    setError(null);
    setErrorCode(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action(buildFormData());
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      setSuccess(successMsg ?? result.message);
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <ActionErrorText message={error} />
      {errorCode === "NoEligibleApproverError" && governanceFixLinks && <NoApproverGuidance links={governanceFixLinks} />}
      <ActionSuccessText message={success} />
      <div className="mt-3 space-y-4">
        {fields.map((f) => (
          <div key={f.key}>
            <label className={labelCls}>
              {f.label}
              {f.required && <span className="ml-1 text-danger">*</span>}
            </label>
            {f.type === "textarea" ? (
              <textarea
                rows={3}
                disabled={isPending}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={inputCls}
              />
            ) : f.type === "select" ? (
              <select
                disabled={isPending}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={inputCls}
              >
                <option value="">請選擇</option>
                {f.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "datetime-local" ? "datetime-local" : "text"}
                disabled={isPending}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={inputCls}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(saveAction, "已暫存")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          暫存
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(submitAction)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {isPending ? "處理中…" : submitLabel}
        </button>
      </div>
    </section>
  );
}
