"use client";

import { FormEvent, useState, useTransition } from "react";
import {
  loginAsUserAction,
  loginAsUserProgressiveAction,
} from "@/lib/authActions";
import { ActionErrorText } from "@/components/ActionResultBanner";

const LOGIN_REQUEST_FAILED_MESSAGE = "登入請求無法完成，請重新整理頁面後再試一次。";

export default function LoginUserForm({
  userId,
  name,
  detail,
}: {
  userId: string;
  name: string;
  detail: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      try {
        const result = await loginAsUserAction(formData);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        // Session actor 已更換，必須重新載入整棵 Server Component／Root Layout，避免
        // App Router 沿用上一位使用者的 Topbar、Sidebar、待辦或建立範圍快取。
        window.location.replace("/governance");
      } catch (actionError) {
        // Server Action 在送達 action 前就被 proxy／Origin 驗證拒絕時仍會 reject；
        // 捕捉後顯示頁內訊息，console 保留診斷線索，不產生未處理的 Runtime Error。
        console.error("登入 Server Action request 失敗：", actionError);
        setError(LOGIN_REQUEST_FAILED_MESSAGE);
      }
    });
  }

  return (
    <form
      action={loginAsUserProgressiveAction}
      onSubmit={handleSubmit}
      className="p-4"
    >
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-gray-900">{name}</div>
          <div className="text-xs text-gray-500">{detail}</div>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {isPending ? "登入中…" : "登入"}
        </button>
      </div>
      <ActionErrorText message={error} title="登入失敗" />
    </form>
  );
}
