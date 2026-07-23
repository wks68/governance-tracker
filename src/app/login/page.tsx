import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/constants";
import { loginAsUserAction } from "@/lib/authActions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const users = await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

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
      </div>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {users.map((u) => (
          <form key={u.id} action={loginAsUserAction} className="flex items-center justify-between gap-3 p-4">
            <input type="hidden" name="userId" value={u.id} />
            <div>
              <div className="font-medium text-gray-900">{u.name}</div>
              <div className="text-xs text-gray-500">
                {u.email} · {u.department || "—"} · {roleLabel(u.role)}
              </div>
            </div>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
            >
              登入
            </button>
          </form>
        ))}
        {users.length === 0 && <p className="p-4 text-sm text-gray-400">目前沒有已啟用的使用者，請聯繫系統管理員。</p>}
      </div>
    </div>
  );
}
