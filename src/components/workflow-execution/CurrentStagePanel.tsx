"use client";

// M2-B 新增：目前關卡詳情，含 TRIAGE 關卡專用的處理團隊指派表單（Plan Team 同步規則：
// TRIAGE 的 Team 指派結果一律寫入 Issue.assignedTeamId，且必須經由
// setIssueAssignedTeamAtTriage 這個唯一入口）。非 TRIAGE 關卡只顯示唯讀資訊。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "@/components/people/ReasonCodeField";
import { setIssueAssignedTeamAtTriageAction } from "@/app/issues/[id]/workflow-execution-actions";

export interface CurrentStagePanelProps {
  issueId: string;
  stageKey: string;
  stageLabel: string;
  stageType: string;
  requiredExecutionRole: string | null;
  requiredMembershipRole: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  canAssignTeam: boolean;
  teamOptions: Array<{ id: string; name: string }>;
}

export default function CurrentStagePanel({
  issueId,
  stageLabel,
  stageType,
  requiredExecutionRole,
  requiredMembershipRole,
  assignedTeamId,
  assignedTeamName,
  canAssignTeam,
  teamOptions,
}: CurrentStagePanelProps) {
  const router = useRouter();
  const [selectedTeamId, setSelectedTeamId] = useState(assignedTeamId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isTriage = stageType === "TRIAGE";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("issueId", issueId);
    startTransition(async () => {
      const result = await setIssueAssignedTeamAtTriageAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-gray-400">關卡類型</dt>
          <dd className="font-medium text-gray-800">{stageType}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-400">要求角色</dt>
          <dd className="font-medium text-gray-800">{requiredExecutionRole ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-400">要求團隊身分</dt>
          <dd className="font-medium text-gray-800">{requiredMembershipRole === "LEAD" ? "LEAD" : requiredMembershipRole === "MEMBER" ? "成員" : "—"}</dd>
        </div>
      </dl>

      {isTriage && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-medium text-gray-600">「{stageLabel}」處理團隊指派</div>
          {!canAssignTeam ? (
            <p className="mt-1 text-xs text-gray-400">目前處理團隊：{assignedTeamName ?? "（尚未指派）"}（無指派權限，僅顯示）</p>
          ) : (
            <form onSubmit={onSubmit} className="mt-2 space-y-2">
              <ActionErrorText message={error} />
              <select
                name="teamId"
                required
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                disabled={isPending}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="" disabled>
                  請選擇處理團隊
                </option>
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <ReasonCodeField disabled={isPending} name="reasonCode" label="指派原因（必填）" />
              <button
                type="submit"
                disabled={isPending || !selectedTeamId}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPending ? "指派中…" : "指派處理團隊"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
