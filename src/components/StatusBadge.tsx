import { STATUS_LIGHT_META, StatusLight } from "@/lib/constants";
import clsx from "clsx";
import { Archive, CheckCircle2, CircleAlert, Clock3, Info } from "lucide-react";

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
  const Icon =
    light === "Red"
      ? CircleAlert
      : light === "Yellow"
        ? Clock3
        : light === "Blue"
          ? Info
          : light === "Green"
            ? CheckCircle2
            : Archive;
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-full border font-medium",
        meta.badgeClass,
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        pulse && "animate-pulse-red"
      )}
      title={`${meta.label}：${meta.desc}`}
      aria-label={`${meta.label}：${meta.desc}`}
    >
      <Icon aria-hidden className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span>{meta.label}</span>
    </span>
  );
}
