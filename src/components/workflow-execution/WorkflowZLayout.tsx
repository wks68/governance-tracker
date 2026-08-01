import type { ReactNode } from "react";

/**
 * Shared workflow-detail composition.
 *
 * The DOM order deliberately follows the mobile reading path. On large
 * screens the same regions form the prescribed Z reading path, with a wider
 * work column and a narrower responsibility/action column.
 */
export default function WorkflowZLayout({
  topLeft,
  topRight,
  middleLeft,
  middleRight,
  bottomLeft,
  bottomRight,
  after,
}: {
  topLeft: ReactNode;
  topRight: ReactNode;
  middleLeft?: ReactNode;
  middleRight?: ReactNode;
  bottomLeft: ReactNode;
  bottomRight?: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
      <div className="min-w-0 lg:col-span-7">{topLeft}</div>
      <div className="min-w-0 lg:col-span-5">{topRight}</div>

      {/* Mobile deliberately reads guidance before history. Desktop restores
          the left-history/right-guidance second row. */}
      {middleRight && <div className="order-3 min-w-0 lg:order-none lg:col-span-5 lg:col-start-8 lg:row-start-2">{middleRight}</div>}
      {middleLeft && <div className="order-4 min-w-0 lg:order-none lg:col-span-7 lg:col-start-1 lg:row-start-2">{middleLeft}</div>}

      <div className="order-5 min-w-0 lg:order-none lg:col-span-7 lg:col-start-1 lg:row-start-3">{bottomLeft}</div>
      {bottomRight && <div className="order-6 min-w-0 lg:order-none lg:col-span-5 lg:col-start-8 lg:row-start-3">{bottomRight}</div>}
      {after && <div className="order-7 min-w-0 lg:order-none lg:col-span-12 lg:row-start-4">{after}</div>}
    </div>
  );
}
