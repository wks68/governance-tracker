import type { ReactNode } from "react";

export default function EqualHeightContentRow({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  if (!left && !right) return null;
  if (!left || !right) {
    return (
      <div data-hotfix-scroll-section className="min-w-0 scroll-mt-24 [&>section]:h-full">
        {left ?? right}
      </div>
    );
  }
  return (
    <div data-hotfix-scroll-section className="grid scroll-mt-24 grid-cols-1 items-stretch gap-4 md:grid-cols-2 md:gap-5 xl:gap-6">
      <div className="min-w-0 [&>section]:h-full">{left}</div>
      <div className="min-w-0 [&>section]:h-full [&>div]:h-full">{right}</div>
    </div>
  );
}
