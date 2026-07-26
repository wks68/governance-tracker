import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getUserHasCapability } from "./permissions";
import type { RoleKey } from "./constants";
import type { User } from "@prisma/client";

const SESSION_COOKIE = "dms_session_user_id";

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

// 目前登入使用者僅由 Session Cookie 內的 userId 決定；
// 角色、姓名、啟用狀態一律即時查詢資料庫，前端無法自行覆寫。
export async function getCurrentUser(): Promise<User | null> {
  const id = cookies().get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || !user.isActive) return null;
  return user;
}

export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// C1-B2：Admin 判斷改用 admin.full Capability（只讀 active UserRole），不得再用
// User.role === "Admin" 判斷——User.role 自本次起只作 primary role 顯示快取。
// getCurrentUser 內的 User.isActive 檢查（見上方 requireCurrentUser）維持不變。
export async function requireAdmin(): Promise<User> {
  const user = await requireCurrentUser();
  if (!(await getUserHasCapability(user, "admin.full"))) redirect("/dashboard");
  return user;
}

export function roleKeyOf(user: User): RoleKey {
  return user.role as RoleKey;
}
