"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText, ActionSuccessText } from "@/components/ActionResultBanner";
import type { ActionResult } from "@/lib/actionResult";
import {
  OP_COMPONENT_TYPE_OPTIONS,
  OP_DEPLOY_FIELDS,
  OP_IMPACT_OPTIONS,
  OP_MONITORING_METHOD_OPTIONS,
  OP_OPERATION_TYPE_OPTIONS,
  OP_RESULT_FIELDS,
  parseMultiValue,
} from "@/lib/hotfix-ui/executionFields";
import { ENVIRONMENTS } from "@/lib/constants";
import RichTextEditor from "@/components/rich-text/RichTextEditor";

type FormAction = (formData: FormData) => Promise<ActionResult>;
const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";
const requiredMark = <span className="ml-1 text-danger">*</span>;
const RichUploadContext = createContext<(name: string, busy: boolean) => void>(() => undefined);

function RichField({ issueId, name, value, onChange, disabled, placeholder }: { issueId: string; name: string; value: string; onChange: (value: string) => void; disabled: boolean; placeholder?: string }) {
  const reportBusy = useContext(RichUploadContext);
  return <RichTextEditor name={name} issueId={issueId} value={value} onChange={onChange} onBusyChange={(busy) => reportBusy(name, busy)} disabled={disabled} minHeight={180} placeholder={placeholder ?? "請填寫說明"} />;
}

function RadioGroup({ name, value, options, disabled, onChange }: { name: string; value: string; options: readonly string[]; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-4">
      {options.map((option) => (
        <label key={option} className="flex items-center gap-1.5 text-sm text-gray-700">
          <input type="radio" name={name} value={option} checked={value === option} disabled={disabled} onChange={() => onChange(option)} />
          {option}
        </label>
      ))}
    </div>
  );
}

function MultiSelectTags({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);
  }
  return (
    <div>
      <label className={labelCls}>{label}{requiredMark}</label>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((item) => (
            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-1 text-xs text-primary">
              {item}
              <button type="button" disabled={disabled} aria-label={`移除 ${item}`} onClick={() => toggle(item)} className="font-bold">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="grid gap-2 rounded-md border border-gray-200 p-3 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={value.includes(option)} disabled={disabled} onChange={() => toggle(option)} className="mt-0.5" />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
}

function useExecutionForm(issueId: string, stageKey: string, fieldKeys: readonly string[], initialValues: Record<string, string>, saveAction: FormAction, submitAction: FormAction) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [busyRichTextFields, setBusyRichTextFields] = useState<Set<string>>(new Set());

  function setValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  function buildFormData() {
    const data = new FormData();
    data.set("issueId", issueId);
    data.set("stageKey", stageKey);
    for (const key of fieldKeys) data.set(key, values[key] ?? "");
    return data;
  }
  function run(action: FormAction, fallback: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action(buildFormData());
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message || fallback);
      router.refresh();
    });
  }
  function setRichTextBusy(name: string, busy: boolean) {
    setBusyRichTextFields((current) => { const next = new Set(current); busy ? next.add(name) : next.delete(name); return next; });
  }
  return { values, setValue, setValues, error, success, isPending, run, saveAction, submitAction, setRichTextBusy, richTextBusy: busyRichTextFields.size > 0 };
}

