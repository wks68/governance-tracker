"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "./ReasonCodeField";
import { ROLES } from "@/lib/constants";
import { createPersonAction } from "@/app/admin/people/actions";

// M1.5-C1-C 新增：新增人員表單。initialRole／reasonCode 必填；不曝露 isBreakGlassAdmin／
// isActive／disabledAt／disabledByUserId 等欄位——這些一律由服務層依規則決定，不接受
// UI 呼叫端指定。
const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";

export default function CreatePersonDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createPersonAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      if (result.data?.id) {
        router.push(`/admin/people/${result.data.id}`);
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
        ＋ 新增人員
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="新增人員" isSubmitting={isPending}>
        <form onSubmit={onSubmit} className="space-y-3">
          <ActionErrorText message={error} />
          <div>
            <label className={labelClass}>姓名</label>
            <input type="text" name="name" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" name="email" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>部門</label>
            <input type="text" name="department" disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>loginIdentifier（選填）</label>
            <input type="text" name="loginIdentifier" disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>初始角色</label>
            <select name="initialRole" required disabled={isPending} defaultValue="" className={inputClass}>
              <option value="" disabled>
                請選擇
              </option>
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
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
