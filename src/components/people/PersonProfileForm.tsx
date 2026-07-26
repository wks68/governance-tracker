"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText, ActionSuccessText } from "@/components/ActionResultBanner";
import ReasonCodeField from "./ReasonCodeField";
import { updatePersonProfileAction } from "@/app/admin/people/actions";

// M1.5-C1-C 新增：Profile 編輯表單。只允許 name／department／loginIdentifier；
// User.role／isActive／isBreakGlassAdmin／disabledAt 等一律不在此表單出現，
// 對應規則（no-op 不寫 AuditLog）完全由 updatePersonProfile 服務層決定，本表單不猜測。
const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";

export default function PersonProfileForm({
  userId,
  initialName,
  initialDepartment,
  initialLoginIdentifier,
}: {
  userId: string;
  initialName: string;
  initialDepartment: string;
  initialLoginIdentifier: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updatePersonProfileAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">基本資料編輯</h3>
      <form onSubmit={onSubmit} className="space-y-3">
        <ActionErrorText message={error} />
        <ActionSuccessText message={success} />
        <input type="hidden" name="userId" value={userId} />
        <div>
          <label className={labelClass}>姓名</label>
          <input type="text" name="name" defaultValue={initialName} required disabled={isPending} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>部門</label>
          <input type="text" name="department" defaultValue={initialDepartment} disabled={isPending} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>loginIdentifier</label>
          <input
            type="text"
            name="loginIdentifier"
            defaultValue={initialLoginIdentifier ?? ""}
            disabled={isPending}
            className={inputClass}
          />
        </div>
        <ReasonCodeField disabled={isPending} />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "送出中…" : "儲存"}
        </button>
      </form>
    </div>
  );
}
