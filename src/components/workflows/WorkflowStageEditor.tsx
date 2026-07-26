"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import {
  addWorkflowStageAction,
  updateWorkflowStageAction,
  removeWorkflowStageAction,
  addWorkflowStageRequirementAction,
  removeWorkflowStageRequirementAction,
} from "@/app/admin/workflows/actions";

const STAGE_TYPES = ["SUBMISSION", "TRIAGE", "CLAIM", "WORK", "REVIEW", "APPROVAL", "DEPLOYMENT", "CONFIRMATION", "CLOSURE"];
const TERMINAL_OUTCOMES = ["COMPLETED", "CANCELLED"];
const APPROVAL_TYPES = ["BUSINESS_APPROVAL", "RD_LEAD_APPROVAL", "QA_LEAD_APPROVAL", "DEPLOYMENT_APPROVAL", "RISK_EXCEPTION_APPROVAL"];
const REQUIREMENT_TYPES = ["REQUIRE_FIELD", "REQUIRE_EVIDENCE", "REQUIRE_COMMENT"];

export interface StageRow {
  id: string;
  stageKey: string;
  label: string;
  stageType: string;
  sortOrder: number;
  isStart: boolean;
  isEnd: boolean;
  terminalOutcome: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  approvalType: string | null;
  requirements: { id: string; requirementType: string; targetKey: string }[];
}

const inputClass = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-0.5 block text-[11px] font-medium text-gray-700";

