import Link from "next/link";

export type SummaryTone = "neutral" | "work" | "approval" | "due";

const ACTIVE_CLASS: Record<SummaryTone, string> = {
  neutral: "border-slate-400 bg-slate-50 ring-slate-300",
  work: "border-action-pending-work bg-blue-50 ring-action-pending-work-focus",
  approval: "border-action-pending-approval bg-violet-50 ring-action-pending-approval-focus",
  due: "border-amber-500 bg-amber-50 ring-amber-300",
};

export default function ActionSummaryCard({ label, value, helper, href, active, tone }: {
  label: string;
  value: number;
  helper: string;
  href: string;
  active: boolean;
  tone: SummaryTone;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={`ui-card min-h-[96px] p-4 transition hover:-translate-y-0.5 hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transform-none ${active ? `${ACTIVE_CLASS[tone]} ring-1` : ""}`}
    >
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <strong className="text-2xl font-bold text-text-primary">{value}</strong>
        <span className="text-xs text-text-secondary">筆</span>
      </span>
      <span className="mt-1 block text-xs text-text-muted">{helper}</span>
    </Link>
  );
}
