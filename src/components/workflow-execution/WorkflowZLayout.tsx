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
  governance,
  approval,
  attachments,
  after,
}: {
  topLeft: ReactNode;
  topRight: ReactNode;
  contentLeft?: ReactNode;
  contentRight?: ReactNode;
  /** 治理關聯與追蹤：固定全寬，位於送簽內容之後、主管簽核之前。 */
  governance?: ReactNode;
  /** 主管簽核：獨立全寬區塊，位於治理關聯之後、附件之前。 */
  approval?: ReactNode;
  /** 附件：獨立全寬區塊，位於主管簽核之後、簽核紀錄歷程之前。 */
  attachments?: ReactNode;
  /** 簽核紀錄歷程等固定排在最後的內容。 */
  after?: ReactNode;
}) {
  return (
    <div className="space-y-4 sm:space-y-5 xl:space-y-6">
      <EqualHeightContentRow left={topLeft} right={topRight} equalHeight />
      <EqualHeightContentRow left={contentLeft} right={contentRight} />
      {governance && <div data-hotfix-scroll-section className="scroll-mt-24">{governance}</div>}
      {approval && <div data-hotfix-scroll-section className="scroll-mt-24">{approval}</div>}
      {attachments && <div data-hotfix-scroll-section className="scroll-mt-24">{attachments}</div>}
      {after && <div data-hotfix-scroll-section className="scroll-mt-24">{after}</div>}
    </div>
  );
}
