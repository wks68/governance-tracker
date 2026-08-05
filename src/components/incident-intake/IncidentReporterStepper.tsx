"use client";

// 事件通報快速通報介面：三步驟 Stepper（發生什麼事／影響到哪裡／確認並送出），比照任務
// 規格第四～十節。取代 Stage 1 單頁自由文字表單——通報人只填目前已知資訊，不負責正式分級、
// 技術單位指派或 RCA 判定。

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, PowerOff, Lock, DatabaseZap, Mail, Gauge, Rocket, ShieldAlert, ClipboardCheck, MoreHorizontal,
  UploadCloud, FileText, X,
} from "lucide-react";
import SearchableSelect from "./SearchableSelect";
import SearchableMultiSelect from "./SearchableMultiSelect";
import { createIncidentAction } from "@/app/issues/incident/new/actions";
import { uploadIssueAttachmentAction } from "@/lib/issue-attachments/actions";
import { incidentRoute } from "@/lib/incident-ui/incidentStage";
import { ENVIRONMENTS } from "@/lib/constants";
import {
  REPORTER_UNSURE,
  REPORTER_OTHER,
  REPORTER_SYSTEM_OPTIONS,
  SYSTEM_SERVICE_MAP,
  INCIDENT_TYPE_OPTIONS,
  OCCURRED_TIME_QUICK_OPTIONS,
  SYMPTOM_OPTIONS,
  ONGOING_OPTIONS,
  WORKAROUND_OPTIONS,
  IMPACT_SCOPE_OPTIONS,
  IMPACT_SCOPE_REQUIRES_TARGET_PICKER,
  DATA_PERMISSION_IMPACT_OPTIONS,
  DATA_PERMISSION_IMPACT_NONE,
  DATA_PERMISSION_IMPACT_UNSURE,
  OPERATIONAL_IMPACT_OPTIONS,
  OPERATIONAL_IMPACT_NONE,
  OPERATIONAL_IMPACT_UNSURE,
  IMPACT_FEELING_OPTIONS,
  CONTACT_METHOD_OPTIONS,
  validateDataPermissionImpactSelection,
  validateOperationalImpactSelection,
  buildSuggestedIncidentTitle,
} from "@/lib/incident-ui/reporterIntakeOptions";

const INCIDENT_TYPE_ICONS: Record<string, typeof AlertTriangle> = {
  "系統／功能異常": AlertTriangle,
  "服務中斷": PowerOff,
  "登入或權限問題": Lock,
  "資料異常": DatabaseZap,
  "信件／通知異常": Mail,
  "效能緩慢": Gauge,
  "部署／上線問題": Rocket,
  "資安疑慮": ShieldAlert,
  "稽核發現": ClipboardCheck,
  [REPORTER_OTHER]: MoreHorizontal,
};

const DRAFT_STORAGE_KEY = "dms-incident-intake-draft-v1";

interface IntakeState {
  systemName: string;
  systemOtherNote: string;
  service: string;
  serviceOtherNote: string;
  environment: string;
  incidentType: string;
  incidentTypeOtherNote: string;
  occurredAtQuick: string;
  occurredAtDate: string;
  occurredAtUncertain: boolean;
  title: string;
  titleManuallyEdited: boolean;
  symptomText: string;
  symptomTags: string[];
  symptomOtherNote: string;
  isOngoing: string;
  hasWorkaround: string;
  workaroundNote: string;
  impactScope: string;
  affectedUserIds: string[];
  affectedTeamIds: string[];
  dataPermissionImpact: string[];
  operationalImpact: string[];
  operationalImpactOtherNote: string;
  suggestedImpactLevel: string;
  contactMethod: string;
  contactDetail: string;
  description: string;
}

