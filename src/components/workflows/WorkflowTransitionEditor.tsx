"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { addWorkflowTransitionAction, removeWorkflowTransitionAction } from "@/app/admin/workflows/actions";

const TRANSITION_TYPES = ["FORWARD", "RETURN", "CANCEL"];
const TRANSITION_TYPE_LABEL: Record<string, string> = { FORWARD: "前進", RETURN: "退回", CANCEL: "取消" };

export interface TransitionRow {
  id: string;
  fromStageId: string;
  fromStageLabel: string;
  toStageId: string;
  toStageLabel: string;
  transitionType: string;
  actionKey: string;
  label: string;
  requireReason: boolean;
}

const inputClass = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-0.5 block text-[11px] font-medium text-gray-700";

// M2-A3 新增：Transition 管理——表格式來源／目標選擇（不建立拖拉圖形編輯器）。
export default function WorkflowTransitionEditor({
  definitionId,
  versionId,
  stages,
  transitions,
  editable,
}: {
  definitionId: string;
  versionId: string;
  stages: { id: string; label: string; stageKey: string }[];
  transitions: TransitionRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);

  function onAddSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("definitionId", definitionId);
    fd.set("versionId", versionId);
    startTransition(async () => {
      const result = await addWorkflowTransitionAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setShowAddForm(false);
      router.refresh();
    });
  }

  function onRemove(transitionId: string) {
    if (!confirm("確定要移除此 Transition 嗎？")) return;
    setError(null);
    const fd = new FormData();
    fd.set("definitionId", definitionId);
    fd.set("versionId", versionId);
    fd.set("transitionId", transitionId);
    fd.set("reasonCode", "移除 Transition");
    startTransition(async () => {
      const result = await removeWorkflowTransitionAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ActionErrorText message={error} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">流程走向（Transition）</h2>
        {editable && stages.length >= 1 && (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            {showAddForm ? "取消新增" : "＋ 新增 Transition"}
          </button>
        )}
      </div>

      {showAddForm && (
        <form onSubmit={onAddSubmit} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div>
              <label className={labelClass}>來源關卡</label>
              <select name="fromStageId" required disabled={isPending} defaultValue="" className={inputClass}>
                <option value="" disabled>
                  請選擇
                </option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}（{s.stageKey}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>目標關卡</label>
              <select name="toStageId" required disabled={isPending} defaultValue="" className={inputClass}>
                <option value="" disabled>
                  請選擇
                </option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}（{s.stageKey}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>類型</label>
              <select name="transitionType" required disabled={isPending} defaultValue="" className={inputClass}>
                <option value="" disabled>
                  請選擇
                </option>
                {TRANSITION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TRANSITION_TYPE_LABEL[t]}（{t}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>actionKey</label>
              <input type="text" name="actionKey" required disabled={isPending} className={inputClass} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>名稱</label>
              <input type="text" name="label" required disabled={isPending} className={inputClass} />
            </div>
          </div>
          <ReasonCodeField disabled={isPending} />
          <button type="submit" disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50">
            建立
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium text-gray-500">
              <th className="px-3 py-2">名稱</th>
              <th className="px-3 py-2">類型</th>
              <th className="px-3 py-2">來源 → 目標</th>
              <th className="px-3 py-2">actionKey</th>
              {editable && <th className="px-3 py-2">操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {transitions.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{t.label}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{TRANSITION_TYPE_LABEL[t.transitionType] ?? t.transitionType}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {t.fromStageLabel} → {t.toStageLabel}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">{t.actionKey}</td>
                {editable && (
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <button type="button" onClick={() => onRemove(t.id)} className="text-danger-text hover:underline">
                      移除
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {transitions.length === 0 && <p className="p-6 text-center text-sm text-gray-400">尚未新增任何 Transition。</p>}
      </div>
    </div>
  );
}
