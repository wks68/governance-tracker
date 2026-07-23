import clsx from "clsx";
import { getWorkflow } from "@/lib/workflow";

export default function WorkflowProgress({ issueType, currentStatus }: { issueType: string; currentStatus: string }) {
  const steps = getWorkflow(issueType);
  const currentIdx = steps.indexOf(currentStatus);

  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-max items-center">
        {steps.map((step, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <li key={step} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={clsx(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold",
                    isCurrent && "border-primary bg-primary text-white",
                    isDone && !isCurrent && "border-primary-300 bg-primary-100 text-primary",
                    !isDone && !isCurrent && "border-gray-200 bg-gray-100 text-gray-400"
                  )}
                >
                  {idx + 1}
                </div>
                <span
                  className={clsx(
                    "w-20 text-center text-[11px] leading-tight",
                    isCurrent ? "font-semibold text-primary-hover" : isDone ? "text-gray-600" : "text-gray-400"
                  )}
                >
                  {step}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div className={clsx("mx-1 h-0.5 w-8", idx < currentIdx ? "bg-primary-300" : "bg-gray-200")} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
