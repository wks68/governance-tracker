type KpiCardProps = {
  label: string;
  value: number | string;
  detail?: string;
};

export function KpiCard({ label, value, detail }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-panel">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
      {detail ? <div className="mt-2 text-sm text-slate-500">{detail}</div> : null}
    </div>
  );
}
