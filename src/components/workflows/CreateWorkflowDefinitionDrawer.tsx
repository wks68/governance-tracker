"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { ISSUE_TYPES } from "@/lib/constants";
import { createWorkflowDefinitionAction } from "@/app/admin/workflows/actions";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";

// M2-A3 新增：新增 Workflow 定義表單。與人員模組的 CreatePersonDrawer 同一 UI 慣例。
export default function CreateWorkflowDefinitionDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createWorkflowDefinitionAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      if (result.data?.id) {
        router.push(`/admin/workflows/${result.data.id}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover"
      >
        ＋ 新增 Workflow 定義
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="新增 Workflow 定義" isSubmitting={isPending}>
        <form onSubmit={onSubmit} className="space-y-3">
          <ActionErrorText message={error} />
          <div>
            <label className={labelClass}>key（唯一識別碼，例如 hotfix-v1）</label>
            <input type="text" name="key" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>名稱</label>
            <input type="text" name="name" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>說明（選填）</label>
            <textarea name="description" rows={2} disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>工單類型</label>
            <select name="issueType" required disabled={isPending} defaultValue="" className={inputClass}>
              <option value="" disabled>
                請選擇
              </option>
              {ISSUE_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <ReasonCodeField disabled={isPending} />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "送出中…" : "建立"}
          </button>
        </form>
      </Drawer>
    </>
  );
}
