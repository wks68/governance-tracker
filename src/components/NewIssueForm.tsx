"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIssueAction } from "@/lib/actions";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { ISSUE_TYPES, ENVIRONMENTS, RISK_LEVELS, PRIORITIES, SYSTEM_NAME_OPTIONS } from "@/lib/constants";
import { HOTFIX_PRIORITIES } from "@/lib/hotfix-ui/priority";
import { getWorkflow, getVisibleFieldTemplate } from "@/lib/workflow";
import DynamicFieldsForm from "@/components/DynamicFieldsForm";
import TeamApplicantSelector from "@/components/team-applicant/TeamApplicantSelector";
import type { ApplicantOption } from "@/lib/team-applicant/teamApplicantService";
import type { IssueCreationScope } from "@/lib/team-applicant/issueCreationScope";
import HotfixUrgencyHelp from "@/components/hotfix-nine-stage/HotfixUrgencyHelp";
import HotfixGovernanceRelationFields from "@/components/issue-relations/HotfixGovernanceRelationFields";
import type { GovernanceRelationCandidates } from "@/lib/issue-relations/viewService";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export default function NewIssueForm({
  scope,
  initialApplicants,
  relationCandidates,
  initialIssueType,
  initialChangeSubType,
}: {
  scope: IssueCreationScope;
  initialApplicants?: ApplicantOption[];
  relationCandidates: GovernanceRelationCandidates;
  initialIssueType: string;
  initialChangeSubType: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [issueType, setIssueType] = useState<string>(initialIssueType);
  const [teamId, setTeamId] = useState(scope.fixedTeamId ?? "");
  const [applicantId, setApplicantId] = useState(scope.fixedApplicant?.id ?? "");
  const [hotfixPriority, setHotfixPriority] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const initialStatus = getWorkflow(issueType)[0]?.key ?? "";
  const template = getVisibleFieldTemplate(issueType, initialStatus);
  const isHotfix = issueType === "Hotfix";

  // 雙重提交流程修正：兩個按鈕都送同一份表單，差別只在 submitForApproval。
  //
  // 失敗時刻意不清空表單、不離開本頁——使用者已填的內容全部保留，只顯示服務層回傳的
  // 中文訊息（例如申請人尚未設定直屬主管），使用者可改選申請人後重按，或改按「暫存」。
  // 送出期間按鈕一律 disabled（防連點）；但這只是體驗上的保護，真正的重複送出防護在
  // 服務層：整個建立＋送簽是單一 transaction，且已離開草稿的工單不會再被推進第二次。
  function submit(submitForApproval: boolean) {
    const formEl = formRef.current;
    if (!formEl) return;
    if (submitForApproval && !formEl.reportValidity()) return;

    const formData = new FormData(formEl);
    formData.set("submitForApproval", String(submitForApproval));
    setError(null);
    startTransition(async () => {
      const result = await createIssueAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(result.data!.redirectTo);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary-muted px-4 py-3">
        <div>
          <p className="text-xs font-medium text-text-muted">目前辦理類型</p>
          <p className="mt-0.5 text-sm font-semibold text-primary">{creationTypeLabel(issueType)}</p>
        </div>
        <Link href="/issues/new" className="ui-button-secondary px-3 py-1.5">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          重新選擇
        </Link>
      </div>

      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-6">
        {issueType === "ChangeRelease" && (
          <input type="hidden" name="changeSubType" value={initialChangeSubType ?? "QUARTERLY_RELEASE"} />
        )}
        <ActionErrorText message={error} />
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>
                工單類型<span className="ml-1 text-danger">*</span>
              </label>
              <select
                name="issueType"
                required
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className={inputCls}
              >
                {ISSUE_TYPES.filter((type) => ["Hotfix", "ChangeRelease", "Incident", "RCA"].includes(type.key)).map((t) => (
                  <option key={t.key} value={t.key}>
                    {creationTypeLabel(t.key)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <TeamApplicantSelector
            teams={scope.teams}
            teamId={teamId}
            applicantId={applicantId}
            onTeamIdChange={setTeamId}
            onApplicantIdChange={setApplicantId}
            initialApplicants={initialApplicants}
            fixedTeamId={scope.fixedTeamId}
            fixedApplicant={scope.fixedApplicant}
            canChooseApplicant={scope.canChooseApplicant}
            notice={scope.notice}
            blockedReason={scope.blockedReason}
          />
        </section>

        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">主要欄位</h2>
          <div>
            <label className={labelCls}>
              標題<span className="ml-1 text-danger">*</span>
            </label>
            <input
              name="title"
              required
              placeholder={isHotfix ? "請輸入實際問題標題" : "請輸入工單標題"}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>
              {isHotfix ? "問題現象" : "問題現象／需求說明"}
              <span className="ml-1 text-danger">*</span>
            </label>
            <textarea
              name="description"
              required
              rows={3}
              placeholder={isHotfix ? "請描述正式環境發生什麼問題" : "請描述問題現象或需求內容"}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>
                系統名稱<span className="ml-1 text-danger">*</span>
              </label>
              <select name="systemName" required className={inputCls} defaultValue="">
                <option value="">請選擇</option>
                {SYSTEM_NAME_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                環境<span className="ml-1 text-danger">*</span>
              </label>
              <select name="environment" required className={inputCls} defaultValue="">
                <option value="">請選擇</option>
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                風險等級（= 影響程度）<span className="ml-1 text-danger">*</span>
              </label>
              <select name="riskLevel" required className={inputCls} defaultValue="">
                <option value="">請選擇</option>
                {RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {isHotfix && (
                <p className="mt-1 text-xs text-gray-400">
                  高：影響主要服務、營運流程、資料正確性或資安風險／中：影響部分功能或特定使用者／低：影響有限，但需修正
                </p>
              )}
            </div>
            {isHotfix ? (
              <div>
                <label className={labelCls}>
                  緊急程度<span className="ml-1 text-danger">*</span>
                  <HotfixUrgencyHelp />
                </label>
                <select name="hotfixPriority" required className={inputCls} value={hotfixPriority} onChange={(event) => setHotfixPriority(event.target.value)}>
                  <option value="">請選擇</option>
                  {HOTFIX_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {hotfixPriority === "LOWEST" && (
                  <p className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    此項目原則上可評估改走季度上版，請確認使用 Hotfix 的必要性。
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className={labelCls}>優先級</label>
                <select name="priority" className={inputCls} defaultValue="">
                  <option value="">請選擇</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>
                預計完成日<span className="ml-1 text-danger">*</span>
              </label>
              <input type="date" name="dueDate" required className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>附件（選填）</label>
            <p className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400">
              建立工單後，即可於工單頁面上傳附件。
            </p>
          </div>
        </section>

        {isHotfix && (
          <HotfixGovernanceRelationFields candidates={relationCandidates} />
        )}

        {template.length > 0 && (
          <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700">依工單類型的動態欄位</h2>
            <DynamicFieldsForm template={template} values={{}} />
          </section>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isPending || scope.blockedReason !== null}
              onClick={() => submit(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              暫存
            </button>
            <button
              type="button"
              disabled={isPending || scope.blockedReason !== null}
              onClick={() => submit(true)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isPending ? "建立中…" : "建立工單"}
            </button>
            <a href="/issues" className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              取消
            </a>
          </div>
          <p className="text-xs text-gray-500">
            {isHotfix
              ? "建立後將直接送交申請人直屬主管簽核。若只想先保存內容，請按「暫存」。"
              : "建立後將直接送出。若只想先保存內容，請按「暫存」。"}
          </p>
        </div>
      </form>
    </div>
  );
}

function creationTypeLabel(issueType: string): string {
  if (issueType === "Hotfix") return "Hotfix 緊急修正";
  if (issueType === "ChangeRelease") return "季度專案";
  if (issueType === "Incident") return "事件通報";
  if (issueType === "RCA") return "RCA 根因分析";
  return issueType;
}
