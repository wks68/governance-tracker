"use client";

// 成員管理權限收斂新增：團隊成員管理面板（新增／編輯／角色／直屬主管／啟停用／移除／永久刪除）。
//
// 純 UI：所有規則（可管理哪個團隊、不得授予 Admin、不得刪除自己、不得讓團隊沒有主管、
// 引用中不得永久刪除…）全部由服務層檢查，本元件只負責組 FormData 與顯示服務層回傳訊息。
// canManage=false 時完全不渲染任何操作按鈕（唯讀），但這不是授權機制——服務層仍會重驗。

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import ConfirmButton from "@/components/ConfirmButton";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import type { ActionResult } from "@/lib/actionResult";
import {
  createTeamMemberAction,
  updateTeamMemberProfileAction,
  changeTeamMemberRoleAction,
  setTeamMemberSupervisorAction,
  setTeamMemberActiveAction,
  permanentlyDeleteMemberAction,
} from "@/app/admin/teams/actions";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";
const smallButton = "rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50";

export interface RoleOption {
  key: string;
  label: string;
}

export interface SupervisorOption {
  id: string;
  name: string;
}

export interface ManagedMemberRow {
  userId: string;
  name: string;
  email: string;
  loginIdentifier: string | null;
  department: string;
  role: string;
  roleLabel: string;
  membershipRole: string;
  isActive: boolean;
  supervisorName: string | null;
}

interface PanelContext {
  teamId: string;
  teamName: string;
  /** 團隊主管操作時為 true：所屬團隊固定唯讀、直屬主管固定為自己、不得選 Admin 角色 */
  leadScoped: boolean;
  actorId: string;
  actorName: string;
  roleOptions: RoleOption[];
  supervisorOptions: SupervisorOption[];
}

