import { cn } from "@/lib/utils";
import { statusLightDotClasses } from "@/lib/governance";
import { displayStatusLight } from "@/lib/i18n";

type StatusBadgeProps = {
  statusLight: string;
  pulse?: boolean;
};

export function StatusBadge({ statusLight, pulse = false }: StatusBadgeProps) {
  return (
    <span
      aria-label={displayStatusLight(statusLight)}
      title={displayStatusLight(statusLight)}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent",
        pulse && "animate-pulse"
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-3 w-3 rounded-full ring-2 ring-white", statusLightDotClasses(statusLight))}
      />
    </span>
  );
}
