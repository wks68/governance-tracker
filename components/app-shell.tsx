import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { RoleSwitcher } from "@/components/role-switcher";

type AppShellProps = {
  children: React.ReactNode;
  currentRole: string;
};

const navItems = [
  { href: "/dashboard", label: "儀表板" },
  { href: "/issues", label: "議題清單" },
  { href: "/issues/new", label: "建立議題" },
  { href: "/admin/workflows", label: "流程設定" },
  { href: "/admin/form-templates", label: "表單範本" }
];

export function AppShell({ children, currentRole }: AppShellProps) {
  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-5">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-delta-700 text-white">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-wide text-delta-800">
                DMS Governance Tracker
              </span>
              <span className="block text-xs text-slate-500">內部治理流程控管 MVP</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-delta-50 hover:text-delta-800"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <RoleSwitcher currentRole={currentRole} />
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6">{children}</main>
    </div>
  );
}
