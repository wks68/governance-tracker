import { formatDateTime } from "@/lib/datetime";
import type { AssignableMembersPreview } from "@/lib/workflowExecutionService";

export default function ExecutorAssignmentSummary({ preview }: { preview: AssignableMembersPreview }) {
  if (!preview.teamName || !preview.currentExecutorName) return null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="目前執行資訊">
      <h2 className="text-sm font-semibold text-gray-800">目前執行資訊</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-gray-500">承接團隊</dt>
          <dd className="mt-0.5 font-medium text-gray-800">{preview.teamName}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">目前執行人</dt>
          <dd className="mt-0.5 font-medium text-gray-800">{preview.currentExecutorName}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">指派時間</dt>
          <dd className="mt-0.5 font-medium text-gray-800">{formatDateTime(preview.currentExecutorAssignedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
