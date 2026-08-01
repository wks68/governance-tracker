import type { HotfixPageContext } from "@/lib/hotfix-ui/pageContext";

export interface LegacyHotfixGuidanceView {
  stageLabel: string;
  statusKnown: boolean;
}

export default function CurrentStageGuidanceCard({ ctx, legacyView }: { ctx?: HotfixPageContext; legacyView?: LegacyHotfixGuidanceView }) {
  if (!ctx && !legacyView) return null;
  if (!ctx && legacyView) {
    return (
      <aside className="ui-card p-4 lg:sticky lg:top-5" aria-label="目前關卡引導">
        <h2 className="text-sm font-semibold text-text-primary">本關卡引導</h2>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          {legacyView.statusKnown ? `舊制狀態已轉接至「${legacyView.stageLabel}」顯示。` : "舊制狀態無法精確判斷，九階段僅提供完整流程參考。"}
        </p>
        <dl className="mt-3 space-y-3 text-sm">
          <div><dt className="text-xs text-text-muted">頁面模式</dt><dd className="mt-0.5 font-medium text-text-primary">舊制資料，僅供查閱</dd></div>
          <div><dt className="text-xs text-text-muted">可用操作</dt><dd className="mt-0.5 text-text-secondary">無；不提供接單、指派、簽核、部署或結案操作。</dd></div>
        </dl>
      </aside>
    );
  }

  const runtimeCtx = ctx!;
  const missing = runtimeCtx.runtime.stageRequirements.filter((requirement) => !requirement.satisfied);
  const next = runtimeCtx.runtime.availableTransitions.find(({ transition }) => transition.transitionType === "FORWARD");

  return (
    <aside className="ui-card p-4 lg:sticky lg:top-5" aria-label="目前關卡引導">
      <h2 className="text-sm font-semibold text-text-primary">本關卡引導</h2>
      <p className="mt-1 text-sm leading-6 text-text-secondary">
        請完成「{runtimeCtx.runtime.currentStage.label}」所需內容，再執行本頁唯一的主要下一步。
      </p>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-text-muted">完成後</dt>
          <dd className="mt-0.5 text-text-primary">{next?.transition.label ?? (runtimeCtx.runtime.currentStage.isEnd ? "此工單已完成流程" : "系統會依已發布流程交由下一位責任人")}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">送出前檢查</dt>
          {missing.length === 0 ? (
            <dd className="mt-0.5 text-success">目前沒有已知的關卡缺漏。</dd>
          ) : (
            <dd className="mt-1">
              <ul className="space-y-1 text-text-secondary">
                {missing.map((requirement) => <li key={requirement.requirementId}>• {requirement.message}</li>)}
              </ul>
            </dd>
          )}
        </div>
      </dl>
      <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-text-muted">
        若因團隊主管或代理核准人設定不足而無法送出，具權限者可至團隊管理或核准治理設定修正；其他使用者請聯絡系統管理員。
      </p>
    </aside>
  );
}