function initialState(actorEmail: string): IntakeState {
  return {
    systemName: "",
    systemOtherNote: "",
    service: "",
    serviceOtherNote: "",
    environment: "Production",
    incidentType: "",
    incidentTypeOtherNote: "",
    occurredAtQuick: "",
    occurredAtDate: "",
    occurredAtUncertain: false,
    title: "",
    titleManuallyEdited: false,
    symptomText: "",
    symptomTags: [],
    symptomOtherNote: "",
    isOngoing: "",
    hasWorkaround: "",
    workaroundNote: "",
    impactScope: "",
    affectedUserIds: [],
    affectedTeamIds: [],
    dataPermissionImpact: [],
    operationalImpact: [],
    operationalImpactOtherNote: "",
    suggestedImpactLevel: "",
    contactMethod: "Email",
    contactDetail: actorEmail,
    description: "",
  };
}

function quickTimeToIso(option: string): string {
  const now = new Date();
  if (option === "現在") return now.toISOString().slice(0, 16);
  if (option === "今天稍早") { now.setHours(now.getHours() - 3); return now.toISOString().slice(0, 16); }
  if (option === "昨天") { now.setDate(now.getDate() - 1); return now.toISOString().slice(0, 16); }
  return "";
}

export default function IncidentReporterStepper({
  actor,
  candidateUsers,
  candidateTeams,
}: {
  actor: { id: string; name: string; email: string };
  candidateUsers: Array<{ id: string; name: string }>;
  candidateTeams: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<IntakeState>(() => initialState(actor.email));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const dirtyRef = useRef(false);
  const submittedRef = useRef(false);
  const stepTopRef = useRef<HTMLDivElement>(null);

  // 草稿自動儲存：載入
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<IntakeState>;
        setState((prev) => ({ ...prev, ...parsed }));
        dirtyRef.current = true;
      }
    } catch {
      // 草稿損毀時忽略，視同沒有草稿。
    }
    setHydrated(true);
  }, []);

  // 草稿自動儲存：寫入
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage 不可用時放棄自動儲存，不影響手動送出。
    }
  }, [state, hydrated]);

  // 未送出離開頁面提示
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (dirtyRef.current && !submittedRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  function update<K extends keyof IntakeState>(key: K, value: IntakeState[K]) {
    dirtyRef.current = true;
    setState((prev) => {
      const next = { ...prev, [key]: value };
      if (!next.titleManuallyEdited && (key === "systemName" || key === "incidentType" || key === "symptomText")) {
        next.title = buildSuggestedIncidentTitle({ systemName: next.systemName, incidentType: next.incidentType, symptomText: next.symptomText });
      }
      return next;
    });
  }

  function scrollToFirstError(fieldErrors: Record<string, string>) {
    const firstKey = Object.keys(fieldErrors)[0];
    if (!firstKey) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`field-${firstKey}`) ?? document.querySelector(`[data-field="${firstKey}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function validateStep1(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!state.systemName) e.systemName = "請選擇系統";
    if (state.systemName === REPORTER_OTHER && !state.systemOtherNote.trim()) e.systemOtherNote = "請補充系統名稱";
    if (!state.service) e.service = "請選擇服務或「不確定」";
    if (state.service === REPORTER_OTHER && !state.serviceOtherNote.trim()) e.serviceOtherNote = "請補充服務名稱";
    if (!state.incidentType) e.incidentType = "請選擇事件類型";
    if (state.incidentType === REPORTER_OTHER && !state.incidentTypeOtherNote.trim()) e.incidentTypeOtherNote = "請補充事件類型說明";
    if (!state.occurredAtUncertain && !state.occurredAtDate) e.occurredAtDate = "請選擇發生時間或勾選「不確定」";
    if (!state.title.trim()) e.title = "請填寫事件名稱";
    if (!state.symptomText.trim()) e.symptomText = "請簡述您看到什麼情況";
    return e;
  }

  function validateStep2(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!state.isOngoing) e.isOngoing = "請選擇問題是否仍持續";
    if (!state.hasWorkaround) e.hasWorkaround = "請選擇是否有替代方式";
    if (!state.impactScope) e.impactScope = "請選擇影響範圍";
    if (state.dataPermissionImpact.length === 0) e.dataPermissionImpact = "請至少選擇一項，或選擇「不確定」";
    const dpErr = validateDataPermissionImpactSelection(state.dataPermissionImpact);
    if (dpErr) e.dataPermissionImpact = dpErr;
    if (state.operationalImpact.length === 0) e.operationalImpact = "請至少選擇一項，或選擇「不確定」";
    const opErr = validateOperationalImpactSelection(state.operationalImpact);
    if (opErr) e.operationalImpact = opErr;
    if (state.operationalImpact.includes(REPORTER_OTHER) && !state.operationalImpactOtherNote.trim()) e.operationalImpactOtherNote = "請補充說明";
    if (!state.suggestedImpactLevel) e.suggestedImpactLevel = "請選擇您覺得目前影響程度";
    return e;
  }

  function goNext() {
    const stepErrors = step === 1 ? validateStep1() : step === 2 ? validateStep2() : {};
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      scrollToFirstError(stepErrors);
      return;
    }
    setErrors({});
    setStep((s) => Math.min(3, s + 1));
    stepTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goBack() {
    setStep((s) => Math.max(1, s - 1));
    stepTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleDataPermission(option: string) {
    dirtyRef.current = true;
    setState((prev) => {
      let next = prev.dataPermissionImpact.includes(option)
        ? prev.dataPermissionImpact.filter((v) => v !== option)
        : [...prev.dataPermissionImpact, option];
      if (option === DATA_PERMISSION_IMPACT_NONE || option === DATA_PERMISSION_IMPACT_UNSURE) {
        next = next.includes(option) ? [option] : [];
      } else {
        next = next.filter((v) => v !== DATA_PERMISSION_IMPACT_NONE && v !== DATA_PERMISSION_IMPACT_UNSURE);
      }
      return { ...prev, dataPermissionImpact: next };
    });
  }

  function toggleOperationalImpact(option: string) {
    dirtyRef.current = true;
    setState((prev) => {
      let next = prev.operationalImpact.includes(option)
        ? prev.operationalImpact.filter((v) => v !== option)
        : [...prev.operationalImpact, option];
      if (option === OPERATIONAL_IMPACT_NONE || option === OPERATIONAL_IMPACT_UNSURE) {
        next = next.includes(option) ? [option] : [];
      } else {
        next = next.filter((v) => v !== OPERATIONAL_IMPACT_NONE && v !== OPERATIONAL_IMPACT_UNSURE);
      }
      return { ...prev, operationalImpact: next };
    });
  }

  function handleStagedFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) setStagedFiles((prev) => [...prev, file]);
  }

  async function handleSubmit() {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const result = await createIncidentAction({
        title: state.title.trim(),
        description: state.description.trim(),
        systemName: state.systemName === REPORTER_OTHER ? REPORTER_OTHER : state.systemName,
        environment: state.environment,
        incidentType: state.incidentType,
        incidentTypeOtherNote: state.incidentTypeOtherNote,
        occurredAt: state.occurredAtUncertain ? "" : new Date(state.occurredAtDate).toISOString(),
        occurredAtUncertain: state.occurredAtUncertain,
        reportSource: "快速通報介面",
        suggestedSeverity: state.suggestedImpactLevel,
        isOngoing: state.isOngoing,
        hasWorkaround: state.hasWorkaround,
        workaroundNote: state.workaroundNote,
        symptomText: state.symptomText,
        symptomTags: state.symptomTags,
        impactScope: state.impactScope,
        affectedUserIds: state.affectedUserIds,
        affectedTeamIds: state.affectedTeamIds,
        dataPermissionImpact: state.dataPermissionImpact,
        operationalImpact: state.operationalImpact,
        operationalImpactOtherNote: state.operationalImpactOtherNote,
        contactMethod: state.contactMethod,
        contactDetail: state.contactDetail,
      });
      if (!result.ok) {
        setSubmitError(result.message);
        setIsSubmitting(false);
        return;
      }
      const issueId = result.data!.issueId;
      for (const file of stagedFiles) {
        const formData = new FormData();
        formData.set("issueId", issueId);
        formData.set("file", file);
        await uploadIssueAttachmentAction(formData);
      }
      submittedRef.current = true;
      try { window.localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore */ }
      router.push(incidentRoute(issueId));
    } catch {
      setSubmitError("送出失敗，請稍後再試");
      setIsSubmitting(false);
    }
  }

  const userOptions = useMemo(() => candidateUsers.map((u) => ({ id: u.id, label: u.name })), [candidateUsers]);
  const teamOptions = useMemo(() => candidateTeams.map((t) => ({ id: t.id, label: t.name })), [candidateTeams]);

  const serviceOptions = useMemo(() => {
    const base = SYSTEM_SERVICE_MAP[state.systemName] ?? [];
    return [...base, REPORTER_UNSURE, REPORTER_OTHER];
  }, [state.systemName]);

  const impactScopeLabel = IMPACT_SCOPE_OPTIONS.find((o) => o.value === state.impactScope)?.label ?? "";

  return (
    <div className="ui-card p-5 sm:p-6" ref={stepTopRef}>
      <ol className="mb-6 flex items-center gap-2 text-xs font-medium text-text-muted" aria-label="通報步驟">
        {["第一步：發生什麼事", "第二步：影響到哪裡", "第三步：確認並送出"].map((label, index) => (
          <li key={label} className={`flex items-center gap-2 ${step === index + 1 ? "text-primary" : ""}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${step === index + 1 ? "border-primary bg-primary-muted" : step > index + 1 ? "border-workflow-complete bg-workflow-complete-muted" : "border-border"}`}>
              {index + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
            {index < 2 && <span className="mx-1 text-border" aria-hidden>—</span>}
          </li>
        ))}
      </ol>

      <p className="mb-4 rounded-md bg-primary-muted px-3 py-2 text-xs text-primary">目前只需提供已知資訊，正式分級與處理單位將由事件受理窗口確認。</p>

      {step === 1 && (
        <div className="space-y-5">
          <div id="field-systemName" data-field="systemName">
            <SearchableSelect label="系統" value={state.systemName} onChange={(v) => update("systemName", v)} options={REPORTER_SYSTEM_OPTIONS} required error={errors.systemName} />
            {state.systemName === REPORTER_OTHER && (
              <input type="text" value={state.systemOtherNote} onChange={(e) => update("systemOtherNote", e.target.value)} placeholder="請填寫系統名稱" className="ui-input mt-2" />
            )}
            {errors.systemOtherNote && <p className="mt-1 text-xs text-danger-text">{errors.systemOtherNote}</p>}
          </div>

          <div id="field-service" data-field="service">
            <SearchableSelect label="服務" value={state.service} onChange={(v) => update("service", v)} options={serviceOptions} required error={errors.service} />
            {state.service === REPORTER_OTHER && (
              <input type="text" value={state.serviceOtherNote} onChange={(e) => update("serviceOtherNote", e.target.value)} placeholder="請填寫服務名稱" className="ui-input mt-2" />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="environment">環境</label>
            <select id="environment" value={state.environment} onChange={(e) => update("environment", e.target.value)} className="ui-input">
              {ENVIRONMENTS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div id="field-incidentType" data-field="incidentType">
            <span className="block text-xs font-medium text-text-muted">事件類型（必填）</span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {INCIDENT_TYPE_OPTIONS.map((opt) => {
                const Icon = INCIDENT_TYPE_ICONS[opt] ?? MoreHorizontal;
                const selected = state.incidentType === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => update("incidentType", opt)}
                    className={`flex min-h-11 flex-col items-center gap-1 rounded-md border p-3 text-xs ${selected ? "border-primary bg-primary-muted font-medium text-primary" : "border-border text-text-secondary hover:border-primary/40"}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                    {opt}
                  </button>
                );
              })}
            </div>
            {errors.incidentType && <p className="mt-1 text-xs text-danger-text">{errors.incidentType}</p>}
            {state.incidentType === REPORTER_OTHER && (
              <input type="text" value={state.incidentTypeOtherNote} onChange={(e) => update("incidentTypeOtherNote", e.target.value)} placeholder="請簡述事件類型" className="ui-input mt-2" />
            )}
          </div>

          <div id="field-occurredAtDate" data-field="occurredAtDate">
            <span className="block text-xs font-medium text-text-muted">發生時間（必填）</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {OCCURRED_TIME_QUICK_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={state.occurredAtQuick === opt}
                  onClick={() => {
                    dirtyRef.current = true;
                    if (opt === REPORTER_UNSURE) {
                      setState((prev) => ({ ...prev, occurredAtQuick: opt, occurredAtUncertain: true, occurredAtDate: "" }));
                    } else {
                      setState((prev) => ({ ...prev, occurredAtQuick: opt, occurredAtUncertain: false, occurredAtDate: quickTimeToIso(opt) }));
                    }
                  }}
                  className={`min-h-11 rounded-full border px-3 py-1.5 text-xs ${state.occurredAtQuick === opt ? "border-primary bg-primary-muted text-primary" : "border-border text-text-secondary"}`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {!state.occurredAtUncertain && (
              <input
                type="datetime-local"
                value={state.occurredAtDate}
                onChange={(e) => update("occurredAtDate", e.target.value)}
                className="ui-input mt-2"
              />
            )}
            {errors.occurredAtDate && <p className="mt-1 text-xs text-danger-text">{errors.occurredAtDate}</p>}
          </div>

          <div id="field-title" data-field="title">
            <label className="block text-xs font-medium text-text-muted" htmlFor="title">事件名稱（必填，系統已依所選內容建議，可自行修改）</label>
            <input
              id="title"
              type="text"
              value={state.title}
              onChange={(e) => setState((prev) => ({ ...prev, title: e.target.value, titleManuallyEdited: true }))}
              className="ui-input"
              maxLength={60}
            />
            {errors.title && <p className="mt-1 text-xs text-danger-text">{errors.title}</p>}
          </div>

          <div id="field-symptomText" data-field="symptomText">
            <label className="block text-xs font-medium text-text-muted" htmlFor="symptomText">您看到什麼情況？（必填）</label>
            <input id="symptomText" type="text" value={state.symptomText} onChange={(e) => update("symptomText", e.target.value)} placeholder="例如：點擊登入後一直轉圈" className="ui-input" />
            {errors.symptomText && <p className="mt-1 text-xs text-danger-text">{errors.symptomText}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {SYMPTOM_OPTIONS.map((opt) => (
                <label key={opt} className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${state.symptomTags.includes(opt) ? "border-primary bg-primary-muted text-primary" : "border-border text-text-secondary"}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={state.symptomTags.includes(opt)}
                    onChange={() => update("symptomTags", state.symptomTags.includes(opt) ? state.symptomTags.filter((v) => v !== opt) : [...state.symptomTags, opt])}
                  />
                  {opt}
                </label>
              ))}
            </div>
            {state.symptomTags.includes(REPORTER_OTHER) && (
              <input type="text" value={state.symptomOtherNote} onChange={(e) => update("symptomOtherNote", e.target.value)} placeholder="請補充症狀說明" className="ui-input mt-2" />
            )}
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={goNext} className="ui-button-primary min-h-11">下一步</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div id="field-isOngoing" data-field="isOngoing">
            <span className="block text-xs font-medium text-text-muted">問題是否仍持續（必填）</span>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup">
              {ONGOING_OPTIONS.map((opt) => (
                <button key={opt} type="button" role="radio" aria-checked={state.isOngoing === opt} onClick={() => update("isOngoing", opt)}
                  className={`min-h-11 rounded-md border px-3 py-2 text-sm ${state.isOngoing === opt ? "border-primary bg-primary-muted font-medium text-primary" : "border-border text-text-secondary"}`}>
                  {opt}
                </button>
              ))}
            </div>
            {errors.isOngoing && <p className="mt-1 text-xs text-danger-text">{errors.isOngoing}</p>}
          </div>

          <div id="field-hasWorkaround" data-field="hasWorkaround">
            <span className="block text-xs font-medium text-text-muted">是否有替代方式（必填）</span>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup">
              {WORKAROUND_OPTIONS.map((opt) => (
                <button key={opt} type="button" role="radio" aria-checked={state.hasWorkaround === opt} onClick={() => update("hasWorkaround", opt)}
                  className={`min-h-11 rounded-md border px-3 py-2 text-sm ${state.hasWorkaround === opt ? "border-primary bg-primary-muted font-medium text-primary" : "border-border text-text-secondary"}`}>
                  {opt}
                </button>
              ))}
            </div>
            {errors.hasWorkaround && <p className="mt-1 text-xs text-danger-text">{errors.hasWorkaround}</p>}
            {state.hasWorkaround === "有" && (
              <input type="text" value={state.workaroundNote} onChange={(e) => update("workaroundNote", e.target.value)} placeholder="目前可以怎麼暫時處理？" className="ui-input mt-2" />
            )}
          </div>

          <div id="field-impactScope" data-field="impactScope">
            <span className="block text-xs font-medium text-text-muted">影響範圍（必填）</span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {IMPACT_SCOPE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" aria-pressed={state.impactScope === opt.value} onClick={() => update("impactScope", opt.value)}
                  className={`min-h-11 rounded-md border p-3 text-xs ${state.impactScope === opt.value ? "border-primary bg-primary-muted font-medium text-primary" : "border-border text-text-secondary"}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            {errors.impactScope && <p className="mt-1 text-xs text-danger-text">{errors.impactScope}</p>}
          </div>

          {IMPACT_SCOPE_REQUIRES_TARGET_PICKER.has(state.impactScope) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SearchableMultiSelect label="受影響單位" options={teamOptions} selected={state.affectedTeamIds} onChange={(ids) => update("affectedTeamIds", ids)} />
              <SearchableMultiSelect label="受影響使用者" options={userOptions} selected={state.affectedUserIds} onChange={(ids) => update("affectedUserIds", ids)} />
            </div>
          )}

          <div id="field-dataPermissionImpact" data-field="dataPermissionImpact">
            <span className="block text-xs font-medium text-text-muted">資料與權限影響（至少選擇一項或「不確定」）</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {DATA_PERMISSION_IMPACT_OPTIONS.map((opt) => (
                <label key={opt} className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${state.dataPermissionImpact.includes(opt) ? "border-primary bg-primary-muted text-primary" : "border-border text-text-secondary"}`}>
                  <input type="checkbox" className="sr-only" checked={state.dataPermissionImpact.includes(opt)} onChange={() => toggleDataPermission(opt)} />
                  {opt}
                </label>
              ))}
            </div>
            {errors.dataPermissionImpact && <p className="mt-1 text-xs text-danger-text">{errors.dataPermissionImpact}</p>}
          </div>

          <div id="field-operationalImpact" data-field="operationalImpact">
            <span className="block text-xs font-medium text-text-muted">初步營運影響（至少選擇一項或「不確定」）</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {OPERATIONAL_IMPACT_OPTIONS.map((opt) => (
                <label key={opt} className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${state.operationalImpact.includes(opt) ? "border-primary bg-primary-muted text-primary" : "border-border text-text-secondary"}`}>
                  <input type="checkbox" className="sr-only" checked={state.operationalImpact.includes(opt)} onChange={() => toggleOperationalImpact(opt)} />
                  {opt}
                </label>
              ))}
            </div>
            {errors.operationalImpact && <p className="mt-1 text-xs text-danger-text">{errors.operationalImpact}</p>}
            {state.operationalImpact.includes(REPORTER_OTHER) && (
              <input type="text" value={state.operationalImpactOtherNote} onChange={(e) => update("operationalImpactOtherNote", e.target.value)} placeholder="請補充說明" className="ui-input mt-2" />
            )}
          </div>

          <div id="field-suggestedImpactLevel" data-field="suggestedImpactLevel">
            <span className="block text-xs font-medium text-text-muted">您覺得目前影響程度如何？（必填，僅供承接窗口參考）</span>
            <div className="mt-1 flex flex-col gap-2">
              {IMPACT_FEELING_OPTIONS.map((opt) => (
                <button key={opt} type="button" role="radio" aria-checked={state.suggestedImpactLevel === opt} onClick={() => update("suggestedImpactLevel", opt)}
                  className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm ${state.suggestedImpactLevel === opt ? "border-primary bg-primary-muted font-medium text-primary" : "border-border text-text-secondary"}`}>
                  {opt}
                </button>
              ))}
            </div>
            {errors.suggestedImpactLevel && <p className="mt-1 text-xs text-danger-text">{errors.suggestedImpactLevel}</p>}
          </div>

          <div className="flex justify-between">
            <button type="button" onClick={goBack} className="ui-button-secondary min-h-11">上一步</button>
            <button type="button" onClick={goNext} className="ui-button-primary min-h-11">下一步</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm ${dragOver ? "border-primary bg-primary-muted" : "border-border"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleStagedFiles(e.dataTransfer.files); }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.items).find((item) => item.kind === "file")?.getAsFile();
              if (file) setStagedFiles((prev) => [...prev, file]);
            }}
            tabIndex={0}
          >
            <UploadCloud className="h-6 w-6 text-text-muted" aria-hidden />
            <p className="text-text-secondary">拖曳檔案、點擊選擇，或直接貼上截圖</p>
            <label className="ui-button-secondary min-h-11 cursor-pointer">
              選擇檔案
              <input type="file" className="sr-only" onChange={(e) => handleStagedFiles(e.target.files)} />
            </label>
            <p className="text-xs text-text-muted">有畫面截圖可協助加快處理，沒有也可以先送出。</p>
          </div>
          {stagedFiles.length > 0 && (
            <ul className="space-y-1">
              {stagedFiles.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
                  <FileText className="h-4 w-4 text-text-muted" aria-hidden />
                  <span className="flex-1 truncate">{file.name}</span>
                  <button type="button" aria-label={`移除 ${file.name}`} onClick={() => setStagedFiles((prev) => prev.filter((_, i) => i !== index))} className="min-h-11 min-w-11 p-2 text-text-muted hover:text-danger-text">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-text-muted" htmlFor="contactMethod">聯絡方式</label>
              <select id="contactMethod" value={state.contactMethod} onChange={(e) => update("contactMethod", e.target.value)} className="ui-input">
                {CONTACT_METHOD_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted" htmlFor="contactDetail">聯絡資訊</label>
              <input id="contactDetail" type="text" value={state.contactDetail} onChange={(e) => update("contactDetail", e.target.value)} className="ui-input" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="description">補充說明（選填）</label>
            <textarea id="description" rows={3} value={state.description} onChange={(e) => update("description", e.target.value)} className="ui-input" placeholder="有其他想補充的資訊可以寫在這裡" />
          </div>

          <div className="rounded-md border border-border bg-surface-muted p-4 text-sm">
            <h3 className="font-semibold text-text-primary">確認摘要</h3>
            <dl className="mt-2 space-y-1 text-text-secondary">
              <div><dt className="inline font-medium">系統：</dt><dd className="inline">{state.systemName === REPORTER_OTHER ? state.systemOtherNote : state.systemName}</dd></div>
              <div><dt className="inline font-medium">現象：</dt><dd className="inline">{state.symptomText}</dd></div>
              <div><dt className="inline font-medium">目前是否仍持續：</dt><dd className="inline">{state.isOngoing}</dd></div>
              <div><dt className="inline font-medium">影響範圍：</dt><dd className="inline">{impactScopeLabel}</dd></div>
              <div><dt className="inline font-medium">是否涉及資料／權限：</dt><dd className="inline">{state.dataPermissionImpact.join("、")}</dd></div>
              <div><dt className="inline font-medium">初步營運影響：</dt><dd className="inline">{state.operationalImpact.join("、")}</dd></div>
              <div><dt className="inline font-medium">附件數：</dt><dd className="inline">{stagedFiles.length}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-text-muted">以上為目前已知資訊，送出後將由事件受理窗口承接並確認影響與分級。</p>
          </div>

          {submitError && <p className="text-sm text-danger-text">{submitError}</p>}

          <div className="flex justify-between">
            <button type="button" onClick={goBack} className="ui-button-secondary min-h-11">上一步</button>
            <button type="button" disabled={isSubmitting} onClick={handleSubmit} className="ui-button-primary min-h-11">
              {isSubmitting ? "送出中…" : "送出通報"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
