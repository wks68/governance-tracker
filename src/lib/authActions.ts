"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { SESSION_COOKIE_NAME } from "./auth";

// MVP 未串接企業 SSO：以「選擇帳號登入」模擬使用者驗證。
// 登入後 Session 僅保存 userId，角色與權限一律由伺服器端即時查詢資料庫決定。
export async function loginAsUserAction(formData: FormData) {
  const userId = String(formData.get("userId") || "");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    redirect("/login?error=inactive");
  }

  cookies().set(SESSION_COOKIE_NAME, user.id, { path: "/", httpOnly: true });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  redirect("/governance");
}

export async function logoutAction() {
  cookies().delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
