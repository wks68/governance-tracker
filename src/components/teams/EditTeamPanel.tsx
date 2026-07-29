"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText, ActionSuccessText } from "@/components/ActionResultBanner";
import { updateTeamAction, deleteTeamAction, setTeamActiveStateAction } from "@/app/admin/teams/actions";
import ConfirmButton from "@/components/ConfirmButton";

export default function EditTeamPanel({
  teamId,
  initialName,
  initialDescription,
  canDelete,
  isActive,
}: {
  teamId: string;
  initialName: string;
  initialDescription: string;
  canDelete: boolean;
  isActive: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("teamId", teamId);
    fd.set("name", name);
    fd.set("description", description);
    startTransition(async () => {
      const result = await updateTeamAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
    });
  }

  // 停用只讓團隊無法承接新工作（建立工單選項／接單資格），不刪除任何既有資料。
  function toggleActive() {
    setToggleError(null);
    const fd = new FormData();
    fd.set("teamId", teamId);
    fd.set("isActive", String(!isActive));
    fd.set("reasonCode", isActive ? "TEAM_DEACTIVATED_BY_ADMIN" : "TEAM_ACTIVATED_BY_ADMIN");
    startTransition(async () => {
      const result = await setTeamActiveStateAction(fd);
      if (!result.ok) {
        setToggleError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    setDeleteError(null);
    const fd = new FormData();
    fd.set("teamId", teamId);
    startTransition(async () => {
      const result = await deleteTeamAction(fd);
      if (result && !result.ok) setDeleteError(result.message);
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">團隊設定</h2>
      <ActionErrorText message={error} />
      <ActionSuccessText message={success} />
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">團隊名稱</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">說明</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isPending}
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={save}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "儲存中…" : "儲存"}
        </button>
        <ConfirmButton
          label={isActive ? "停用團隊" : "啟用團隊"}
          confirmLabel={isActive ? "確定停用？停用後無法承接新工單" : "確定啟用？"}
          disabled={isPending}
          onConfirm={toggleActive}
        />
        {canDelete ? (
          <ConfirmButton label="永久刪除團隊" confirmLabel="確定永久刪除？" disabled={isPending} onConfirm={remove} />
        ) : (
          <span className="text-xs text-gray-400">此團隊已被工單、成員歷程或核准紀錄引用，無法永久刪除。</span>
        )}
      </div>
      {toggleError && <p className="text-xs text-danger-text">{toggleError}</p>}
      {deleteError && <p className="text-xs text-danger-text">{deleteError}</p>}
    </section>
  );
}
