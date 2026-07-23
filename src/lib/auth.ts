import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
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

export async function requireAdmin(): Promise<User> {
  const user = await requireCurrentUser();
  if (user.role !== "Admin") redirect("/dashboard");
  return user;
}

export function roleKeyOf(user: User): RoleKey {
  return user.role as RoleKey;
}
