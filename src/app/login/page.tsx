import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/constants";
import LoginUserForm from "./LoginUserForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: { userRoles: { where: { isActive: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-10">
      <div>
        <h1 className="text-xl font-bold text-gray-900">DMS Governance Tracker 登入</h1>
        <p className="mt-1 text-sm text-gray-500">
          MVP 版本尚未串接企業 SSO，請選擇您的帳號登入。角色與權限由系統管理員於「使用者與角色」設定，登入後無法自行變更。
        </p>
        {searchParams.error === "inactive" && (
          <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">
            該帳號已被停用或不存在，請聯繫系統管理員。
          </p>
        )}
        {searchParams.error === "request" && (
          <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">
            登入請求無法完成，請重新整理頁面後再試一次。
          </p>
        )}
      </div>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {users.map((u) => (
          <LoginUserForm
            key={u.id}
            userId={u.id}
            name={u.name}
            detail={`${u.email} · ${u.department || "—"} · ${u.userRoles.map((role) => roleLabel(role.role)).join("、") || "未指派角色"}`}
          />
        ))}
        {users.length === 0 && <p className="p-4 text-sm text-gray-400">目前沒有已啟用的使用者，請聯繫系統管理員。</p>}
      </div>
    </div>
  );
}
