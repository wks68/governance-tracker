"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import ConfirmButton from "@/components/ConfirmButton";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { addTeamMemberAction, removeTeamMemberAction } from "@/app/admin/teams/actions";

// M1.5-C1-C 新增：新增／移除 TeamMember 面板。純 UI——目標必須 active、LEAD 必須先走
// removeTeamLead、候選人歸零 blocking 等規則全部由 addTeamMember／removeTeamMember
// 服務層檢查，這裡只負責組 FormData、顯示服務層回傳的訊息。
export interface CandidateUser {
  id: string;
  name: string;
  email: string;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";

export function AddTeamMemberDrawer({ teamId, candidates }: { teamId: string; candidates: CandidateUser[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await addTeamMemberAction(formData);
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
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
      >
        ＋ 新增成員
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="新增成員" isSubmitting={isPending}>
        <form onSubmit={onSubmit} className="space-y-3">
          <ActionErrorText message={error} />
          <input type="hidden" name="teamId" value={teamId} />
          <div>
            <label className={labelClass}>使用者（僅列出 active 且尚未加入此 Team 的使用者）</label>
            <select name="userId" required disabled={isPending} defaultValue="" className={inputClass}>
              <option value="" disabled>
                請選擇
              </option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}（{u.email}）
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
            {isPending ? "送出中…" : "新增"}
          </button>
        </form>
      </Drawer>
    </>
  );
}

export function RemoveTeamMemberButton({ teamId, userId, userName, isLead }: { teamId: string; userId: string; userName: string; isLead: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit() {
    const formEl = formRef.current;
    if (!formEl) return;
    setError(null);
    const formData = new FormData(formEl);
    startTransition(async () => {
      const result = await removeTeamMemberAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (isLead) {
    return <span className="text-xs text-gray-400">LEAD 必須先移除 LEAD 資格</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80"
      >
        移除
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={`移除成員：${userName}`} isSubmitting={isPending}>
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={error} />
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="userId" value={userId} />
          <ReasonCodeField disabled={isPending} />
          <ConfirmButton label="移除成員" confirmLabel="確定移除？" disabled={isPending} onConfirm={submit} />
        </form>
      </Drawer>
    </>
  );
}
