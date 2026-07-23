import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

const ADMIN_SECTIONS = [
  { href: "/admin/users", label: "使用者與角色", desc: "管理使用者帳號、指派角色、啟用 / 停用帳號" },
  { href: "/admin/workflows", label: "流程設定", desc: "檢視各工單類型的流程關卡設定" },
  { href: "/admin/form-templates", label: "表單範本", desc: "檢視各工單類型的動態欄位範本與卡控說明" },
];

export default async function AdminHubPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">管理中心</h1>
        <p className="mt-0.5 text-sm text-gray-500">系統設定與治理流程管理，僅系統管理員可存取。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {ADMIN_SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-primary-200 hover:shadow-sm"
          >
            <h2 className="text-sm font-semibold text-gray-900">{s.label}</h2>
            <p className="mt-1 text-xs text-gray-500">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
