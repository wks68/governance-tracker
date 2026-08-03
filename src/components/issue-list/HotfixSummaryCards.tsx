import ActionSummaryCard, { type SummaryTone } from "./ActionSummaryCard";

const SUMMARY_CARDS: Array<{ key: string; label: string; helper: string; tone: SummaryTone; countKey: "total" | "work" | "approval" | "due" }> = [
  { key: "all", label: "目前共", helper: "全部 Hotfix", tone: "neutral", countKey: "total" },
  { key: "my-work", label: "待我處理", helper: "目前輪到你", tone: "work", countKey: "work" },
  { key: "pending-approval", label: "待主管核准", helper: "主管簽核關卡", tone: "approval", countKey: "approval" },
  { key: "due-this-week", label: "本週到期", helper: "需優先追蹤", tone: "due", countKey: "due" },
];

function summaryHref(searchParams: Record<string, string | undefined>, key: string, active: boolean): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) if (value) params.set(name, value);
  if (key === "all" || active) params.delete("summary");
  else params.set("summary", key);
  params.set("view", "hotfix");
  return `/issues?${params.toString()}`;
}

export default function HotfixSummaryCards({ counts, activeKey, searchParams }: {
  counts: { total: number; work: number; approval: number; due: number };
  activeKey: string | undefined;
  searchParams: Record<string, string | undefined>;
}) {
  return (
    <section aria-label="Hotfix 摘要" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {SUMMARY_CARDS.map((card) => {
        const active = activeKey === card.key;
        return <ActionSummaryCard key={card.key} label={card.label} value={counts[card.countKey]} helper={card.helper} tone={card.tone} active={active} href={summaryHref(searchParams, card.key, active)} />;
      })}
    </section>
  );
}
