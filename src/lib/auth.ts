import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getUserHasCapability } from "./permissions";
import type { RoleKey } from "./constants";
import type { User } from "@prisma/client";

const SESSION_COOKIE = "dms_session_user_id";
const SESSION_SEPARATOR = ".";

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export interface ActorSessionIdentifier {
  actorId: string;
  version: number;
}

// Session 保存唯一 User.id 與可撤銷版本；版本使用既有 lastLoginAt，不新增資料模型。
// 每次登入都會換版，登出則清空對應版本，因此舊 cookie 無法在伺服器端繼續還原 actor。
export function serializeActorSession(actorId: string, lastLoginAt: Date): string {
  return `${actorId}${SESSION_SEPARATOR}${lastLoginAt.getTime()}`;
}

export function parseActorSession(value: string | undefined): ActorSessionIdentifier | null {
  if (!value) return null;
  const separatorIndex = value.lastIndexOf(SESSION_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const actorId = value.slice(0, separatorIndex);
  const versionText = value.slice(separatorIndex + 1);
  if (!/^\d+$/.test(versionText)) return null;
  const version = Number(versionText);
  if (!Number.isSafeInteger(version) || version <= 0) return null;
  return { actorId, version };
}

export async function resolveActorSessionUser(value: string | undefined): Promise<User | null> {
  const session = parseActorSession(value);
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.actorId } });
  if (!user || !user.isActive || user.lastLoginAt?.getTime() !== session.version) return null;
  return user;
}

export async function invalidateActorSession(value: string | undefined): Promise<boolean> {
  const session = parseActorSession(value);
  if (!session) return false;
  const result = await prisma.user.updateMany({
    where: { id: session.actorId, lastLoginAt: new Date(session.version) },
    data: { lastLoginAt: null },
  });
  return result.count === 1;
}

// 目前登入使用者僅由 Session Cookie 內的 userId 決定；
// 角色、姓名、啟用狀態一律即時查詢資料庫，前端無法自行覆寫。
export async function getCurrentUser(): Promise<User | null> {
  return resolveActorSessionUser(cookies().get(SESSION_COOKIE)?.value);
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
  if (!(await getUserHasCapability(user, "admin.full"))) redirect("/governance");
  return user;
}

export function roleKeyOf(user: User): RoleKey {
  return user.role as RoleKey;
}
