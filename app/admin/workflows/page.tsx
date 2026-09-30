import { GitBranch } from "lucide-react";
import { WORKFLOWS } from "@/lib/governance";
import { displayIssueType, displayWorkflowStatus } from "@/lib/i18n";

export default function AdminWorkflowsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">流程設定</h1>
        <p className="mt-1 text-sm text-slate-500">MVP 靜態流程定義。</p>
      </div>

      <section className="grid gap-4 xl:grid-cols-2">
        {Object.entries(WORKFLOWS).map(([issueType, statuses]) => (
          <div key={issueType} className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-delta-700" />
              <h2 className="text-sm font-semibold text-slate-950">{displayIssueType(issueType)}</h2>
            </div>
            <ol className="mt-4 space-y-2">
              {statuses.map((status, index) => (
                <li key={status} className="flex items-center gap-3 border-b border-line pb-2 last:border-b-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-700">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-800">
                    {displayWorkflowStatus(status)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}
