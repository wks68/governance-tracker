import { formatDateTime } from "@/lib/datetime";
import type { AssignableMembersPreview } from "@/lib/workflowExecutionService";
import AssignExecutorPanel from "./AssignExecutorPanel";
import ReassignExecutorDialog from "./ReassignExecutorDialog";

export default function ExecutorAssignmentSummary({ issueId, preview }: { issueId: string; preview: AssignableMembersPreview }) {
  if (!preview.teamName) return null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="目前執行資訊">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="pt-1 text-sm font-semibold text-gray-800">目前執行資訊</h2>
        {preview.isReassignment ? (
          <ReassignExecutorDialog issueId={issueId} preview={preview} />
        ) : (
          <AssignExecutorPanel issueId={issueId} preview={preview} />
        )}
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-gray-500">承接團隊</dt>
          <dd className="mt-0.5 font-medium text-gray-800">{preview.teamName}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">目前執行人</dt>
          <dd className="mt-0.5 font-medium text-gray-800">{preview.currentExecutorName ?? "待團隊主管指派"}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">指派時間</dt>
          <dd className="mt-0.5 font-medium text-gray-800">{formatDateTime(preview.currentExecutorAssignedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
