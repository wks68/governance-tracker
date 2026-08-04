"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "./Drawer";
import ConfirmButton from "./ConfirmButton";
import {
  createSupervisorAssignmentAction,
  endSupervisorAssignmentAction,
  cancelScheduledSupervisorAssignmentAction,
  replaceSupervisorAssignmentAction,
} from "@/lib/approvalGovernanceActions";
import { ActionErrorText } from "@/components/ActionResultBanner";

// M1.5-B2：主管指派的新增／終止／取消排程／更換操作面板。純 UI，不做任何規則判斷——
// 重疊、循環、reasonCode 必填等全部由 approvalGovernanceActions.ts 呼叫的服務層檢查，
// 這裡只負責組 FormData、呼叫 Action、顯示伺服器回傳的錯誤訊息。

export interface UserOption {
  id: string;
  name: string;
}

export interface CurrentAssignmentInfo {
  id: string;
  supervisorUserId: string;
  validFrom: string; // yyyy-mm-dd，供 <input type=date> 顯示用
  isFuture: boolean; // 目前時間點是否尚未生效
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";
const submitClass =
  "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

function ErrorText({ error }: { error: string | null }) {
  return <ActionErrorText message={error} />;
}

export function CreateSupervisorAssignmentPanel({ users }: { users: UserOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createSupervisorAssignmentAction(formData);
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
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
      >
        ＋ 新增／排定主管指派
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="新增／排定主管指派" isSubmitting={isPending}>
        <form onSubmit={onSubmit} className="space-y-3">
          <ErrorText error={error} />
          <div>
            <label className={labelClass}>使用者</label>
            <select name="userId" required disabled={isPending} className={inputClass}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>主管</label>
            <select name="supervisorUserId" required disabled={isPending} className={inputClass}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>生效日期（validFrom，可為未來日期以排定未來生效）</label>
            <input type="date" name="validFrom" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>終止日期（validUntil，選填）</label>
            <input type="date" name="validUntil" disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>原因（必填）</label>
            <textarea name="reasonCode" required rows={2} disabled={isPending} className={inputClass} />
          </div>
          <button type="submit" disabled={isPending} className={submitClass}>
            {isPending ? "送出中…" : "建立"}
          </button>
        </form>
      </Drawer>
    </>
  );
}

export function ManageSupervisorAssignmentPanel({
  targetUserId,
  current,
  users,
}: {
  targetUserId: string;
  current: CurrentAssignmentInfo | null;
  users: UserOption[];
}) {
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState<"replace" | "end" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const replaceFormRef = useRef<HTMLFormElement>(null);
  const endFormRef = useRef<HTMLFormElement>(null);
  const cancelFormRef = useRef<HTMLFormElement>(null);

  function runFormAction(action: (fd: FormData) => Promise<void>, formEl: HTMLFormElement | null) {
    if (!formEl) return;
    setError(null);
    const formData = new FormData(formEl);
    startTransition(async () => {
      try {
        await action(formData);
        setOpenDrawer(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "發生未預期錯誤");
      }
    });
  }

  if (!current) {
    return <span className="text-xs text-gray-400">尚無主管指派，請使用上方「新增／排定主管指派」</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpenDrawer("replace");
        }}
        disabled={isPending}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        更換主管
      </button>
      {current.isFuture ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpenDrawer("cancel");
          }}
          disabled={isPending}
          className="rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          取消排程
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpenDrawer("end");
          }}
          disabled={isPending}
          className="rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          終止
        </button>
      )}

      <Drawer open={openDrawer === "replace"} onClose={() => setOpenDrawer(null)} title="更換主管" isSubmitting={isPending}>
        <form
          ref={replaceFormRef}
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="space-y-3"
        >
          <ErrorText error={error} />
          <input type="hidden" name="oldAssignmentId" value={current.id} />
          <div>
            <label className={labelClass}>新主管</label>
            <select name="newSupervisorUserId" required disabled={isPending} className={inputClass} defaultValue="">
              <option value="" disabled>
                請選擇
              </option>
              {users
                .filter((u) => u.id !== targetUserId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>生效日期（effectiveAt）</label>
            <input type="date" name="effectiveAt" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>原因（必填）</label>
            <textarea name="reasonCode" required rows={2} disabled={isPending} className={inputClass} />
          </div>
          <ConfirmButton
            label="更換主管"
            confirmLabel="確定更換？"
            disabled={isPending}
            onConfirm={() => runFormAction(replaceSupervisorAssignmentAction, replaceFormRef.current)}
          />
        </form>
      </Drawer>

      <Drawer open={openDrawer === "end"} onClose={() => setOpenDrawer(null)} title="終止主管指派" isSubmitting={isPending}>
        <form
          ref={endFormRef}
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="space-y-3"
        >
          <ErrorText error={error} />
          <input type="hidden" name="assignmentId" value={current.id} />
          <div>
            <label className={labelClass}>終止日期（endAt）</label>
            <input type="date" name="endAt" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>原因（必填）</label>
            <textarea name="reasonCode" required rows={2} disabled={isPending} className={inputClass} />
          </div>
          <ConfirmButton
            label="終止"
            confirmLabel="確定終止？"
            disabled={isPending}
            onConfirm={() => runFormAction(endSupervisorAssignmentAction, endFormRef.current)}
          />
        </form>
      </Drawer>

      <Drawer open={openDrawer === "cancel"} onClose={() => setOpenDrawer(null)} title="取消尚未生效的排程" isSubmitting={isPending}>
        <form
          ref={cancelFormRef}
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="space-y-3"
        >
          <ErrorText error={error} />
          <input type="hidden" name="assignmentId" value={current.id} />
          <div>
            <label className={labelClass}>原因（必填）</label>
            <textarea name="reasonCode" required rows={2} disabled={isPending} className={inputClass} />
          </div>
          <ConfirmButton
            label="取消排程"
            confirmLabel="確定取消？"
            disabled={isPending}
            onConfirm={() => runFormAction(cancelScheduledSupervisorAssignmentAction, cancelFormRef.current)}
          />
        </form>
      </Drawer>
    </div>
  );
}