// M2-A3 新增：關卡管理——表格 + 展開式表單（不建立拖拉圖形編輯器），比照
// 「優先使用清楚的表格、排序、來源／目標選擇」的既定原則。Requirement 隨 Stage 一併管理。
export default function WorkflowStageEditor({
  definitionId,
  versionId,
  stages,
  teams,
  editable,
}: {
  definitionId: string;
  versionId: string;
  stages: StageRow[];
  teams: { id: string; name: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [expandedRequirements, setExpandedRequirements] = useState<string | null>(null);

  function afterSuccess(close: () => void) {
    close();
    router.refresh();
  }

  function onAddSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("definitionId", definitionId);
    fd.set("versionId", versionId);
    startTransition(async () => {
      const result = await addWorkflowStageAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      afterSuccess(() => setShowAddForm(false));
    });
  }

  function onEditSubmit(e: React.FormEvent<HTMLFormElement>, stageId: string) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("definitionId", definitionId);
    fd.set("versionId", versionId);
    fd.set("stageId", stageId);
    startTransition(async () => {
      const result = await updateWorkflowStageAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      afterSuccess(() => setEditingStageId(null));
    });
  }

  function onRemove(stageId: string) {
    if (!confirm("確定要移除此關卡嗎？")) return;
    setError(null);
    const fd = new FormData();
    fd.set("definitionId", definitionId);
    fd.set("versionId", versionId);
    fd.set("stageId", stageId);
    fd.set("reasonCode", "移除關卡");
    startTransition(async () => {
      const result = await removeWorkflowStageAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function onAddRequirement(e: React.FormEvent<HTMLFormElement>, stageId: string) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("definitionId", definitionId);
    fd.set("versionId", versionId);
    fd.set("stageId", stageId);
    startTransition(async () => {
      const result = await addWorkflowStageRequirementAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      (e.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  function onRemoveRequirement(requirementId: string) {
    setError(null);
    const fd = new FormData();
    fd.set("definitionId", definitionId);
    fd.set("versionId", versionId);
    fd.set("requirementId", requirementId);
    fd.set("reasonCode", "移除需求");
    startTransition(async () => {
      const result = await removeWorkflowStageRequirementAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function StageFormFields({ defaults }: { defaults?: Partial<StageRow> }) {
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {!defaults && (
          <div>
            <label className={labelClass}>stageKey</label>
            <input type="text" name="stageKey" required disabled={isPending} className={inputClass} />
          </div>
        )}
        <div>
          <label className={labelClass}>名稱</label>
          <input type="text" name="label" required disabled={isPending} defaultValue={defaults?.label} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>類型</label>
          <select name="stageType" required disabled={isPending} defaultValue={defaults?.stageType ?? ""} className={inputClass}>
            <option value="" disabled>
              請選擇
            </option>
            {STAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>排序</label>
          <input type="number" name="sortOrder" required disabled={isPending} defaultValue={defaults?.sortOrder ?? 1} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>負責 Team（選填）</label>
          <select name="assignedTeamId" disabled={isPending} defaultValue={defaults?.assignedTeamId ?? ""} className={inputClass}>
            <option value="">（無）</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" name="isStart" disabled={isPending} defaultChecked={defaults?.isStart} /> 起始關卡
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" name="isEnd" disabled={isPending} defaultChecked={defaults?.isEnd} /> 結束關卡
        </label>
        <div>
          <label className={labelClass}>結束結果（isEnd=true 時必填）</label>
          <select name="terminalOutcome" disabled={isPending} defaultValue={defaults?.terminalOutcome ?? ""} className={inputClass}>
            <option value="">（無）</option>
            {TERMINAL_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>核准類型（APPROVAL 關卡必填）</label>
          <select name="approvalType" disabled={isPending} defaultValue={defaults?.approvalType ?? ""} className={inputClass}>
            <option value="">（無）</option>
            {APPROVAL_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ActionErrorText message={error} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">關卡（Stage）</h2>
        {editable && (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            {showAddForm ? "取消新增" : "＋ 新增關卡"}
          </button>
        )}
      </div>

      {showAddForm && (
        <form onSubmit={onAddSubmit} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <StageFormFields />
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
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">stageKey</th>
              <th className="px-3 py-2">名稱</th>
              <th className="px-3 py-2">類型</th>
              <th className="px-3 py-2">起始／結束</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">需求</th>
              {editable && <th className="px-3 py-2">操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...stages]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((s) => (
                <>
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{s.sortOrder}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">{s.stageKey}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{s.label}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{s.stageType}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                      {s.isStart && <span className="mr-1 rounded bg-info-bg px-1.5 py-0.5 text-info-text">起始</span>}
                      {s.isEnd && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5">
                          結束
                          {s.terminalOutcome ? `（${s.terminalOutcome}）` : ""}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{s.assignedTeamName ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <button type="button" onClick={() => setExpandedRequirements(expandedRequirements === s.id ? null : s.id)} className="text-primary hover:underline">
                        {s.requirements.length} 項{expandedRequirements === s.id ? " ▲" : " ▼"}
                      </button>
                    </td>
                    {editable && (
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        <button type="button" onClick={() => setEditingStageId(editingStageId === s.id ? null : s.id)} className="mr-2 text-primary hover:underline">
                          編輯
                        </button>
                        <button type="button" onClick={() => onRemove(s.id)} className="text-danger-text hover:underline">
                          移除
                        </button>
                      </td>
                    )}
                  </tr>
                  {editingStageId === s.id && (
                    <tr>
                      <td colSpan={editable ? 8 : 7} className="bg-gray-50 px-3 py-3">
                        <form onSubmit={(e) => onEditSubmit(e, s.id)} className="space-y-2">
                          <StageFormFields defaults={s} />
                          <ReasonCodeField disabled={isPending} />
                          <button type="submit" disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50">
                            儲存
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                  {expandedRequirements === s.id && (
                    <tr>
                      <td colSpan={editable ? 8 : 7} className="bg-gray-50 px-3 py-3">
                        <p className="mb-2 text-xs font-medium text-gray-700">需求（Requirement）</p>
                        <ul className="mb-2 space-y-1">
                          {s.requirements.map((r) => (
                            <li key={r.id} className="flex items-center justify-between text-xs text-gray-600">
                              <span>
                                {r.requirementType}：{r.targetKey}
                              </span>
                              {editable && (
                                <button type="button" onClick={() => onRemoveRequirement(r.id)} className="text-danger-text hover:underline">
                                  移除
                                </button>
                              )}
                            </li>
                          ))}
                          {s.requirements.length === 0 && <li className="text-xs text-gray-400">尚無需求</li>}
                        </ul>
                        {editable && (
                          <form onSubmit={(e) => onAddRequirement(e, s.id)} className="flex items-end gap-2">
                            <div>
                              <label className={labelClass}>類型</label>
                              <select name="requirementType" required disabled={isPending} className={inputClass} defaultValue="">
                                <option value="" disabled>
                                  請選擇
                                </option>
                                {REQUIREMENT_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className={labelClass}>targetKey</label>
                              <input type="text" name="targetKey" required disabled={isPending} className={inputClass} />
                            </div>
                            <input type="hidden" name="reasonCode" value="新增關卡需求" />
                            <button type="submit" disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50">
                              新增
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
          </tbody>
        </table>
        {stages.length === 0 && <p className="p-6 text-center text-sm text-gray-400">尚未新增任何關卡。</p>}
      </div>
    </div>
  );
}