export function OpPreDeploymentForm({ issueId, initialValues, saveAction, submitAction }: { issueId: string; initialValues: Record<string, string>; saveAction: FormAction; submitAction: FormAction }) {
  const form = useExecutionForm(issueId, "opPreparing", OP_DEPLOY_FIELDS.map((field) => field.key), initialValues, saveAction, submitAction);
  const operations = parseMultiValue(form.values.opOperationTypes);
  const components = parseMultiValue(form.values.opComponentTypes);
  const impacts = parseMultiValue(form.values.opExpectedImpacts);
  const serviceOperation = form.values.opServiceOperationRequired === "是";
  const announcement = form.values.opAnnouncementRequired === "是";
  const monitoringNotApplicable = form.values.opMonitoringMethod === "不適用";

  function setImpacts(next: string[]) {
    const normalized = next.includes("無明顯影響") && !impacts.includes("無明顯影響")
      ? ["無明顯影響"]
      : next.filter((item) => item !== "無明顯影響");
    form.setValue("opExpectedImpacts", JSON.stringify(normalized));
  }

  return (
    <RichUploadContext.Provider value={form.setRichTextBusy}><section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">上版前確認</h2>
      <p className="mt-1 text-xs text-gray-500">所有日期時間固定以 Asia/Taipei 顯示與解讀；附件為選填。</p>
      <ActionErrorText message={form.error} />
      <ActionSuccessText message={form.success} />
      <div className="mt-4 space-y-5">
        <div><label className={labelCls}>部署環境{requiredMark}</label><select value={form.values.opDeployEnvironment ?? ""} disabled={form.isPending} onChange={(e) => form.setValue("opDeployEnvironment", e.target.value)} className={inputCls}><option value="">請選擇</option>{ENVIRONMENTS.map((item) => <option key={item}>{item}</option>)}</select></div>
        <div><label className={labelCls}>預計部署時間{requiredMark}</label><input type="datetime-local" value={form.values.opDeployPlannedAt ?? ""} disabled={form.isPending} onChange={(e) => form.setValue("opDeployPlannedAt", e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>預計影響時間{requiredMark}</label><RadioGroup name="impact-duration" value={form.values.opImpactDurationMode ?? ""} options={["無", "約"]} disabled={form.isPending} onChange={(value) => { form.setValue("opImpactDurationMode", value); if (value === "無") form.setValue("opImpactDurationMinutes", ""); }} />{form.values.opImpactDurationMode === "約" && <input type="number" min="1" step="1" placeholder="分鐘" value={form.values.opImpactDurationMinutes ?? ""} disabled={form.isPending} onChange={(e) => form.setValue("opImpactDurationMinutes", e.target.value)} className={`mt-2 ${inputCls}`} />}</div>
        <div><label className={labelCls}>是否需公告{requiredMark}</label><RadioGroup name="announcement" value={form.values.opAnnouncementRequired ?? ""} options={["否", "是"]} disabled={form.isPending} onChange={(value) => { form.setValue("opAnnouncementRequired", value); if (value === "否") form.setValues((current) => ({ ...current, opAnnouncementRequired: value, opAnnouncementAudience: "", opAnnouncementPlannedAt: "", opAnnouncementSummary: "" })); }} /></div>
        {announcement && <div className="grid gap-3 rounded-md border border-gray-200 p-3"><div><label className={labelCls}>公告對象{requiredMark}</label><input value={form.values.opAnnouncementAudience ?? ""} onChange={(e) => form.setValue("opAnnouncementAudience", e.target.value)} className={inputCls} /></div><div><label className={labelCls}>預計公告時間{requiredMark}</label><input type="datetime-local" value={form.values.opAnnouncementPlannedAt ?? ""} onChange={(e) => form.setValue("opAnnouncementPlannedAt", e.target.value)} className={inputCls} /></div><div><label className={labelCls}>公告內容摘要{requiredMark}</label><RichField issueId={issueId} name="opAnnouncementSummary" value={form.values.opAnnouncementSummary ?? ""} onChange={(value) => form.setValue("opAnnouncementSummary", value)} disabled={form.isPending} /></div></div>}
        <div><label className={labelCls}>是否需停止、啟動、重啟、切換或暫停服務／元件{requiredMark} <span className="cursor-help rounded-full border border-gray-400 px-1.5 text-xs" title="包含但不限於停止、啟動、重新啟動、重新載入、滾動重啟、重新部署、節點切換、主備切換、暫停、恢復、重建、節點上下線及擴縮容 Apache、Nginx、IIS、Tomcat、JBoss、WebLogic、Kubernetes／K8s、Pod、Container、Docker、應用程式服務、API、背景服務、批次排程、資料庫、Redis／Cache、Solr／Elasticsearch、Message Queue、Load Balancer、Reverse Proxy、API Gateway、檔案或物件儲存、監控服務、DNS、網路、防火牆及其他基礎設施或中介軟體。只要部署過程包含任一操作，均應選擇『是』。">?</span></label><RadioGroup name="service-operation" value={form.values.opServiceOperationRequired ?? ""} options={["否", "是"]} disabled={form.isPending} onChange={(value) => { if (value === "否") form.setValues((current) => ({ ...current, opServiceOperationRequired: value, opOperationTypes: "[]", opOperationOther: "", opComponentTypes: "[]", opComponentOther: "", opOperationTargets: "", opOperationPlannedAt: "", opOperationImpactMinutes: "", opOperationImpactScope: "" })); else form.setValue("opServiceOperationRequired", value); }} /></div>
        {serviceOperation && <div className="space-y-4 rounded-md border border-gray-200 p-3"><MultiSelectTags label="操作類型" options={OP_OPERATION_TYPE_OPTIONS} value={operations} disabled={form.isPending} onChange={(value) => form.setValue("opOperationTypes", JSON.stringify(value))} />{operations.includes("其他") && <div><label className={labelCls}>其他操作說明{requiredMark}</label><input value={form.values.opOperationOther ?? ""} onChange={(e) => form.setValue("opOperationOther", e.target.value)} className={inputCls} /></div>}<MultiSelectTags label="服務／元件類型" options={OP_COMPONENT_TYPE_OPTIONS} value={components} disabled={form.isPending} onChange={(value) => form.setValue("opComponentTypes", JSON.stringify(value))} />{components.includes("其他") && <div><label className={labelCls}>其他服務或元件說明{requiredMark}</label><input value={form.values.opComponentOther ?? ""} onChange={(e) => form.setValue("opComponentOther", e.target.value)} className={inputCls} /></div>}<div><label className={labelCls}>實際操作標的{requiredMark}</label><input placeholder="例如 MyDMS Web Pod、production namespace" value={form.values.opOperationTargets ?? ""} onChange={(e) => form.setValue("opOperationTargets", e.target.value)} className={inputCls} /></div><div><label className={labelCls}>預計操作時間{requiredMark}</label><input type="datetime-local" value={form.values.opOperationPlannedAt ?? ""} onChange={(e) => form.setValue("opOperationPlannedAt", e.target.value)} className={inputCls} /></div><div><label className={labelCls}>操作造成的預計影響時間（分鐘）{requiredMark}</label><input type="number" min="1" step="1" value={form.values.opOperationImpactMinutes ?? ""} onChange={(e) => form.setValue("opOperationImpactMinutes", e.target.value)} className={inputCls} /></div><div><label className={labelCls}>影響範圍{requiredMark}</label><RichField issueId={issueId} name="opOperationImpactScope" value={form.values.opOperationImpactScope ?? ""} onChange={(value) => form.setValue("opOperationImpactScope", value)} disabled={form.isPending} /></div></div>}
        <MultiSelectTags label="預計影響" options={OP_IMPACT_OPTIONS} value={impacts} disabled={form.isPending} onChange={setImpacts} />
        {impacts.includes("其他") && <div><label className={labelCls}>其他影響說明{requiredMark}</label><input value={form.values.opImpactOther ?? ""} onChange={(e) => form.setValue("opImpactOther", e.target.value)} className={inputCls} /></div>}
        {serviceOperation && impacts.length === 1 && impacts[0] === "無明顯影響" && <div className="rounded-md border border-warning-border bg-warning-bg p-3"><label className={labelCls}>無明顯影響判定說明{requiredMark}</label><RichField issueId={issueId} name="opNoImpactJustification" value={form.values.opNoImpactJustification ?? ""} onChange={(value) => form.setValue("opNoImpactJustification", value)} disabled={form.isPending} /></div>}
        <div><label className={labelCls}>上版步驟摘要{requiredMark}</label><RichField issueId={issueId} name="opDeploySteps" value={form.values.opDeploySteps ?? ""} onChange={(value) => form.setValue("opDeploySteps", value)} disabled={form.isPending} placeholder="請依序填寫上版步驟" /></div>
        <div><label className={labelCls}>Rollback 觸發條件{requiredMark}</label><RichField issueId={issueId} name="opRollbackTrigger" value={form.values.opRollbackTrigger ?? ""} onChange={(value) => form.setValue("opRollbackTrigger", value)} disabled={form.isPending} /></div>
        <div><label className={labelCls}>Rollback 方式{requiredMark}</label><RichField issueId={issueId} name="opRollbackPlan" value={form.values.opRollbackPlan ?? ""} onChange={(value) => form.setValue("opRollbackPlan", value)} disabled={form.isPending} /></div>
        <div><label className={labelCls}>無法立即 Rollback 時之處置{requiredMark}</label><RadioGroup name="rollback-unavailable" value={form.values.opRollbackUnavailableMode ?? ""} options={["不適用", "臨時處置說明"]} disabled={form.isPending} onChange={(value) => { form.setValue("opRollbackUnavailableMode", value); if (value === "不適用") form.setValue("opRollbackUnavailableDetail", ""); }} />{form.values.opRollbackUnavailableMode === "臨時處置說明" && <div className="mt-2"><RichField issueId={issueId} name="opRollbackUnavailableDetail" value={form.values.opRollbackUnavailableDetail ?? ""} onChange={(value) => form.setValue("opRollbackUnavailableDetail", value)} disabled={form.isPending} /></div>}</div>
        <div><label className={labelCls}>監控方式{requiredMark}</label><select value={form.values.opMonitoringMethod ?? ""} onChange={(e) => form.setValue("opMonitoringMethod", e.target.value)} className={inputCls}><option value="">請選擇</option>{OP_MONITORING_METHOD_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></div>
        {monitoringNotApplicable ? <div className="rounded-md border border-warning-border bg-warning-bg p-3"><label className={labelCls}>不適用原因{requiredMark}</label><RichField issueId={issueId} name="opMonitoringNotApplicableReason" value={form.values.opMonitoringNotApplicableReason ?? ""} onChange={(value) => form.setValue("opMonitoringNotApplicableReason", value)} disabled={form.isPending} /></div> : form.values.opMonitoringMethod && <div className="space-y-3 rounded-md border border-gray-200 p-3"><div><label className={labelCls}>監控連結或查詢方式{requiredMark}</label><input value={form.values.opMonitoringAccess ?? ""} onChange={(e) => form.setValue("opMonitoringAccess", e.target.value)} className={inputCls} /></div>{[["opMonitoringPageConfirmed", "已確認監控頁面或查詢方式可正常使用"], ["opMonitoringMetricsConfirmed", "已確認本次部署後需觀察的服務／指標"], ["opMonitoringRecipientsConfirmed", "已確認異常告警或通知接收對象"]].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.values[key] === "true"} onChange={(e) => form.setValue(key, e.target.checked ? "true" : "")} />{label}{requiredMark}</label>)}</div>}
      </div>
      <div className="mt-5 flex gap-2"><button type="button" disabled={form.isPending || form.richTextBusy} onClick={() => form.run(form.saveAction, "已暫存")} className="rounded-md border border-gray-300 px-4 py-2 text-sm">暫存</button><button type="button" disabled={form.isPending || form.richTextBusy} onClick={() => form.run(form.submitAction, "已送上版前核准")} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{form.isPending ? "處理中…" : "送上版前核准"}</button></div>
    </section></RichUploadContext.Provider>
  );
}

export function OpDeploymentResultForm({ issueId, initialValues, saveAction, submitAction }: { issueId: string; initialValues: Record<string, string>; saveAction: FormAction; submitAction: FormAction }) {
  const form = useExecutionForm(issueId, "opDeploying", OP_RESULT_FIELDS.map((field) => field.key), initialValues, saveAction, submitAction);
  return (
    <RichUploadContext.Provider value={form.setRichTextBusy}><section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">正式環境部署紀錄</h2>
      <p className="mt-1 text-xs text-gray-500">上版前主管核准完成後，僅原 OP 執行人可填寫。</p>
      <ActionErrorText message={form.error} /><ActionSuccessText message={form.success} />
      <div className="mt-4 space-y-4">
        <div><label className={labelCls}>實際開始時間{requiredMark}</label><input type="datetime-local" value={form.values.opActualStartedAt ?? ""} onChange={(e) => form.setValue("opActualStartedAt", e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>實際完成時間{requiredMark}</label><input type="datetime-local" value={form.values.opActualCompletedAt ?? ""} onChange={(e) => form.setValue("opActualCompletedAt", e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>部署結果{requiredMark}</label><RadioGroup name="deploy-result" value={form.values.opDeployResult ?? ""} options={["完成", "未完成"]} disabled={form.isPending} onChange={(value) => form.setValue("opDeployResult", value)} /></div>
        <div><label className={labelCls}>異常與處置{requiredMark}</label><RadioGroup name="incident" value={form.values.opIncidentStatus ?? ""} options={["無", "有"]} disabled={form.isPending} onChange={(value) => { form.setValue("opIncidentStatus", value); if (value === "無" && form.values.opDeployResult !== "未完成") form.setValue("opIncidentDetail", ""); }} />{(form.values.opIncidentStatus === "有" || form.values.opDeployResult === "未完成") && <div className="mt-2"><RichField issueId={issueId} name="opIncidentDetail" value={form.values.opIncidentDetail ?? ""} onChange={(value) => form.setValue("opIncidentDetail", value)} disabled={form.isPending} placeholder="請說明異常與處置" /></div>}</div>
        <div><label className={labelCls}>是否啟動 Rollback{requiredMark}</label><RadioGroup name="rollback-activated" value={form.values.opRollbackActivated ?? ""} options={["否", "是"]} disabled={form.isPending} onChange={(value) => { form.setValue("opRollbackActivated", value); if (value === "否") form.setValue("opRollbackResult", ""); }} />{form.values.opRollbackActivated === "是" && <div className="mt-2"><RichField issueId={issueId} name="opRollbackResult" value={form.values.opRollbackResult ?? ""} onChange={(value) => form.setValue("opRollbackResult", value)} disabled={form.isPending} placeholder="Rollback 結果" /></div>}</div>
        <div><label className={labelCls}>部署後監控結果{requiredMark}</label><RadioGroup name="post-monitoring" value={form.values.opPostMonitoringResult ?? ""} options={["正常", "異常"]} disabled={form.isPending} onChange={(value) => { form.setValue("opPostMonitoringResult", value); if (value === "正常") form.setValue("opPostMonitoringDetail", ""); }} />{form.values.opPostMonitoringResult === "異常" && <div className="mt-2"><RichField issueId={issueId} name="opPostMonitoringDetail" value={form.values.opPostMonitoringDetail ?? ""} onChange={(value) => form.setValue("opPostMonitoringDetail", value)} disabled={form.isPending} placeholder="請說明監控異常" /></div>}</div>
      </div>
      <div className="mt-5 flex gap-2"><button type="button" disabled={form.isPending || form.richTextBusy} onClick={() => form.run(form.saveAction, "已暫存")} className="rounded-md border border-gray-300 px-4 py-2 text-sm">暫存</button><button type="button" disabled={form.isPending || form.richTextBusy} onClick={() => form.run(form.submitAction, "已送上版後確認")} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{form.isPending ? "處理中…" : "送上版後確認"}</button></div>
    </section></RichUploadContext.Provider>
  );
}
