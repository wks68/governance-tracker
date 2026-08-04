"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import ConfirmButton from "@/components/ConfirmButton";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { assignTeamLeadAction, removeTeamLeadAction } from "@/app/admin/teams/actions";

// M1.5-C1-C 新增：設定／移除 Team LEAD 面板（沿用既有 teamLeadService，不重新實作
// membershipRole 切換規則）。與 src/components/TeamLeadPanel.tsx 的差異：改回傳
// ActionResult 而非 throw，供本次 C1-C 新頁面統一使用。
export default function TeamLeadManager({
  teamId,
  userId,
  userName,
  membershipRole,
}: {
  teamId: string;
  userId: string;
  userName: string;
  membershipRole: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const isLead = membershipRole === "LEAD";
  const action = isLead ? removeTeamLeadAction : assignTeamLeadAction;

  function submit() {
    const formEl = formRef.current;
    if (!formEl) return;
    setError(null);
    const formData = new FormData(formEl);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
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
      <Drawer open={open} onClose={() => setOpen(false)} title={isLead ? `移除 LEAD：${userName}` : `設為 LEAD：${userName}`} isSubmitting={isPending}>
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={error} />
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="userId" value={userId} />
          <ReasonCodeField disabled={isPending} />
          <ConfirmButton label={isLead ? "移除 LEAD" : "設為 LEAD"} confirmLabel="確定？" disabled={isPending} onConfirm={submit} />
        </form>
      </Drawer>
    </>
  );
}
