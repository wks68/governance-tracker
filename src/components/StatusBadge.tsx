import { STATUS_LIGHT_META, StatusLight } from "@/lib/constants";
import clsx from "clsx";

export default function StatusBadge({
  light,
  pulse = false,
  size = "md",
}: {
  light: string;
  pulse?: boolean;
  size?: "sm" | "md";
}) {
  const meta = STATUS_LIGHT_META[(light as StatusLight) || "Gray"];
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full",
        size === "sm" ? "h-5 w-5" : "h-6 w-6",
        pulse && "animate-pulse-red"
      )}
      title={`${meta.label}：${meta.desc}`}
      aria-label={meta.label}
    >
      <span className={clsx("rounded-full", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3", meta.dotClass)} />
    </span>
  );
}
