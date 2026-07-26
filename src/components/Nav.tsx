import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUserHasCapability } from "@/lib/permissions";
import { roleLabel } from "@/lib/constants";
import LogoutButton from "./LogoutButton";

const NAV_ITEMS = [
  { href: "/dashboard", label: "治理儀表板" },
  { href: "/issues", label: "工單清單" },
  { href: "/issues/new", label: "建立工單" },
  { href: "/settings/approval-governance", label: "核准治理設定" },
];

export default async function Nav() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-base font-bold text-gray-900">DMS Governance Tracker</span>
          <Link href="/login" className="text-sm font-medium text-primary hover:text-primary-hover">
            登入
          </Link>
        </div>
      </header>
    );
  }

  // C1-B2：管理入口改用 admin.full Capability（與 requireAdmin 同一授權來源），
  // 不再用 user.role === "Admin" 判斷；primary role 顯示（下方 roleLabel）仍讀 User.role。
  const isAdmin = await getUserHasCapability(user, "admin.full");
  const navItems = isAdmin ? [...NAV_ITEMS, { href: "/admin", label: "管理中心" }] : NAV_ITEMS;

  return (
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-base font-bold text-gray-900">
            DMS Governance Tracker
          </Link>
          <nav className="hidden gap-4 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-gray-600 hover:text-primary"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-gray-700 sm:inline">
            {user.name}
            <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
              {roleLabel(user.role)}
            </span>
          </span>
          <LogoutButton />
        </div>
      </div>
      <nav className="flex gap-4 overflow-x-auto border-t border-gray-100 px-4 py-2 md:hidden">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className="whitespace-nowrap text-sm font-medium text-gray-600">
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
