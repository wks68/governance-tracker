import clsx from "clsx";
import { HEALTH_STATUS_META, type GovernanceHealthSeverity } from "@/lib/constants";

// M1.5-B 新增：核准治理健康檢查嚴重度徽章。顏色只作輔助，文字（正常/注意/異常）
// 一律同時顯示；不使用閃爍效果（不同於既有 StatusBadge 的 pulse 選項）。
export default function HealthBadge({
  severity,
  size = "md",
}: {
  severity: GovernanceHealthSeverity;
  size?: "sm" | "md";
}) {
  const meta = HEALTH_STATUS_META[severity];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        meta.badgeClass,
      )}
    >
      <span className={clsx("rounded-full", size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2", meta.dotClass)} />
      {meta.label}
    </span>
  );
}
