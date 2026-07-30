import { HOTFIX_PRIORITIES, HOTFIX_URGENCY_GOVERNANCE } from "@/lib/hotfix-ui/priority";

const tooltip = `${HOTFIX_PRIORITIES.map((item) => `${item.label}：${item.description}`).join("\n\n")}\n\n治理說明：${HOTFIX_URGENCY_GOVERNANCE}`;

export default function HotfixUrgencyHelp() {
  return (
    <>
      <span
        tabIndex={0}
        role="img"
        aria-label={`緊急程度說明。${tooltip}`}
        title={tooltip}
        className="ml-1 inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-gray-400 text-xs font-semibold text-gray-500"
      >
        ?
      </span>
      <span className="mt-1 block text-xs font-normal leading-5 text-gray-500">{HOTFIX_URGENCY_GOVERNANCE}</span>
    </>
  );
}
