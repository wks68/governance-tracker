"use client";

// Hotfix 操作畫面收斂新增：風險確認填答面板（需求四／六，對應「風險／例外」欄位區塊）。
// 送出下一步前必須完成的風險確認——先前完全沒有 UI 入口，只有 verify script 直接寫入
// StageRiskCheck，見 src/lib/workflow-execution/requirementService.ts 的
// submitStageRiskCheckAnswer 說明。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { submitStageRiskCheckAnswerAction } from "@/app/issues/[id]/workflow-execution-actions";

export interface RiskCheckItemView {
  checkKey: string;
  label: string;
  answer: "YES" | "NO" | "UNKNOWN" | null;
  detail: string;
  resolvedAt: string | null;
}

function AnswerRow({ issueId, stageKey, item, disabled }: { issueId: string; stageKey: string; item: RiskCheckItemView; disabled: boolean }) {
  const router = useRouter();
  const [detail, setDetail] = useState(item.detail);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const needsResolve = item.answer === "UNKNOWN" && !item.resolvedAt;

  function answer(value: "YES" | "NO" | "UNKNOWN", resolveUnknown = false) {
    setError(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("stageKey", stageKey);
    fd.set("checkKey", item.checkKey);
    fd.set("answer", value);
    fd.set("detail", detail);
    if (resolveUnknown) fd.set("resolveUnknown", "1");
    startTransition(async () => {
      const result = await submitStageRiskCheckAnswerAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-gray-200 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-800">{item.label}</span>
        {item.answer && (
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              item.answer === "YES" ? "bg-gov-red/10 text-gov-red" : item.answer === "UNKNOWN" ? "bg-gov-yellow/10 text-gov-yellow" : "bg-gov-green/10 text-gov-green"
            }`}
          >
            {item.answer === "YES" ? "是" : item.answer === "UNKNOWN" ? "不確定" : "否"}
            {needsResolve && "（待釐清）"}
          </span>
        )}
      </div>
      {disabled ? (
        !item.answer && <p className="mt-1 text-xs text-gray-400">尚未填答（僅目前責任角色可填寫）</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          <ActionErrorText message={error} />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={isPending} onClick={() => answer("NO")} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              否
            </button>
            <button type="button" disabled={isPending} onClick={() => answer("YES")} className="rounded border border-danger-border px-2 py-1 text-xs text-danger-text hover:bg-danger-bg disabled:opacity-40">
              是（有風險）
            </button>
            <button type="button" disabled={isPending} onClick={() => answer("UNKNOWN")} className="rounded border border-warning-border px-2 py-1 text-xs text-warning-text hover:bg-warning-bg disabled:opacity-40">
              不確定
            </button>
          </div>
          <input
            type="text"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="補充說明（選填）"
            disabled={isPending}
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
          />
          {needsResolve && (
            <button
              type="button"
              disabled={isPending || !detail.trim()}
              onClick={() => answer("UNKNOWN", true)}
              className="rounded bg-gov-yellow px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
              title="填寫補充說明後可標記為已釐清"
            >
              標記為已釐清
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function HotfixRiskCheckPanel({
  issueId,
  stageKey,
  items,
  disabled,
}: {
  issueId: string;
  stageKey: string;
  items: RiskCheckItemView[];
  disabled: boolean;
}) {
  if (items.length === 0) return <p className="text-sm text-gray-400">此階段沒有設定風險確認項目。</p>;
  return (
    <div id="risk-check-section" className="space-y-2">
      {items.map((item) => (
        <AnswerRow key={item.checkKey} issueId={issueId} stageKey={stageKey} item={item} disabled={disabled} />
      ))}
    </div>
  );
}
