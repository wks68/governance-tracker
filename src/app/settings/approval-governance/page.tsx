import Link from "next/link";
import clsx from "clsx";
import { requireCurrentUser } from "@/lib/auth";
import { resolveGovernanceAccessContext } from "@/lib/permissions";
import SupervisorSection from "./SupervisorSection";
import TeamLeadSection from "./TeamLeadSection";
import DelegationSection from "./DelegationSection";
import HealthSection from "./HealthSection";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "supervisor", label: "直屬主管" },
  { key: "team-lead", label: "團隊主管" },
  { key: "delegation", label: "核准代理人" },
  { key: "health", label: "健康檢查" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// M1.5-B2：核准治理設定入口頁。本頁與底下各 Section／Panel 元件只負責 UI 呈現與
// 「要不要顯示某個頁籤/按鈕」的輔助判斷；所有實際資料範圍與規則檢查（重疊、循環、
// 原始資格、row-level 授權…）一律由 M1.5-B1 已完成的服務層（supervisorAssignmentService
// ／teamLeadService／approvalDelegationService／approvalGovernanceHealthService／
// approvalGovernanceActions）以 actorId 現場重新解析，本頁不重新實作任何規則。
export default async function ApprovalGovernanceSettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string; days?: string; severity?: string; checkKey?: string };
}) {
  const actor = await requireCurrentUser();
  const ctx = await resolveGovernanceAccessContext(actor.id);

  const visibleTabs = TABS.filter((t) => t.key !== "health" || ctx.canViewAllGovernance);
  const requestedTab = searchParams.tab;
  const activeTab: TabKey = (visibleTabs.find((t) => t.key === requestedTab)?.key ?? visibleTabs[0].key) as TabKey;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">權責設定</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          設定誰是直屬主管、團隊主管及核准代理人。所有異動皆會寫入 Audit Log。
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={`/settings/approval-governance?tab=${t.key}`}
            className={clsx(
              "border-b-2 px-3 py-2 text-sm font-medium",
              activeTab === t.key ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-700",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {activeTab === "supervisor" && <SupervisorSection actorId={actor.id} ctx={ctx} />}
      {activeTab === "team-lead" && <TeamLeadSection actorId={actor.id} ctx={ctx} />}
      {activeTab === "delegation" && <DelegationSection actorId={actor.id} ctx={ctx} />}
      {activeTab === "health" && ctx.canViewAllGovernance && (
        <HealthSection
          actorId={actor.id}
          days={Number(searchParams.days) > 0 ? Number(searchParams.days) : 7}
          severityFilter={searchParams.severity ?? "all"}
          checkKeyFilter={searchParams.checkKey ?? "all"}
        />
      )}
    </div>
  );
}
