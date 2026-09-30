import { Check, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { displayWorkflowStatus } from "@/lib/i18n";

type WorkflowProgressProps = {
  workflow: string[];
  currentStatus: string;
};

export function WorkflowProgress({ workflow, currentStatus }: WorkflowProgressProps) {
  const currentIndex = workflow.indexOf(currentStatus);

  return (
    <div className="overflow-x-auto pb-1">
      <ol className="grid min-w-[760px] auto-cols-fr grid-flow-col gap-2">
        {workflow.map((status, index) => {
          const isDone = index < currentIndex || currentStatus === "Closed";
          const isCurrent = index === currentIndex && currentStatus !== "Closed";

          return (
            <li
              key={status}
              className={cn(
                "min-h-[76px] rounded-md border p-3",
                isDone && "border-emerald-200 bg-emerald-50",
                isCurrent && "border-delta-200 bg-delta-50",
                !isDone && !isCurrent && "border-line bg-white"
              )}
            >
              <div className="flex items-center gap-2">
                {isDone ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : isCurrent ? (
                  <Clock className="h-4 w-4 text-delta-700" />
                ) : (
                  <Circle className="h-4 w-4 text-slate-400" />
                )}
                <span className="text-xs font-semibold text-slate-700">
                  {index + 1}
                </span>
              </div>
              <div className="mt-2 text-sm font-medium leading-tight text-slate-900">
                {displayWorkflowStatus(status)}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
