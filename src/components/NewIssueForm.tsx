"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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
import RichTextEditor from "@/components/rich-text/RichTextEditor";
import RiskLevelHelp from "@/components/hotfix-nine-stage/RiskLevelHelp";
import {
  issueCreateDraftStorageKey,
  parseClientIssueDraft,
  snapshotClientIssueDraft,
} from "@/lib/hotfix-ui/createDraft";
import { parseRichTextValue } from "@/lib/rich-text/value";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export default function NewIssueForm({
  actorId,
  scope,
  initialApplicants,
  relationCandidates,
  initialIssueType,
  initialChangeSubType,
}: {
  actorId: string;
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
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [activeOperation, setActiveOperation] = useState<"draft" | "create" | null>(null);
  const operationRef = useRef<"draft" | "create" | null>(null);
  const initialStatus = getWorkflow(issueType)[0]?.key ?? "";
  const template = getVisibleFieldTemplate(issueType, initialStatus);
  const isHotfix = issueType === "Hotfix";
  const draftStorageKey = issueCreateDraftStorageKey(actorId, initialIssueType);

  useEffect(() => {
    if (!isHotfix) return;
    const draft = parseClientIssueDraft(window.localStorage.getItem(draftStorageKey));
    if (!draft || draft.fields.issueType?.[0] !== initialIssueType) return;

    setTeamId(draft.fields.teamId?.[0] ?? teamId);
    setApplicantId(draft.fields.applicantId?.[0] ?? applicantId);
    setHotfixPriority(draft.fields.hotfixPriority?.[0] ?? "");
    // Pending image nodes cannot survive a browser restart because their File/ObjectURL is
    // intentionally not persisted. Restore the formatted text while removing those stale nodes,
    // so reopening a draft never renders a broken blob image or attempts a formal upload.
    setDescription(JSON.stringify(parseRichTextValue(draft.fields.description?.[0] ?? "")));
    setDraftNotice("已還原此瀏覽器先前暫存的草稿；圖片需重新選擇後才能正式建立。");

    const form = formRef.current;
    if (!form) return;
    const controlled = new Set(["issueType", "teamId", "applicantId", "hotfixPriority", "description"]);
    for (const [name, values] of Object.entries(draft.fields)) {
      if (controlled.has(name)) continue;
      const controls = Array.from(form.elements).filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
        element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement,
      ).filter((element) => element.name === name);
      for (const control of controls) {
        if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
          control.checked = values.includes(control.value);
        } else if (values[0] !== undefined) {
          control.value = values[0];
        }
      }
    }
    // The storage key already includes actor + issue type, so this effect must run only once for
    // the mounted creation screen. Subsequent controlled changes must never be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStorageKey, initialIssueType, isHotfix]);

  async function saveClientDraft() {
    const formEl = formRef.current;
    if (!formEl || operationRef.current) return;
    operationRef.current = "draft";
    setActiveOperation("draft");
    setDraftNotice(null);
    try {
      // Only Hotfix changed to browser-local draft semantics. Other issue types retain their
      // existing server draft behavior and canonical redirect.
      if (!isHotfix) {
        const formData = new FormData(formEl);
        formData.set("submitForApproval", "false");
        const result = await createIssueAction(formData);
        if (!result.ok) {
          setError(result.message);
          setErrorCode(result.code);
          return;
        }
        router.push(result.data!.redirectTo);
        return;
      }
      const draft = snapshotClientIssueDraft(new FormData(formEl));
      window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
      setDraftNotice("草稿已暫存於此瀏覽器；尚未建立 Hotfix，也未啟動簽核流程。");
    } catch {
      setDraftNotice("瀏覽器無法保存草稿，表單內容仍保留在目前頁面。");
    } finally {
      operationRef.current = null;
      setActiveOperation(null);
    }
  }

  async function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = formRef.current;
    if (!formEl || operationRef.current || !formEl.reportValidity()) return;
    operationRef.current = "create";
    setActiveOperation("create");

    const formData = new FormData(formEl);
    formData.set("submitForApproval", "true");
    setError(null);
    setErrorCode(null);
    setDraftNotice(null);
    try {
      const result = await createIssueAction(formData);
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code);
        return;
      }
      window.localStorage.removeItem(draftStorageKey);
      router.push(result.data!.redirectTo);
    } finally {
      operationRef.current = null;
      setActiveOperation(null);
    }
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

      <form ref={formRef} onSubmit={createIssue} className="space-y-6">
        {issueType === "ChangeRelease" && (
          <input type="hidden" name="changeSubType" value={initialChangeSubType ?? "QUARTERLY_RELEASE"} />
        )}
        <ActionErrorText message={error} code={errorCode} />
        {draftNotice && <p role="status" className="rounded-md border border-primary/20 bg-primary-muted px-3 py-2 text-sm text-primary">{draftNotice}</p>}
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
            disabled={activeOperation !== null}
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
            {isHotfix ? <RichTextEditor name="description" value={description} onChange={setDescription} required minHeight={240} placeholder="請描述正式環境發生什麼問題，或加入至少一張問題截圖" disabled={activeOperation !== null} /> : <textarea name="description" required rows={3} placeholder="請描述問題現象或需求內容" className={inputCls} />}
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
                風險等級（= 影響程度）<span className="ml-1 text-danger">*</span>{isHotfix && <RiskLevelHelp />}
              </label>
              <select name="riskLevel" required className={inputCls} defaultValue="">
                <option value="">請選擇</option>
                {RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
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
              disabled={activeOperation !== null || scope.blockedReason !== null}
              onClick={() => { void saveClientDraft(); }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {activeOperation === "draft" ? "暫存中…" : "暫存"}
            </button>
            <button
              type="submit"
              disabled={activeOperation !== null || scope.blockedReason !== null}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {activeOperation === "create" ? "建立中…" : "建立工單"}
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
