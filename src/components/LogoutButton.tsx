"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutAction } from "@/lib/authActions";
import { LogOut } from "lucide-react";

export default function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      await logoutAction();
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={isPending}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-text-secondary hover:bg-primary-muted hover:text-primary disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {isPending ? "登出中…" : "登出"}
    </button>
  );
}
