import { NINE_STAGES, nineStageLabelOfIndex } from "@/lib/hotfix-ui/nineStage";

export interface CurrentHotfixFlowView {
  currentIndex: number | null;
  currentStageLabel: string;
  teamName: string | null;
  cancelled: boolean;
  terminalComplete: boolean;
}

function nextStageLabel(view: CurrentHotfixFlowView): string {
  if (view.cancelled) return "流程已取消";
  if (view.terminalComplete || view.currentIndex === NINE_STAGES.length) return "流程已完成";
  if (view.currentIndex === null) return "待確認";
  return nineStageLabelOfIndex(view.currentIndex + 1);
}

export default function CurrentHotfixFlowCard({ view }: { view: CurrentHotfixFlowView }) {
  return (
    <section className="ui-card p-5 sm:p-6" aria-label="目前 Hotfix 流程">
      <h2 className="text-base font-semibold text-text-primary">目前 Hotfix 流程</h2>
      <dl className="mt-4 grid gap-4 text-sm">
        <div>
          <dt className="text-xs font-medium text-text-muted">目前階段</dt>
          <dd className="mt-1 font-semibold text-primary">{view.currentStageLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">目前處理部門</dt>
          <dd className="mt-1 font-medium text-text-primary">{view.teamName || "尚待承接"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">下一關</dt>
          <dd className="mt-1 font-medium text-text-primary">{nextStageLabel(view)}</dd>
        </div>
      </dl>
    </section>
  );
}
