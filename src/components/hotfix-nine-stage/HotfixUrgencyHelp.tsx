import Tooltip from "@/components/ui/Tooltip";
import { HOTFIX_URGENCY_GOVERNANCE } from "@/lib/hotfix-ui/priority";

export default function HotfixUrgencyHelp() {
  return (
    <span className="ml-1 inline-flex align-middle">
      <Tooltip label="緊急程度說明" content={HOTFIX_URGENCY_GOVERNANCE} />
    </span>
  );
}
