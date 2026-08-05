"use client";

// 「建立工作單」浮動選單（Option 3：垂直軌道式分層浮動選單），比照任務規格第二十節：取代
// 固定在右上角的「新增事項」按鈕。主按鈕只展開 3 個項目——建立 Hotfix／建立季度專案／
// 通報事件，刻意不提供 RCA 建立入口（RCA 只能由事件通報「需要 RCA」判定觸發，見
// src/lib/rca-ui/rcaCreation.ts）。

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Plus, Zap, CalendarCheck, Siren } from "lucide-react";

const MENU_ITEMS = [
  { href: "/issues/new?type=hotfix", label: "建立 Hotfix", icon: Zap },
  { href: "/issues/new?type=quarterly-project", label: "建立季度專案", icon: CalendarCheck },
  { href: "/issues/incident/new", label: "通報事件", icon: Siren },
] as const;

export default function CreateWorkItemFab() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="fixed z-40 flex flex-col items-end gap-2"
      style={{ right: "max(1.5rem, env(safe-area-inset-right))", bottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
    >
      <div
        role="menu"
        aria-hidden={!open}
        className={`flex flex-col items-end gap-2 ${open ? "" : "pointer-events-none"}`}
      >
        {MENU_ITEMS.map((item, index) => (
          <Link
            key={item.href}
            href={item.href}
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
            className={`flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-primary shadow-md transition-[opacity,transform] duration-200 ease-out hover:border-primary/40 hover:text-primary motion-reduce:transition-none ${
              open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
            style={{ transitionDelay: open ? `${index * 50}ms` : "0ms" }}
          >
            <item.icon className="h-4 w-4 text-primary" aria-hidden />
            {item.label}
          </Link>
        ))}
      </div>

      <button
        type="button"
        aria-label="建立工作單"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 min-w-11 items-center gap-2 rounded-full bg-primary/90 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-transform duration-150 hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        <Plus className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-45" : ""}`} aria-hidden />
        建立工作單
      </button>
    </div>
  );
}
