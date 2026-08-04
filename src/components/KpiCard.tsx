import clsx from "clsx";

export default function KpiCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "red" | "yellow" | "blue";
}) {
  const toneClass =
    tone === "red"
      ? "text-gov-red"
      : tone === "yellow"
      ? "text-gov-yellow"
      : tone === "blue"
      ? "text-gov-blue"
      : "text-gray-900";
  return (
    <div className="ui-card p-4">
      <div className="text-sm font-medium text-text-secondary">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold", toneClass)}>{value}</div>
    </div>
  );
}
