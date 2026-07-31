"use client";

import { FormEvent, useTransition } from "react";
import { logoutAction, logoutProgressiveAction } from "@/lib/authActions";
import { LogOut } from "lucide-react";

export default function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      await logoutAction();
      window.location.replace("/login");
    });
  }

  return (
    <form action={logoutProgressiveAction} onSubmit={onSubmit}>
      <button
        type="submit"
        role="menuitem"
        disabled={isPending}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-text-secondary hover:bg-primary-muted hover:text-primary disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {isPending ? "登出中…" : "登出"}
      </button>
    </form>
  );
}
