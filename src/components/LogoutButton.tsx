"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutAction } from "@/lib/authActions";

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
      onClick={onClick}
      disabled={isPending}
      className="text-sm font-medium text-gray-500 hover:text-primary disabled:opacity-50"
    >
      登出
    </button>
  );
}
