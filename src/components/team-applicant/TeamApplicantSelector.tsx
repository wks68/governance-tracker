"use client";

// 建立工單／團隊整合修正新增：「團隊名稱」→「申請人」連動選擇共用元件。
// Client Component 不得 import Prisma：團隊清單由呼叫端（Server Component）以
// listCreatableTeamsForActor 查好後傳入，切換團隊後的成員名單則透過
// listApplicantsForTeamAction（Server Action）現場查詢，不把全體 User 一次載入 HTML。

import { useEffect, useState, useTransition } from "react";
import { listApplicantsForTeamAction } from "@/app/team-applicant-actions";
import type { TeamOption, ApplicantOption } from "@/lib/team-applicant/teamApplicantService";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export default function TeamApplicantSelector({
  teams,
  teamId,
  applicantId,
  onTeamIdChange,
  onApplicantIdChange,
  teamFieldName = "teamId",
  applicantFieldName = "applicantId",
  initialApplicants,
  disabled = false,
  fixedTeamId = null,
  fixedApplicant = null,
  canChooseApplicant = true,
  notice = "",
  blockedReason = null,
}: {
  teams: TeamOption[];
  teamId: string;
  applicantId: string;
  onTeamIdChange: (teamId: string) => void;
  onApplicantIdChange: (applicantId: string) => void;
  teamFieldName?: string;
  applicantFieldName?: string;
  /** 初次渲染時若已知目前 teamId 的成員名單（例如編輯既有草稿），可直接帶入，避免多一次來回請求。 */
  initialApplicants?: ApplicantOption[];
  disabled?: boolean;
  fixedTeamId?: string | null;
  fixedApplicant?: ApplicantOption | null;
  canChooseApplicant?: boolean;
  notice?: string;
  blockedReason?: string | null;
}) {
  const [applicants, setApplicants] = useState<ApplicantOption[]>(
    initialApplicants ?? (fixedApplicant ? [fixedApplicant] : []),
  );
  const [loadedForTeamId, setLoadedForTeamId] = useState<string>(initialApplicants ? teamId : "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!teamId || !canChooseApplicant || blockedReason) {
      setApplicants([]);
      setLoadedForTeamId("");
      return;
    }
    if (teamId === loadedForTeamId) return;
    setError(null);
    startTransition(async () => {
      const result = await listApplicantsForTeamAction(teamId);
      if (!result.ok) {
        setError(result.message);
        setApplicants([]);
        setLoadedForTeamId(teamId);
        return;
      }
      setApplicants(result.data ?? []);
      setLoadedForTeamId(teamId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, canChooseApplicant, blockedReason]);

  function handleTeamChange(nextTeamId: string) {
    // 切換團隊時必須立即清空原申請人，不得保留上一團隊的申請人。
    onApplicantIdChange("");
    onTeamIdChange(nextTeamId);
  }

  const teamChosen = teamId !== "";
  const teamReadOnly = fixedTeamId !== null;
  const applicantReadOnly = fixedApplicant !== null || !canChooseApplicant;
  const allDisabled = disabled || blockedReason !== null;
  const applicantSelectDisabled = allDisabled || applicantReadOnly || !teamChosen || isPending;

  return (
    <div className="space-y-2">
      {blockedReason ? (
        <p className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">{blockedReason}</p>
      ) : notice ? (
        <p className="text-xs text-gray-500">{notice}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>
            團隊名稱<span className="ml-1 text-danger">*</span>
          </label>
          <select
            name={teamFieldName}
            required
            disabled={allDisabled || teamReadOnly}
            value={teamId}
            onChange={(e) => handleTeamChange(e.target.value)}
            className={inputCls}
          >
            <option value="">請選擇</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {teamReadOnly && <input type="hidden" name={teamFieldName} value={teamId} />}
          {!blockedReason && teams.length === 0 && (
            <p className="mt-1 text-xs text-danger">目前沒有可建立工單的團隊，請聯絡系統管理員。</p>
          )}
        </div>
        <div>
          <label className={labelCls}>
            申請人<span className="ml-1 text-danger">*</span>
          </label>
          <select
            name={applicantFieldName}
            required
            disabled={applicantSelectDisabled}
            value={applicantId}
            onChange={(e) => onApplicantIdChange(e.target.value)}
            className={inputCls}
          >
            <option value="">
              {!teamChosen ? "請先選擇團隊" : isPending ? "載入中…" : applicants.length === 0 ? "此團隊目前沒有可選擇的申請人" : "請選擇"}
            </option>
            {applicants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.roleLabel}）
              </option>
            ))}
          </select>
          {applicantReadOnly && <input type="hidden" name={applicantFieldName} value={applicantId} />}
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}
