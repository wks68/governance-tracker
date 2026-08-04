"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { invalidateActorSession, serializeActorSession, SESSION_COOKIE_NAME } from "./auth";

export type LoginActionResult =
  | { ok: true }
  | { ok: false; message: string };

const LOGIN_REQUEST_FAILED_MESSAGE = "登入請求無法完成，請重新整理頁面後再試一次。";

function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

// MVP 未串接企業 SSO：以「選擇帳號登入」模擬使用者驗證。
// 登入後 Session 僅保存 userId，角色與權限一律由伺服器端即時查詢資料庫決定。
export async function loginAsUserAction(formData: FormData): Promise<LoginActionResult> {
  try {
    const userId = String(formData.get("userId") || "");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      return { ok: false, message: "該帳號已被停用或不存在，請聯繫系統管理員。" };
    }

    const lastLoginAt = new Date();
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt } });
    cookies().set(SESSION_COOKIE_NAME, serializeActorSession(user.id, lastLoginAt), sessionCookieOptions());
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    // 保留真正 server log，畫面只顯示可操作的業務訊息，不外洩 Prisma／Next 內部錯誤。
    console.error("loginAsUserAction 執行失敗：", error);
    return { ok: false, message: LOGIN_REQUEST_FAILED_MESSAGE };
  }
}

// 無 JavaScript 時的 progressive fallback。一般瀏覽器由 LoginUserForm 的 submit handler
// 呼叫 loginAsUserAction 並顯示頁內錯誤；此入口維持 <form action> 所需的 Promise<void>。
export async function loginAsUserProgressiveAction(formData: FormData): Promise<void> {
  const result = await loginAsUserAction(formData);
  if (!result.ok) redirect("/login?error=request");
  redirect("/governance");
}

export async function logoutAction(): Promise<void> {
  await invalidateActorSession(cookies().get(SESSION_COOKIE_NAME)?.value);
  cookies().set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
  revalidatePath("/", "layout");
}

export async function logoutProgressiveAction(): Promise<void> {
  await logoutAction();
  redirect("/login");
}
