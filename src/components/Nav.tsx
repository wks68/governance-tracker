import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/constants";
import { listActionableTasksForActor } from "@/lib/workflowExecutionService";
import LogoutButton from "./LogoutButton";
import ActionableNotificationBell from "./ActionableNotificationBell";

const NAV_ITEMS = [
  // 治理儀表板收斂：/governance 為唯一正式治理儀表板入口，舊 /dashboard 已改為
  // redirect 至此，不再於導覽中重複出現。
  { href: "/governance", label: "治理儀表板" },
  { href: "/issues", label: "工單清單" },
  { href: "/issues/new", label: "建立工單" },
  { href: "/incidents", label: "事件通報" },
  { href: "/rca", label: "RCA" },
  { href: "/settings/approval-governance", label: "核准治理設定" },
  // M1.5-C1-C 新增：人員／Team 清單。可見範圍一律由 listPeopleForActor／
  // listTeamsForActor 於服務層依 actorId 現場解析（Admin／資安推動小組看全部，
  // Team LEAD 看自己所屬 Team，一般使用者只看自己），因此對所有已登入使用者顯示同一
  // 個入口即可，不需要在 Nav 額外判斷 Capability——顯示入口本身不等於授權，實際範圍
  // 仍由頁面內的服務層查詢決定。
  { href: "/admin/people", label: "人員" },
  { href: "/admin/teams", label: "團隊" },
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

  const actionableTasks = await listActionableTasksForActor(user.id);
  const notificationTasks = actionableTasks.map((task) => ({
    issueId: task.issueId,
    issueKey: task.issueKey,
    title: task.title,
    actionLabel: task.actionLabel,
    actionHref: task.actionHref,
    currentStageLabel: task.currentStageLabel,
    enteredAt: task.enteredAt?.toISOString() ?? null,
  }));

  return (
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-5">
          <Link href="/governance" className="text-base font-bold text-gray-900">
            DMS Governance Tracker
          </Link>
          <nav className="hidden gap-3 xl:flex">
            {NAV_ITEMS.map((item) => (
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
          <ActionableNotificationBell tasks={notificationTasks} />
          <span className="hidden text-gray-700 sm:inline">
            {user.name}
            <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
              {roleLabel(user.role)}
            </span>
          </span>
          <LogoutButton />
        </div>
      </div>
      <nav className="flex gap-4 overflow-x-auto border-t border-gray-100 px-4 py-2 xl:hidden">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="whitespace-nowrap text-sm font-medium text-gray-600">
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
