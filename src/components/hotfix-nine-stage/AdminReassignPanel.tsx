"use client";

// 建立工單／團隊整合修正新增：Admin 專用「調整團隊／申請人」面板，僅在已送簽（非草稿、
// 非結案／取消）階段顯示。Admin CRUD 管理權與流程簽核權分開——本面板只改派團隊／申請人，
// 不會讓 Admin 因此取得任何主管簽核權（核准資格一律由服務層現場重新解析）。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText, ActionSuccessText } from "@/components/ActionResultBanner";
import { reassignHotfixTeamApplicantAction } from "@/app/issues/[id]/hotfix/reassign-actions";
import TeamApplicantSelector from "@/components/team-applicant/TeamApplicantSelector";
import type { TeamOption, ApplicantOption } from "@/lib/team-applicant/teamApplicantService";

export default function AdminReassignPanel({
  issueId,
  teams,
  currentTeamId,
  currentApplicantId,
  currentApplicantName,
}: {
  issueId: string;
  teams: TeamOption[];
  currentTeamId: string;
  currentApplicantId: string;
  currentApplicantName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState(currentTeamId);
  const [applicantId, setApplicantId] = useState(currentApplicantId);
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const initialApplicants: ApplicantOption[] | undefined =
    currentTeamId && currentApplicantId ? [{ id: currentApplicantId, name: currentApplicantName, roleLabel: "" }] : undefined;

  function submit() {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("teamId", teamId);
    fd.set("applicantId", applicantId);
    fd.set("reasonCode", reasonCode);
    startTransition(async () => {
      const result = await reassignHotfixTeamApplicantAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
      >
        Admin：調整團隊／申請人
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-900">Admin：調整團隊／申請人</h2>
      <p className="mt-1 text-xs text-amber-700">
        僅調整團隊與申請人歸屬，不會使您因此取得本工單任何主管簽核權。若目前有待簽核的申請人主管核准紀錄，將作廢並依新申請人重新送核。
      </p>
      <ActionErrorText message={error} />
      <ActionSuccessText message={success} />
      <div className="mt-3 space-y-3">
        <TeamApplicantSelector
          teams={teams}
          teamId={teamId}
          applicantId={applicantId}
          onTeamIdChange={setTeamId}
          onApplicantIdChange={setApplicantId}
          initialApplicants={initialApplicants}
          disabled={isPending}
        />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">變更原因</label>
          <textarea
            rows={2}
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPending || !teamId || !applicantId || !reasonCode.trim()}
            onClick={submit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? "處理中…" : "確認調整"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setOpen(false)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            收合
          </button>
        </div>
      </div>
    </section>
  );
}
