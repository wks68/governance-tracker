"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BriefcaseBusiness,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  FileSearch,
  Flame,
  LayoutDashboard,
  ListTodo,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Siren,
  UserCircle2,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import ActionableNotificationBell, { type NotificationTask } from "@/components/ActionableNotificationBell";
import LogoutButton from "@/components/LogoutButton";
import {
  APP_BREADCRUMB_EVENT,
  APP_BREADCRUMB_REQUEST_EVENT,
} from "@/components/app-shell/AppPageBreadcrumb";

export interface ShellSettingsAccess {
  people: boolean;
  teams: boolean;
  responsibility: boolean;
}

interface AppShellProps {
  user: { id: string; name: string; roleLabel: string };
  tasks: NotificationTask[];
  settingsAccess: ShellSettingsAccess;
  canUseWorkManagement: boolean;
  children: ReactNode;
}

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const TOP_LINKS: NavLink[] = [
  { href: "/governance", label: "治理儀表板", icon: LayoutDashboard },
  { href: "/issues/new", label: "新增事項", icon: FilePlus2 },
];

const WORK_GROUPS = [
  {
    label: "工作列表",
    icon: BriefcaseBusiness,
    items: [
      { href: "/issues?view=hotfix", label: "Hotfix 清單", icon: Flame },
      { href: "/issues?view=quarterly", label: "季度專案清單", icon: CalendarRange },
      { href: "/issues?view=incident", label: "事件通報清單", icon: Siren },
      { href: "/issues?view=rca", label: "RCA 清單", icon: FileSearch },
    ],
  },
  {
    label: "申請與紀錄",
    icon: ClipboardList,
    items: [],
  },
] as const;

const SETTINGS_LINKS = [
  { key: "people", href: "/admin/people", label: "人員管理", icon: Users },
  { key: "teams", href: "/admin/teams", label: "團隊管理", icon: UsersRound },
  { key: "responsibility", href: "/settings/approval-governance", label: "權責設定", icon: Network },
] as const;

