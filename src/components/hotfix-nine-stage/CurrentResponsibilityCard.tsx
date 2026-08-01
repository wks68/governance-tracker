import type { HotfixPageContext } from "@/lib/hotfix-ui/pageContext";

function responsibilityLabel(ctx: HotfixPageContext) {
  if (ctx.runtime.pendingApproval) return "目前由指定主管或代理人簽核";
  if (ctx.runtime.currentStage.stageType === "TRIAGE") return "符合領域的團隊主管可先行承接";
  if (ctx.runtime.currentStage.isEnd) return "工單已到達終態，僅供查閱";
  if (ctx.runtime.currentStage.requiredExecutionRole) return "由承接團隊主管指派的執行人處理";
  return "由目前流程責任人處理";
}

export interface LegacyHotfixResponsibilityView {
  stageLabel: string;
  teamName: string | null;
  dueDate: string | null;
  ownerLabel: string;
}

export default function CurrentResponsibilityCard({
  ctx,
  legacyView,
}: {
  ctx?: HotfixPageContext;
  legacyView?: LegacyHotfixResponsibilityView;
}) {
  if (!ctx && !legacyView) return null;
  if (!ctx && legacyView) {
    return (
      <section className="ui-card h-full p-4" aria-label="目前責任資訊">
        <h2 className="text-sm font-semibold text-text-primary">目前責任資訊</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
          <div><dt className="text-xs text-text-muted">目前關卡</dt><dd className="mt-0.5 font-medium text-text-primary">{legacyView.stageLabel}</dd></div>
          <div><dt className="text-xs text-text-muted">現在由誰負責</dt><dd className="mt-0.5 font-medium text-text-primary">{legacyView.ownerLabel}</dd></div>
          <div><dt className="text-xs text-text-muted">承接團隊</dt><dd className="mt-0.5 font-medium text-text-primary">{legacyView.teamName ?? "未留存"}</dd></div>
          <div><dt className="text-xs text-text-muted">預計完成日</dt><dd className="mt-0.5 font-medium text-text-primary">{legacyView.dueDate?.slice(0, 10) ?? "尚未設定"}</dd></div>
        </dl>
        <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-text-muted">舊制資料，僅供查閱；此責任資訊不代表新版 Workflow 授權。</p>
      </section>
    );
  }

  const runtimeCtx = ctx!;
  const pendingApproval = runtimeCtx.runtime.pendingApproval;
  return (
    <section className="ui-card h-full p-4" aria-label="目前責任資訊">
      <h2 className="text-sm font-semibold text-text-primary">目前責任資訊</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
        <div>
          <dt className="text-xs text-text-muted">目前關卡</dt>
          <dd className="mt-0.5 font-medium text-text-primary">{runtimeCtx.runtime.currentStage.label}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">現在由誰負責</dt>
          <dd className="mt-0.5 font-medium text-text-primary">{responsibilityLabel(runtimeCtx)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">承接團隊</dt>
          <dd className="mt-0.5 font-medium text-text-primary">{runtimeCtx.ticketBasicInfo.teamName ?? "等待團隊承接"}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">預計完成日</dt>
          <dd className="mt-0.5 font-medium text-text-primary">{runtimeCtx.ticketBasicInfo.dueDate?.slice(0, 10) ?? "尚未設定"}</dd>
        </div>
        {pendingApproval && (
          <div>
            <dt className="text-xs text-text-muted">簽核狀態</dt>
            <dd className="mt-0.5 font-medium text-text-primary">等待主管決策</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
