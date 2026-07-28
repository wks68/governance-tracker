"use client";

// Hotfix 九階段 UI：RD／QA／OP 執行頁（stage3／5／7／OP 上版結果）共用的欄位表單。
// readOnly=true 時（主管簽核頁「本關資訊」區塊、或非目前責任角色時）改為純唯讀清單，
// 兩種模式共用同一份欄位定義與版面，避免各頁各自重複刻一份。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText, ActionSuccessText } from "@/components/ActionResultBanner";
import type { ExecutionFieldDef } from "@/lib/hotfix-ui/executionFields";
import type { ActionResult } from "@/lib/actionResult";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export function ExecutionFieldsReadOnly({ fields, values, title }: { fields: readonly ExecutionFieldDef[]; values: Record<string, string>; title: string }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <dl className="mt-3 space-y-3">
        {fields.map((f) => (
          <div key={f.key}>
            <dt className="text-xs text-gray-400">{f.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{values[f.key] || "（未填寫）"}</dd>
          </div>
        ))}
      </dl>
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
}: {
  issueId: string;
  stageKey: string;
  title: string;
  fields: readonly ExecutionFieldDef[];
  initialValues: Record<string, string>;
  saveAction: (formData: FormData) => Promise<ActionResult>;
  submitAction: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [error, setError] = useState<string | null>(null);
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
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <ActionErrorText message={error} />
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
