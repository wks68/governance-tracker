"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleX } from "lucide-react";
import { NINE_STAGES } from "@/lib/hotfix-ui/nineStage";

interface StoredProgressState {
  currentIndex: number | null;
  terminalComplete: boolean;
  cancelled: boolean;
}

interface ProgressTransition {
  previous: StoredProgressState;
  kind: "forward" | "return" | "complete";
}

export type WorkflowStageVisualState = "completed" | "current" | "future";

export function getNineStageVisualStates({
  currentIndex,
  cancelled,
  cancelledAtIndex,
  terminalComplete,
}: {
  currentIndex: number | null;
  cancelled: boolean;
  cancelledAtIndex: number | null;
  terminalComplete: boolean;
}): WorkflowStageVisualState[] {
  return NINE_STAGES.map((stage) => {
    const completed = terminalComplete || (
      cancelled
        ? cancelledAtIndex !== null && stage.index < cancelledAtIndex
        : currentIndex !== null && stage.index < currentIndex
    );
    if (completed) return "completed";
    if (!terminalComplete && !cancelled && currentIndex !== null && stage.index === currentIndex) return "current";
    return "future";
  });
}

export default function NineStageProgressBar({
  issueId,
  currentIndex,
  cancelled = false,
  cancelledAtIndex = null,
  terminalComplete = false,
}: {
  issueId: string;
  currentIndex: number | null;
  cancelled?: boolean;
  cancelledAtIndex?: number | null;
  terminalComplete?: boolean;
}) {
  const [transition, setTransition] = useState<ProgressTransition | null>(null);
  const processedSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    const storageKey = `dms-workflow-progress:${issueId}`;
    const nextState: StoredProgressState = { currentIndex, terminalComplete, cancelled };
    const snapshot = `${storageKey}:${JSON.stringify(nextState)}`;
    // React Strict Mode may run the same effect twice in development. Ignore
    // only an identical snapshot; a route refresh that advances or returns the
    // same mounted progress component must still be compared and animated.
    if (processedSnapshotRef.current === snapshot) return;
    processedSnapshotRef.current = snapshot;

    try {
      const raw = window.sessionStorage.getItem(storageKey);
      const previous = raw ? JSON.parse(raw) as StoredProgressState : null;
      setTransition(null);
      if (previous && !cancelled && !previous.cancelled) {
        if (terminalComplete && !previous.terminalComplete) {
          setTransition({ previous, kind: "complete" });
        } else if (
          currentIndex !== null &&
          previous.currentIndex !== null &&
          currentIndex > previous.currentIndex
        ) {
          setTransition({ previous, kind: "forward" });
        } else if (
          currentIndex !== null &&
          previous.currentIndex !== null &&
          currentIndex < previous.currentIndex
        ) {
          setTransition({ previous, kind: "return" });
        }
      }
      window.sessionStorage.setItem(storageKey, JSON.stringify(nextState));
    } catch {
      // Storage may be unavailable in hardened browser modes. The static state
      // remains fully usable; only the one-shot transition enhancement is lost.
    }
  }, [cancelled, currentIndex, issueId, terminalComplete]);

  const newlyCompleted = new Set<number>();
  if (transition?.kind === "complete") {
    newlyCompleted.add(NINE_STAGES.length);
  } else if (
    transition?.kind === "forward" &&
    transition.previous.currentIndex !== null &&
    currentIndex !== null
  ) {
    for (let index = transition.previous.currentIndex; index < currentIndex; index += 1) {
      newlyCompleted.add(index);
    }
  }
  const visualStates = getNineStageVisualStates({ currentIndex, cancelled, cancelledAtIndex, terminalComplete });

  return (
    <div className="w-full" data-workflow-progress-state={terminalComplete ? "closed" : cancelled ? "cancelled" : "active"}>
      {terminalComplete && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-workflow-complete bg-workflow-complete-muted px-3 py-2 text-sm font-semibold text-workflow-complete-deep" role="status">
          <Check className="h-4 w-4" aria-hidden />
          已結案：全部九個有效階段皆已完成
        </div>
      )}
      {cancelled && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-danger-border bg-danger-muted px-3 py-2 text-sm font-semibold text-danger-text" role="status">
          <CircleX className="h-4 w-4" aria-hidden />
          已取消：流程已停止，僅保留取消前實際完成的階段
        </div>
      )}

      <ol className="flex w-full items-start justify-between" aria-label="Hotfix 九階段流程進度">
        {NINE_STAGES.map((stage, index) => {
          const visualState = visualStates[index];
          const isCompleted = visualState === "completed";
          const isCurrent = visualState === "current";
          const isNewlyCompleted = newlyCompleted.has(stage.index);
          const isNewCurrent = transition !== null && transition.kind !== "complete" && isCurrent;
          const leftCompleted = index > 0 && (isCompleted || isCurrent || terminalComplete);
          const rightCompleted = index < NINE_STAGES.length - 1 && isCompleted;
          const animateLeftLine = newlyCompleted.has(stage.index - 1);
          const animateRightLine = isNewlyCompleted;
          const stateLabel = isCompleted ? "已完成" : isCurrent ? "目前階段" : cancelled ? "取消後未執行" : "尚未進入";

          return (
            <li
              key={stage.key}
              className="flex min-w-0 flex-1 flex-col items-center text-center"
              aria-label={`第 ${stage.index} 階段 ${stage.label}：${stateLabel}`}
              data-stage-state={visualState}
            >
              <div className="flex w-full items-center">
                <div
                  className={[
                    "h-0.5 flex-1 origin-left",
                    index === 0 ? "invisible" : leftCompleted ? "bg-workflow-complete-line" : "bg-border",
                    animateLeftLine ? "animate-stage-line-fill" : "",
                  ].join(" ")}
                />
                <div
                  className={[
                    "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors duration-300",
                    isCompleted
                      ? "border-workflow-complete bg-workflow-complete text-workflow-complete-foreground"
                      : isCurrent
                        ? "border-primary bg-white text-primary"
                        : "border-border bg-white text-text-muted",
                    isNewlyCompleted ? "animate-stage-complete-enter" : "",
                    isNewCurrent ? "animate-stage-current-enter" : "",
                  ].join(" ")}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isCurrent && (
                    <span aria-hidden="true" className="animate-stage-halo pointer-events-none absolute inset-0 rounded-full bg-primary/40" />
                  )}
                  {isCompleted ? (
                    <Check className={`relative h-4 w-4 ${isNewlyCompleted ? "animate-stage-check-in" : ""}`} strokeWidth={3} aria-hidden />
                  ) : isCurrent ? (
                    <span className="animate-stage-core relative h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
                  ) : (
                    <span aria-hidden="true">{stage.index}</span>
                  )}
                </div>
                <div
                  className={[
                    "h-0.5 flex-1 origin-left",
                    index === NINE_STAGES.length - 1 ? "invisible" : rightCompleted ? "bg-workflow-complete-line" : "bg-border",
                    animateRightLine ? "animate-stage-line-fill" : "",
                  ].join(" ")}
                />
              </div>
              <span
                className={[
                  "mt-1.5 px-0.5 text-[11px] leading-tight",
                  isCurrent
                    ? "font-semibold text-primary"
                    : isCompleted
                      ? "font-medium text-workflow-complete-deep"
                      : "text-text-muted",
                ].join(" ")}
              >
                {stage.label}
              </span>
              {isCurrent && <span className="mt-1 rounded-full bg-primary-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">目前</span>}
              <span className="sr-only">{stateLabel}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
