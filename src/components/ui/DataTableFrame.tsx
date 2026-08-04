import type { ReactNode } from "react";
import ContentCard from "./ContentCard";

export default function DataTableFrame({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <ContentCard className="overflow-hidden">
      <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>
    </ContentCard>
  );
}
