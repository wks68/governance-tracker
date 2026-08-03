import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import LoginUserForm from "./LoginUserForm";
import { ActionErrorText } from "@/components/ActionResultBanner";

export const dynamic = "force-dynamic";

const DEFAULT_POST_LOGIN_ROUTE = "/governance";

// 只允許站內相對路徑；不是以單一 "/" 開頭、以 "//" 開頭或含 "://" 一律視為不安全，
// 回正式首頁，避免 Open Redirect。
function safePostLoginRoute(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("://")) {
    return DEFAULT_POST_LOGIN_ROUTE;
  }
  return value;
}

export default async function LoginPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  // 已登入使用者（含重新整理／瀏覽器上一頁回到 /login）一律在 Server Render 前導向正式
  // 首頁，不得先送出登入名單再由 Client 跳轉——getCurrentUser 已即時查詢 active session，
  // 未登入或帳號已停用時回傳 null，維持既有 Session 語意，不另建第二套判斷。
  const currentUser = await getCurrentUser();
  if (currentUser) {
    redirect(safePostLoginRoute(searchParams.next));
  }

  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: {
      userRoles: { where: { isActive: true }, orderBy: { createdAt: "asc" } },
      teamMemberships: { where: { isActive: true }, include: { team: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-10">
      <div>
        <h1 className="text-xl font-bold text-gray-900">DMS Governance Tracker 登入</h1>
        <p className="mt-1 text-sm text-gray-500">
          MVP 版本尚未串接企業 SSO，請選擇您的帳號登入。角色與權限由系統管理員於「使用者與角色」設定，登入後無法自行變更。
        </p>
        <ActionErrorText
          message={
            searchParams.error === "inactive"
              ? "該帳號已被停用或不存在，請聯繫系統管理員。"
              : searchParams.error === "request"
                ? "登入請求無法完成，請重新整理頁面後再試一次。"
                : null
          }
          code={searchParams.error === "inactive" ? "LOGIN_INACTIVE" : searchParams.error === "request" ? "LOGIN_REQUEST_FAILED" : undefined}
          title="登入失敗"
        />
      </div>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {users.map((u) => (
          <LoginUserForm
            key={u.id}
            userId={u.id}
            name={u.name}
            detail={`${u.email} · ${u.teamMemberships.map((membership) => membership.team.name).join("、") || "—"} · ${u.userRoles.map((role) => roleLabel(role.role)).join("、") || "未指派角色"}`}
          />
        ))}
        {users.length === 0 && <p className="p-4 text-sm text-gray-400">目前沒有已啟用的使用者，請聯繫系統管理員。</p>}
      </div>
    </div>
  );
}
