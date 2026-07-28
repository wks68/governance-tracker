"use client";

// RD/QA/OP 接單流程新增：TRIAGE 關卡（待 RD/QA/OP 團隊接單）的接單面板。
//
// 只有 Team.domain 與目前關卡相符、且 actor 是該團隊 active Lead 的團隊才會顯示「接單」
// 按鈕；其餘符合領域但 actor 不是 Lead 的團隊唯讀顯示；已被其他團隊接單時（理論上本面板
// 此時不會再被渲染，見 claimable=false 由頁面端提前判斷）額外防禦性顯示提示。

import { useState, useTransition } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { claimIssueForTeamAction } from "@/app/issues/[id]/hotfix/claim-actions";
import type { ClaimableStagePreview } from "@/lib/workflowExecutionService";

export interface ClaimTeamPanelProps {
  issueId: string;
  preview: ClaimableStagePreview;
}

export default function ClaimTeamPanel({ issueId, preview }: ClaimTeamPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);

  if (!preview.claimable) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600">{preview.alreadyClaimedTeamName ? `已由 ${preview.alreadyClaimedTeamName} 團隊承接` : "目前關卡不支援接單"}</p>
      </section>
    );
  }

  function claim(teamId: string) {
    setError(null);
    setPendingTeamId(teamId);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("teamId", teamId);
    fd.set("reasonCode", "CLAIM_ISSUE");
    startTransition(async () => {
      const result = await claimIssueForTeamAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    });
  }

  const eligibleTeams = preview.teams.filter((t) => t.actorIsEligibleLead);
  const otherTeams = preview.teams.filter((t) => !t.actorIsEligibleLead);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">待 {preview.domain} 團隊接單</h2>
      <p className="mt-1 text-xs text-gray-500">符合資格的 {preview.domain} 團隊主管皆可接單，第一個成功接單的團隊將取得此工單。</p>

      <ActionErrorText message={error} />

      {eligibleTeams.length > 0 && (
        <div className="mt-3 space-y-2">
          {eligibleTeams.map((t) => (
            <div key={t.teamId} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
              <span className="text-sm text-gray-800">{t.teamName}</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => claim(t.teamId)}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
              >
                {isPending && pendingTeamId === t.teamId ? "接單中…" : "接單"}
              </button>
            </div>
          ))}
        </div>
      )}

      {eligibleTeams.length === 0 && (
        <p className="mt-3 text-xs text-gray-400">
          您不是任何 {preview.domain} 團隊的 active Team Lead，僅能查看，不得接單。
        </p>
      )}

      {otherTeams.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-400">其他 {preview.domain} 團隊（僅供顯示，無法由您代為接單）：</p>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
            {otherTeams.map((t) => (
              <li key={t.teamId}>{t.teamName}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
