"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import ConfirmButton from "@/components/ConfirmButton";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "./ReasonCodeField";
import { ROLES, roleLabel } from "@/lib/constants";
import { assignSystemRoleAction, updatePrimaryRoleAction, removeSystemRoleAction } from "@/app/admin/people/actions";

// M1.5-C1-C 新增：系統角色管理面板。
//
// UI 只預先顯示提示（例如不給主要角色顯示移除按鈕），實際 blocking 規則（最後一個
// active 角色／最後一位有效 Admin／Break-glass Admin 的 Admin 角色…）一律由
// removeSystemRole／updatePrimaryRole 服務層決定，這裡不做任何猜測或攔截。
export interface RoleRow {
  id: string;
  role: string;
  isActive: boolean;
}

type DrawerState = { kind: "assign" } | { kind: "makePrimary"; role: string } | { kind: "remove"; role: string } | { kind: "reactivate"; role: string } | null;

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";

export default function PersonRoleManager({
  userId,
  primaryRole,
  roles,
  canAssignRole,
  canRemoveRole,
}: {
  userId: string;
  primaryRole: string;
  roles: RoleRow[];
  canAssignRole: boolean;
  canRemoveRole: boolean;
}) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const existingRoleKeys = new Set(roles.map((r) => r.role));
  const assignableNewRoles = ROLES.filter((r) => !existingRoleKeys.has(r.key));

  function runAction(action: (fd: FormData) => Promise<{ ok: boolean; message: string }>) {
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
      setDrawer(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">系統角色</h3>
        {canAssignRole && assignableNewRoles.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setDrawer({ kind: "assign" });
            }}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            ＋ 指派新角色
          </button>
        )}
      </div>

      <ul className="divide-y divide-gray-100">
        {roles.map((r) => {
          const isPrimary = r.role === primaryRole;
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-800">{roleLabel(r.role)}</span>
                {isPrimary && <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[11px] font-medium text-primary">主要</span>}
                <span
                  className={
                    r.isActive
                      ? "rounded-full bg-success-bg px-1.5 py-0.5 text-[11px] font-medium text-success-text"
                      : "rounded-full bg-secondary-bg px-1.5 py-0.5 text-[11px] font-medium text-secondary-text"
                  }
                >
                  {r.isActive ? "active" : "inactive"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {r.isActive && !isPrimary && canAssignRole && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setDrawer({ kind: "makePrimary", role: r.role });
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    設為主要角色
                  </button>
                )}
                {r.isActive && !isPrimary && canRemoveRole && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setDrawer({ kind: "remove", role: r.role });
                    }}
                    className="rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80"
                  >
                    移除
                  </button>
                )}
                {!r.isActive && canAssignRole && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setDrawer({ kind: "reactivate", role: r.role });
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    重新啟用
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Drawer open={drawer?.kind === "assign"} onClose={() => setDrawer(null)} title="指派新角色" isSubmitting={isPending}>
        <form ref={drawer?.kind === "assign" ? formRef : undefined} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={error} />
          <input type="hidden" name="userId" value={userId} />
          <div>
            <label className={labelClass}>角色</label>
            <select name="role" required disabled={isPending} defaultValue="" className={inputClass}>
              <option value="" disabled>
                請選擇
              </option>
              {assignableNewRoles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <ReasonCodeField disabled={isPending} />
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction(assignSystemRoleAction)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "送出中…" : "指派"}
          </button>
        </form>
      </Drawer>

      <Drawer
        open={drawer?.kind === "makePrimary"}
        onClose={() => setDrawer(null)}
        title={drawer?.kind === "makePrimary" ? `設為主要角色：${roleLabel(drawer.role)}` : ""}
        isSubmitting={isPending}
      >
        <form ref={drawer?.kind === "makePrimary" ? formRef : undefined} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={error} />
          <input type="hidden" name="userId" value={userId} />
          {drawer?.kind === "makePrimary" && <input type="hidden" name="role" value={drawer.role} />}
          <ReasonCodeField disabled={isPending} />
          <ConfirmButton
            label="設為主要角色"
            confirmLabel="確定？"
            disabled={isPending}
            onConfirm={() => runAction(updatePrimaryRoleAction)}
          />
        </form>
      </Drawer>

      <Drawer
        open={drawer?.kind === "remove"}
        onClose={() => setDrawer(null)}
        title={drawer?.kind === "remove" ? `移除角色：${roleLabel(drawer.role)}` : ""}
        isSubmitting={isPending}
      >
        <form ref={drawer?.kind === "remove" ? formRef : undefined} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={error} />
          <input type="hidden" name="userId" value={userId} />
          {drawer?.kind === "remove" && <input type="hidden" name="role" value={drawer.role} />}
          <ReasonCodeField disabled={isPending} />
          <ConfirmButton label="移除角色" confirmLabel="確定移除？" disabled={isPending} onConfirm={() => runAction(removeSystemRoleAction)} />
        </form>
      </Drawer>

      <Drawer
        open={drawer?.kind === "reactivate"}
        onClose={() => setDrawer(null)}
        title={drawer?.kind === "reactivate" ? `重新啟用角色：${roleLabel(drawer.role)}` : ""}
        isSubmitting={isPending}
      >
        <form ref={drawer?.kind === "reactivate" ? formRef : undefined} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={error} />
          <input type="hidden" name="userId" value={userId} />
          {drawer?.kind === "reactivate" && <input type="hidden" name="role" value={drawer.role} />}
          <ReasonCodeField disabled={isPending} />
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction(assignSystemRoleAction)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "送出中…" : "重新啟用"}
          </button>
        </form>
      </Drawer>
    </div>
  );
}