function useDrawerForm(action: (fd: FormData) => Promise<ActionResult>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(formData: FormData) {
    setError(null);
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

  return { open, setOpen, error, setError, isPending, run };
}

// ---------------------------------------------------------------------------
// 新增成員
// ---------------------------------------------------------------------------

export function CreateMemberDrawer({ ctx }: { ctx: PanelContext }) {
  const form = useDrawerForm(createTeamMemberAction);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          form.setError(null);
          form.setOpen(true);
        }}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
      >
        ＋ 新增成員
      </button>
      <Drawer open={form.open} onClose={() => form.setOpen(false)} title="新增團隊成員" isSubmitting={form.isPending}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.run(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <ActionErrorText message={form.error} />
          <input type="hidden" name="teamId" value={ctx.teamId} />

          <div>
            <label className={labelClass}>姓名</label>
            <input name="name" required disabled={form.isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>電子郵件（系統唯一識別）</label>
            <input name="email" type="email" required disabled={form.isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>登入帳號（可留空）</label>
            <input name="loginIdentifier" disabled={form.isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>部門</label>
            <input name="department" disabled={form.isPending} className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>所屬團隊</label>
            {/* 團隊主管操作時固定為自己的團隊且唯讀（實際 teamId 由上方 hidden 欄位送出）。 */}
            <input value={ctx.teamName} readOnly disabled className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>角色</label>
            <select name="role" required disabled={form.isPending} defaultValue="" className={inputClass}>
              <option value="" disabled>
                請選擇
              </option>
              {ctx.roleOptions.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>直屬主管</label>
            {ctx.leadScoped ? (
              <>
                <input value={ctx.actorName} readOnly disabled className={inputClass} />
                <input type="hidden" name="supervisorUserId" value={ctx.actorId} />
              </>
            ) : (
              <select name="supervisorUserId" disabled={form.isPending} defaultValue="" className={inputClass}>
                <option value="">（暫不設定）</option>
                {ctx.supervisorOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className={labelClass}>啟用狀態</label>
            <select name="isActive" disabled={form.isPending} defaultValue="true" className={inputClass}>
              <option value="true">啟用</option>
              <option value="false">停用</option>
            </select>
          </div>

          <ReasonCodeField disabled={form.isPending} />
          <button
            type="submit"
            disabled={form.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.isPending ? "送出中…" : "新增成員"}
          </button>
        </form>
      </Drawer>
    </>
  );
}

// ---------------------------------------------------------------------------
// 每一列的操作
// ---------------------------------------------------------------------------

function EditProfileButton({ ctx, member }: { ctx: PanelContext; member: ManagedMemberRow }) {
  const form = useDrawerForm(updateTeamMemberProfileAction);
  return (
    <>
      <button type="button" className={smallButton} onClick={() => { form.setError(null); form.setOpen(true); }}>
        編輯
      </button>
      <Drawer open={form.open} onClose={() => form.setOpen(false)} title={`編輯成員：${member.name}`} isSubmitting={form.isPending}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.run(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <ActionErrorText message={form.error} />
          <input type="hidden" name="teamId" value={ctx.teamId} />
          <input type="hidden" name="userId" value={member.userId} />
          <div>
            <label className={labelClass}>姓名</label>
            <input name="name" defaultValue={member.name} required disabled={form.isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>登入帳號（可留空）</label>
            <input name="loginIdentifier" defaultValue={member.loginIdentifier ?? ""} disabled={form.isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>部門</label>
            <input name="department" defaultValue={member.department} disabled={form.isPending} className={inputClass} />
          </div>
          <ReasonCodeField disabled={form.isPending} />
          <button type="submit" disabled={form.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
            {form.isPending ? "送出中…" : "儲存"}
          </button>
        </form>
      </Drawer>
    </>
  );
}

function ChangeRoleButton({ ctx, member }: { ctx: PanelContext; member: ManagedMemberRow }) {
  const form = useDrawerForm(changeTeamMemberRoleAction);
  return (
    <>
      <button type="button" className={smallButton} onClick={() => { form.setError(null); form.setOpen(true); }}>
        角色
      </button>
      <Drawer open={form.open} onClose={() => form.setOpen(false)} title={`變更角色：${member.name}`} isSubmitting={form.isPending}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.run(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <ActionErrorText message={form.error} />
          <input type="hidden" name="teamId" value={ctx.teamId} />
          <input type="hidden" name="userId" value={member.userId} />
          <div>
            <label className={labelClass}>角色</label>
            <select name="role" required disabled={form.isPending} defaultValue={member.role} className={inputClass}>
              {ctx.roleOptions.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <ReasonCodeField disabled={form.isPending} />
          <button type="submit" disabled={form.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
            {form.isPending ? "送出中…" : "儲存"}
          </button>
        </form>
      </Drawer>
    </>
  );
}

function SetSupervisorButton({ ctx, member }: { ctx: PanelContext; member: ManagedMemberRow }) {
  const form = useDrawerForm(setTeamMemberSupervisorAction);
  return (
    <>
      <button type="button" className={smallButton} onClick={() => { form.setError(null); form.setOpen(true); }}>
        直屬主管
      </button>
      <Drawer open={form.open} onClose={() => form.setOpen(false)} title={`設定直屬主管：${member.name}`} isSubmitting={form.isPending}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.run(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <ActionErrorText message={form.error} />
          <input type="hidden" name="teamId" value={ctx.teamId} />
          <input type="hidden" name="userId" value={member.userId} />
          <div>
            <label className={labelClass}>直屬主管</label>
            {ctx.leadScoped ? (
              <>
                <input value={ctx.actorName} readOnly disabled className={inputClass} />
                <input type="hidden" name="supervisorUserId" value={ctx.actorId} />
              </>
            ) : (
              <select name="supervisorUserId" required disabled={form.isPending} defaultValue="" className={inputClass}>
                <option value="" disabled>
                  請選擇
                </option>
                {ctx.supervisorOptions
                  .filter((s) => s.id !== member.userId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
          <ReasonCodeField disabled={form.isPending} />
          <button type="submit" disabled={form.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
            {form.isPending ? "送出中…" : "儲存"}
          </button>
        </form>
      </Drawer>
    </>
  );
}

function ToggleActiveButton({ ctx, member }: { ctx: PanelContext; member: ManagedMemberRow }) {
  const form = useDrawerForm(setTeamMemberActiveAction);
  const formRef = useRef<HTMLFormElement>(null);
  const next = !member.isActive;
  const label = next ? "啟用成員" : "停用成員";

  return (
    <>
      <button type="button" className={smallButton} onClick={() => { form.setError(null); form.setOpen(true); }}>
        {label}
      </button>
      <Drawer open={form.open} onClose={() => form.setOpen(false)} title={`${label}：${member.name}`} isSubmitting={form.isPending}>
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={form.error} />
          <input type="hidden" name="teamId" value={ctx.teamId} />
          <input type="hidden" name="userId" value={member.userId} />
          <input type="hidden" name="isActive" value={String(next)} />
          <ReasonCodeField disabled={form.isPending} />
          <ConfirmButton
            label={label}
            confirmLabel={`確定${label}？`}
            disabled={form.isPending}
            onConfirm={() => formRef.current && form.run(new FormData(formRef.current))}
          />
        </form>
      </Drawer>
    </>
  );
}

function PermanentDeleteButton({ ctx, member }: { ctx: PanelContext; member: ManagedMemberRow }) {
  const form = useDrawerForm(permanentlyDeleteMemberAction);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <button
        type="button"
        className="rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80"
        onClick={() => { form.setError(null); form.setOpen(true); }}
      >
        永久刪除
      </button>
      <Drawer open={form.open} onClose={() => form.setOpen(false)} title={`永久刪除：${member.name}`} isSubmitting={form.isPending}>
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ActionErrorText message={form.error} />
          <p className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-text">
            永久刪除不可復原，且只有「完全未被任何工單、核准、稽核或歷史紀錄引用」的成員才能刪除。
            已有任何紀錄的成員請改用「停用成員」，以保留稽核軌跡。
          </p>
          <input type="hidden" name="teamId" value={ctx.teamId} />
          <input type="hidden" name="userId" value={member.userId} />
          <ReasonCodeField disabled={form.isPending} />
          <ConfirmButton
            label="永久刪除"
            confirmLabel="確定永久刪除？不可復原"
            disabled={form.isPending}
            onConfirm={() => formRef.current && form.run(new FormData(formRef.current))}
          />
        </form>
      </Drawer>
    </>
  );
}

// ---------------------------------------------------------------------------
// 成員清單
// ---------------------------------------------------------------------------

export function ManagedMemberTable({
  ctx,
  members,
  canManage,
  removeSlot,
}: {
  ctx: PanelContext;
  members: ManagedMemberRow[];
  canManage: boolean;
  removeSlot?: (member: ManagedMemberRow) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium text-gray-500">
            <th className="px-3 py-2">成員</th>
            <th className="px-3 py-2">登入帳號</th>
            <th className="px-3 py-2">角色</th>
            <th className="px-3 py-2">團隊身分</th>
            <th className="px-3 py-2">直屬主管</th>
            <th className="px-3 py-2">啟用狀態</th>
            {canManage && <th className="px-3 py-2">操作</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {members.map((m) => (
            <tr key={m.userId} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 text-gray-800">
                {m.name}
                <span className="ml-1 text-xs text-gray-400">{m.email}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.loginIdentifier || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.roleLabel}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.membershipRole === "LEAD" ? "主管" : "成員"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.supervisorName || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{m.isActive ? "啟用" : "停用"}</td>
              {canManage && (
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EditProfileButton ctx={ctx} member={m} />
                    <ChangeRoleButton ctx={ctx} member={m} />
                    <SetSupervisorButton ctx={ctx} member={m} />
                    <ToggleActiveButton ctx={ctx} member={m} />
                    {removeSlot?.(m)}
                    <PermanentDeleteButton ctx={ctx} member={m} />
                  </div>
                </td>
              )}
            </tr>
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={canManage ? 7 : 6} className="px-3 py-4 text-center text-xs text-gray-400">
                此團隊目前沒有成員
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export type { PanelContext };
