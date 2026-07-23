"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLES } from "@/lib/constants";
import { assignUserRoleAction, setUserActiveAction } from "@/lib/actions";

export default function UserRoleActions({
  userId,
  currentRole,
  isActive,
}: {
  userId: string;
  currentRole: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("role", e.target.value);
    startTransition(async () => {
      await assignUserRoleAction(fd);
      router.refresh();
    });
  }

  function onToggleActive() {
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("isActive", String(!isActive));
    startTransition(async () => {
      await setUserActiveAction(fd);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={currentRole}
        onChange={onRoleChange}
        disabled={isPending}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 focus:border-primary focus:outline-none"
      >
        {ROLES.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        onClick={onToggleActive}
        disabled={isPending}
        className={
          isActive
            ? "rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80 disabled:opacity-50"
            : "rounded-md border border-success-border bg-success-bg px-2 py-1 text-xs font-medium text-success-text hover:opacity-80 disabled:opacity-50"
        }
      >
        {isActive ? "停用" : "啟用"}
      </button>
    </div>
  );
}