export default function AppShell({
  user,
  tasks,
  settingsAccess,
  canUseWorkManagement,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileRendered, setMobileRendered] = useState(false);
  const [pageBreadcrumb, setPageBreadcrumb] = useState<string | null>(null);
  const [workOpen, setWorkOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith("/admin") || pathname.startsWith("/settings"));
  const [liveTasks, setLiveTasks] = useState(tasks);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);

  const visibleSettings = SETTINGS_LINKS.filter((item) => settingsAccess[item.key]);

  useEffect(() => {
    setLiveTasks(tasks);
  }, [tasks]);

  const handleTasksChange = useCallback((nextTasks: NotificationTask[]) => {
    setLiveTasks(nextTasks);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setPageBreadcrumb(null);
  }, [pathname, searchParams]);

  useEffect(() => {
    function onPageBreadcrumb(event: Event) {
      const detail = (event as CustomEvent<{ label?: string | null }>).detail;
      setPageBreadcrumb(detail?.label ?? null);
    }
    window.addEventListener(APP_BREADCRUMB_EVENT, onPageBreadcrumb);
    window.dispatchEvent(new Event(APP_BREADCRUMB_REQUEST_EVENT));
    return () => window.removeEventListener(APP_BREADCRUMB_EVENT, onPageBreadcrumb);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      setMobileRendered(true);
      return;
    }
    const timer = window.setTimeout(() => setMobileRendered(false), 220);
    return () => window.clearTimeout(timer);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => mobileCloseRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        window.requestAnimationFrame(() => mobileTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !mobilePanelRef.current) return;
      const focusable = Array.from(
        mobilePanelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  const fallbackLocationLabel = useMemo(() => breadcrumbLabel(pathname, searchParams.get("view")), [pathname, searchParams]);
  const locationLabel = pageBreadcrumb ?? fallbackLocationLabel;

  return (
    <div
      className="min-h-screen bg-background text-text-primary"
      data-session-actor-id={user.id}
      data-session-actor-name={user.name}
    >
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[70] -translate-y-20 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition focus:translate-y-0"
      >
        跳至主要內容
      </a>

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-border bg-surface transition-[width] duration-200 lg:block",
          collapsed ? "w-20" : "w-72",
        )}
        aria-label="主要導覽"
      >
        <SidebarContent
          pathname={pathname}
          currentView={searchParams.get("view")}
          currentQuick={searchParams.get("quick")}
          collapsed={collapsed}
          workOpen={workOpen}
          settingsOpen={settingsOpen}
          visibleSettings={visibleSettings}
          canUseWorkManagement={canUseWorkManagement}
          taskCount={liveTasks.length}
          onToggleWork={() => setWorkOpen((value) => !value)}
          onToggleSettings={() => setSettingsOpen((value) => !value)}
        />
      </aside>

      {mobileRendered && (
        <div
          className={clsx(
            "fixed inset-0 z-50 transition-opacity duration-200 motion-reduce:transition-none lg:hidden",
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          role="dialog"
          aria-modal="true"
          aria-label="主要導覽"
          aria-hidden={!mobileOpen}
        >
          <button
            type="button"
            aria-label="關閉導覽"
            className="animate-drawer-overlay-in absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            onClick={() => {
              setMobileOpen(false);
              mobileTriggerRef.current?.focus();
            }}
          />
          <div
            ref={mobilePanelRef}
            className={clsx(
              "relative h-full w-[min(20rem,88vw)] bg-surface shadow-overlay transition-transform duration-200 motion-reduce:transition-none",
              mobileOpen ? "animate-mobile-drawer-panel-in translate-x-0" : "-translate-x-full",
            )}
          >
            <button
              ref={mobileCloseRef}
              type="button"
              aria-label="關閉側邊欄"
              onClick={() => {
                setMobileOpen(false);
                mobileTriggerRef.current?.focus();
              }}
              className="absolute right-3 top-3 z-10 rounded-lg p-2 text-text-secondary hover:bg-surface-muted hover:text-primary"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            <SidebarContent
              pathname={pathname}
              currentView={searchParams.get("view")}
              currentQuick={searchParams.get("quick")}
              collapsed={false}
              workOpen={workOpen}
              settingsOpen={settingsOpen}
              visibleSettings={visibleSettings}
              canUseWorkManagement={canUseWorkManagement}
              taskCount={liveTasks.length}
              onToggleWork={() => setWorkOpen((value) => !value)}
              onToggleSettings={() => setSettingsOpen((value) => !value)}
            />
          </div>
        </div>
      )}

      <div className={clsx("min-h-screen lg:transition-[padding] lg:duration-200", collapsed ? "lg:pl-20" : "lg:pl-72")}>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <button
              ref={mobileTriggerRef}
              type="button"
              aria-label="開啟側邊欄"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-text-secondary hover:bg-primary-muted hover:text-primary lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={collapsed ? "展開側邊欄" : "收合側邊欄"}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((value) => !value)}
              className="hidden rounded-lg p-2 text-text-secondary hover:bg-primary-muted hover:text-primary lg:inline-flex"
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />}
            </button>
            <div className="min-w-0 border-l border-border pl-3">
              <p className="truncate text-xs text-text-muted">DMS 工作管理平台</p>
              <p className="truncate text-sm font-semibold text-text-primary" aria-current="page">{locationLabel}</p>
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link
              href="/issues"
              aria-label="搜尋工作事項"
              title="搜尋工作事項"
              className="rounded-lg p-2 text-text-secondary hover:bg-primary-muted hover:text-primary"
            >
              <Search className="h-5 w-5" aria-hidden />
            </Link>
            <ActionableNotificationBell
              tasks={liveTasks}
              userName={user.name}
              actorId={user.id}
              onTasksChange={handleTasksChange}
            />
            <UserMenu user={user} />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[96rem] px-4 py-5 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  pathname,
  currentView,
  currentQuick,
  collapsed,
  workOpen,
  settingsOpen,
  visibleSettings,
  canUseWorkManagement,
  taskCount,
  onToggleWork,
  onToggleSettings,
}: {
  pathname: string;
  currentView: string | null;
  currentQuick: string | null;
  collapsed: boolean;
  workOpen: boolean;
  settingsOpen: boolean;
  visibleSettings: typeof SETTINGS_LINKS[number][];
  canUseWorkManagement: boolean;
  taskCount: number;
  onToggleWork: () => void;
  onToggleSettings: () => void;
}) {
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!settingsRef.current?.contains(event.target as Node)) onToggleSettings();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToggleSettings();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen, onToggleSettings]);

  const [dashboard, create] = TOP_LINKS;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Link href="/governance" className={clsx("flex h-20 items-center border-b border-border px-4", collapsed ? "justify-center" : "gap-3")}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-sm font-black tracking-tight text-primary-foreground shadow-sm">DW</span>
        {!collapsed && (
          <span className="min-w-0">
            <span className="block truncate text-base font-bold text-text-primary">DMS WorkHub</span>
            <span className="block truncate text-xs text-text-muted">DMS 工作管理平台</span>
          </span>
        )}
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="DMS 工作管理平台">
        <NavItem item={dashboard} active={pathname === dashboard.href || pathname === "/dashboard"} collapsed={collapsed} />

        {canUseWorkManagement && (
          <div className="mt-1">
            <div className="flex items-center gap-1">
              <NavItem
                item={{ href: "/work-management", label: "工作管理", icon: BriefcaseBusiness }}
                active={pathname === "/work-management"}
                collapsed={collapsed}
                className="min-w-0 flex-1"
              />
              {!collapsed && (
                <button
                  type="button"
                  aria-label={workOpen ? "收合工作管理" : "展開工作管理"}
                  aria-expanded={workOpen}
                  onClick={onToggleWork}
                  className="rounded-lg p-2 text-text-muted hover:bg-primary-muted hover:text-primary"
                >
                  {workOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                </button>
              )}
            </div>

            {!collapsed && (
              <div className={clsx("grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none", workOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
              <div className="min-h-0 overflow-hidden">
              <div className="ml-4 mt-1 space-y-3 border-l border-border pl-3">
                <WorkGroupSection
                  group={WORK_GROUPS[0]}
                  pathname={pathname}
                  currentView={currentView}
                  currentQuick={currentQuick}
                />
                <NavItem
                  item={{ href: "/issues?view=hotfix&quick=mine", label: "我的待辦", icon: ListTodo }}
                  active={isHrefActive("/issues?view=hotfix&quick=mine", pathname, currentView, currentQuick)}
                  collapsed={false}
                  nested
                  badge={taskCount}
                />
                <WorkGroupSection
                  group={WORK_GROUPS[1]}
                  pathname={pathname}
                  currentView={currentView}
                  currentQuick={currentQuick}
                />
              </div>
              </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-1 space-y-1">
          {[create].map((item) => (
            <NavItem key={item.href} item={item} active={pathname === item.href} collapsed={collapsed} />
          ))}
        </div>

        {visibleSettings.length > 0 && (
          <div ref={settingsRef} className="mt-3 border-t border-border pt-3">
            <button
              type="button"
              title={collapsed ? "系統設定" : undefined}
              aria-label={collapsed ? "系統設定" : undefined}
              aria-expanded={settingsOpen}
              onClick={onToggleSettings}
              className={clsx(
                "flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition hover:bg-primary-muted hover:text-primary",
                collapsed ? "justify-center" : "gap-3",
                pathname.startsWith("/admin") || pathname.startsWith("/settings") ? "bg-primary-muted text-primary" : "",
              )}
            >
              <Settings className="h-5 w-5 shrink-0" aria-hidden />
              {!collapsed && <span className="min-w-0 flex-1 text-left">系統設定</span>}
              {!collapsed && (settingsOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />)}
            </button>
            {!collapsed && (
              <div className={clsx("grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none", settingsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
              <div className="min-h-0 overflow-hidden">
              <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
                {visibleSettings.map((item) => (
                  <NavItem key={item.href} item={item} active={pathname.startsWith(item.href)} collapsed={false} nested />
                ))}
              </div>
              </div>
              </div>
            )}
          </div>
        )}
      </nav>

      {!collapsed && (
        <div className="border-t border-border px-4 py-3 text-xs leading-5 text-text-muted">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          權限依目前有效角色與團隊關係顯示
        </div>
      )}
    </div>
  );
}

function NavItem({
  item,
  active,
  collapsed,
  nested = false,
  className,
  badge,
}: {
  item: NavLink;
  active: boolean;
  collapsed: boolean;
  nested?: boolean;
  className?: string;
  badge?: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center rounded-lg text-sm font-medium transition",
        collapsed ? "justify-center px-2 py-2.5" : nested ? "gap-2 px-2.5 py-1.5 text-xs" : "gap-3 px-3 py-2.5",
        active ? "bg-primary-muted text-primary" : "text-text-secondary hover:bg-surface-muted hover:text-primary",
        className,
      )}
    >
      <Icon className={clsx("shrink-0", nested ? "h-3.5 w-3.5" : "h-5 w-5")} aria-hidden />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="min-w-5 rounded-full bg-danger px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white" aria-label={`${badge} 件待辦`}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function WorkGroupSection({
  group,
  pathname,
  currentView,
  currentQuick,
}: {
  group: (typeof WORK_GROUPS)[number];
  pathname: string;
  currentView: string | null;
  currentQuick: string | null;
}) {
  const [open, setOpen] = useState(true);
  const GroupIcon = group.icon;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] font-semibold leading-4 text-text-muted hover:bg-surface-muted hover:text-primary"
      >
        <GroupIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{group.label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      </button>
      <div className={clsx("grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="min-h-0 overflow-hidden">
      {group.label === "申請與紀錄" ? (
        <div className="mt-1 rounded-lg bg-surface-muted px-2.5 py-2 text-xs text-text-muted" aria-disabled="true">
          <span className="block font-medium text-text-secondary">OP 帳號與權限申請</span>
          <span className="mt-0.5 block">即將提供</span>
        </div>
      ) : (
        <div className="mt-0.5 space-y-0.5">
          {group.items.map((item) => (
            <NavItem
              key={`${group.label}-${item.label}`}
              item={item}
              active={isHrefActive(item.href, pathname, currentView, currentQuick)}
              collapsed={false}
              nested
            />
          ))}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

function UserMenu({ user }: { user: { name: string; roleLabel: string } }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="開啟使用者選單"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg p-1.5 text-left hover:bg-primary-muted"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-muted text-primary">
          <UserCircle2 className="h-5 w-5" aria-hidden />
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-28 truncate text-xs font-semibold text-text-primary">{user.name}</span>
          <span className="block max-w-28 truncate text-[11px] text-text-muted">{user.roleLabel}</span>
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-text-muted sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-surface p-2 shadow-overlay">
          <div className="border-b border-border px-2 py-2">
            <p className="text-sm font-semibold text-text-primary">{user.name}</p>
            <p className="mt-0.5 text-xs text-text-muted">{user.roleLabel}</p>
          </div>
          <div className="px-2 py-2" role="none">
            <LogoutButton />
          </div>
        </div>
      )}
    </div>
  );
}

function isHrefActive(href: string, pathname: string, currentView: string | null, currentQuick: string | null): boolean {
  const [path, query] = href.split("?");
  if (pathname !== path) return false;
  if (!query) return true;
  const expected = new URLSearchParams(query);
  return expected.get("view") === (currentView ?? "hotfix") && expected.get("quick") === currentQuick;
}

function breadcrumbLabel(pathname: string, currentView: string | null): string {
  if (pathname === "/governance" || pathname === "/dashboard") return "治理儀表板";
  if (pathname === "/work-management") return "DMS 工作管理中心";
  if (pathname === "/issues/new") return "新增事項";
  if (pathname === "/issues") {
    if (currentView === "quarterly") return "季度專案清單";
    if (currentView === "incident") return "事件通報清單";
    if (currentView === "rca") return "RCA 清單";
    return "Hotfix 清單";
  }
  if (pathname === "/incidents") return "事件通報";
  if (pathname === "/rca") return "RCA 根因分析";
  if (pathname.startsWith("/admin/people")) return "系統設定／人員管理";
  if (pathname.startsWith("/admin/teams")) return "系統設定／團隊管理";
  if (pathname.startsWith("/settings/approval-governance")) return "系統設定／權責設定";
  if (pathname.startsWith("/issues/")) return "工作管理／事項詳情";
  return "DMS WorkHub";
}
