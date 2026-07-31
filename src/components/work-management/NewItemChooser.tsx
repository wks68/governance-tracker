import Link from "next/link";
import { CalendarRange, FileSearch, Flame, KeyRound, Siren, type LucideIcon } from "lucide-react";
import ContentCard from "@/components/ui/ContentCard";

interface CreateOption {
  name: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

const GROUPS: { title: string; description: string; options: CreateOption[] }[] = [
  {
    title: "專案流程與緊急修正（Hotfix）",
    description: "安排季度工作，或處理正式環境的急迫修正。",
    options: [
      {
        name: "季度專案",
        description: "建立本季度預計開發、改善、測試及上版的專案。",
        href: "/issues/new?type=quarterly-project",
        icon: CalendarRange,
      },
      {
        name: "Hotfix 緊急修正",
        description: "正式環境發生急迫問題，需要優先修正、驗證及上版。",
        href: "/issues/new?type=hotfix",
        icon: Flame,
      },
    ],
  },
  {
    title: "事件通報與改善",
    description: "記錄事件並追蹤真正原因與改善措施。",
    options: [
      {
        name: "事件通報",
        description: "記錄系統異常、服務中斷、資料錯誤或其他事件。",
        href: "/issues/new?type=incident",
        icon: Siren,
      },
      {
        name: "RCA 根因分析",
        description: "針對事件分析真正原因，並追蹤後續改善措施。",
        href: "/issues/new?type=rca",
        icon: FileSearch,
      },
    ],
  },
];

export default function NewItemChooser() {
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <ContentCard key={group.title} className="p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-text-primary">{group.title}</h2>
            <p className="mt-1 text-sm text-text-secondary">{group.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.options.map((option) => (
              <Link
                key={option.name}
                href={option.href}
                className="group flex min-h-28 gap-4 rounded-xl border border-border bg-surface-muted p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary-muted hover:shadow-card focus-visible:ring-2 focus-visible:ring-focus-ring/30"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface text-primary shadow-sm transition group-hover:bg-primary group-hover:text-primary-foreground">
                  <option.icon className="h-5 w-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text-primary">{option.name}</span>
                  <span className="mt-1 block text-sm leading-5 text-text-secondary">{option.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </ContentCard>
      ))}

      <ContentCard className="p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-text-primary">申請與紀錄</h2>
          <p className="mt-1 text-sm text-text-secondary">此區將整合 OP 使用的帳號、權限及系統作業申請。</p>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-dashed border-border bg-surface-muted p-4" aria-disabled="true">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-disabled/60 text-text-muted">
            <KeyRound className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-secondary">OP 帳號與權限申請</p>
            <p className="mt-1 text-sm text-text-muted">即將提供</p>
          </div>
        </div>
      </ContentCard>
    </div>
  );
}
