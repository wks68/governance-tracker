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
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold", toneClass)}>{value}</div>
    </div>
  );
}
