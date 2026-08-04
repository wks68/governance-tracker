import clsx from "clsx";
import type { ElementType, ReactNode } from "react";

export default function ContentCard({
  as: Component = "section",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return <Component className={clsx("ui-card", className)}>{children}</Component>;
}
