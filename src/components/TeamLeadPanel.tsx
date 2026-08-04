"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "./Drawer";
import ConfirmButton from "./ConfirmButton";
import { assignTeamLeadAction, removeTeamLeadAction } from "@/lib/approvalGovernanceActions";
import { ActionErrorText } from "@/components/ActionResultBanner";

// M1.5-B2：設定／移除 Team LEAD 的操作面板。純 UI——「目標必須已是啟用中成員」
// 「reasonCode 必填」等規則全部由 approvalGovernanceActions.ts 呼叫的服務層檢查。

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";

export function TeamLeadManagePanel({
  teamId,
  userId,
  userName,
  currentRole,
}: {
  teamId: string;
  userId: string;
  userName: string;
  currentRole: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const isLead = currentRole === "LEAD";
  const action = isLead ? removeTeamLeadAction : assignTeamLeadAction;

  function submit() {
    const formEl = formRef.current;
    if (!formEl) return;
    setError(null);
    const formData = new FormData(formEl);
    startTransition(async () => {
      try {
        await action(formData);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "發生未預期錯誤");
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
        className={
          isLead
            ? "rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80"
            : "rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        }
      >
        {isLead ? "移除 LEAD" : "設為 LEAD"}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={isLead ? `移除 LEAD：${userName}` : `設為 LEAD：${userName}`}
        isSubmitting={isPending}
      >
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={error} />
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="userId" value={userId} />
          <div>
            <label className={labelClass}>原因（必填）</label>
            <textarea name="reasonCode" required rows={2} disabled={isPending} className={inputClass} />
          </div>
          <ConfirmButton label={isLead ? "移除 LEAD" : "設為 LEAD"} confirmLabel="確定？" disabled={isPending} onConfirm={submit} />
        </form>
      </Drawer>
    </>
  );
}
