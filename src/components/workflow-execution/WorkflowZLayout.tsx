import type { ReactNode } from "react";
import EqualHeightContentRow from "./EqualHeightContentRow";

/**
 * Shared workflow-detail composition.
 *
 * The DOM order deliberately follows the mobile reading path. On large
 * screens each row uses the same 50/50 track definition and forms the
 * prescribed Z reading path. The DOM order remains the visual reading order.
 */
export default function WorkflowZLayout({
  topLeft,
  topRight,
  contentLeft,
  contentRight,
  after,
}: {
  topLeft: ReactNode;
  topRight: ReactNode;
  contentLeft?: ReactNode;
  contentRight?: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="space-y-4 sm:space-y-5 xl:space-y-6">
      <EqualHeightContentRow left={topLeft} right={topRight} />
      <EqualHeightContentRow left={contentLeft} right={contentRight} />
      {after && <div data-hotfix-scroll-section className="scroll-mt-24">{after}</div>}
    </div>
  );
}
