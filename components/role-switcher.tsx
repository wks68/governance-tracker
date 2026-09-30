"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLES } from "@/lib/governance";
import { displayRole } from "@/lib/i18n";

type RoleSwitcherProps = {
  currentRole: string;
};

export function RoleSwitcher({ currentRole }: RoleSwitcherProps) {
  const router = useRouter();
  const [role, setRole] = useState(currentRole);

  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span>角色</span>
      <select
        value={role}
        onChange={(event) => {
          const nextRole = event.target.value;
          setRole(nextRole);
          document.cookie = `dmsRole=${encodeURIComponent(nextRole)}; path=/; max-age=31536000; SameSite=Lax`;
          router.refresh();
        }}
        className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
      >
        {ROLES.map((item) => (
          <option key={item} value={item}>
            {displayRole(item)}
          </option>
        ))}
      </select>
    </label>
  );
}
