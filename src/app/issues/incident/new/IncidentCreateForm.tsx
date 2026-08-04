"use client";

import { useTransition, useState } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { createIncidentAction } from "./actions";
import { SYSTEM_NAME_OPTIONS, ENVIRONMENTS, RISK_LEVELS } from "@/lib/constants";

const INCIDENT_TYPES = ["系統／功能異常", "服務中斷", "資安事件", "權限問題", "資料問題", "Hotfix", "部署／上線", "稽核缺失", "其他"];

export default function IncidentCreateForm() {
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="ui-card space-y-5 p-5 sm:p-6"
      action={(formData) => {
        setError(null);
        setErrorCode(null);
        startTransition(async () => {
          const result = await createIncidentAction(formData);
          if (result && !result.ok) {
            setError(result.message);
            setErrorCode(result.code ?? null);
          }
        });
      }}
    >
      <ActionErrorText message={error} code={errorCode} />

      <div>
        <label className="block text-xs font-medium text-text-muted" htmlFor="title">事件名稱（必填）</label>
        <input id="title" name="title" required type="text" className="ui-input" />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted" htmlFor="description">事件摘要（必填）</label>
        <textarea id="description" name="description" required rows={4} className="ui-input" placeholder="請描述事件發生經過與觀察到的現象" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-text-muted" htmlFor="systemName">系統名稱（必填）</label>
          <select id="systemName" name="systemName" required className="ui-input">
            <option value="">請選擇</option>
            {SYSTEM_NAME_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted" htmlFor="environment">環境（必填）</label>
          <select id="environment" name="environment" required className="ui-input">
            <option value="">請選擇</option>
            {ENVIRONMENTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-text-muted" htmlFor="incidentType">事件類型（必填）</label>
          <select id="incidentType" name="incidentType" required className="ui-input">
            <option value="">請選擇</option>
            {INCIDENT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted" htmlFor="suggestedSeverity">建議事件等級（必填，僅供參考，正式等級由受理窗口決定）</label>
          <select id="suggestedSeverity" name="suggestedSeverity" required className="ui-input">
            <option value="">請選擇</option>
            {RISK_LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-text-muted" htmlFor="occurredAt">事件發生時間（必填）</label>
          <input id="occurredAt" name="occurredAt" required type="datetime-local" className="ui-input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted" htmlFor="reportSource">通報來源（必填）</label>
          <input id="reportSource" name="reportSource" required type="text" className="ui-input" placeholder="例如：監控告警、使用者反映、內部發現" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="block text-xs font-medium text-text-muted">問題是否仍持續</span>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" name="isOngoing" value="是" defaultChecked /> 是</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="isOngoing" value="否" /> 否</label>
          </div>
        </div>
        <div>
          <span className="block text-xs font-medium text-text-muted">是否有替代方案</span>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" name="hasWorkaround" value="是" /> 是</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="hasWorkaround" value="否" defaultChecked /> 否</label>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted" htmlFor="affectedScope">受影響系統／功能／使用者／資料權限</label>
        <textarea id="affectedScope" name="affectedScope" rows={2} className="ui-input" />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted" htmlFor="impactSummary">初步營運影響</label>
        <textarea id="impactSummary" name="impactSummary" rows={2} className="ui-input" />
      </div>

      <button type="submit" disabled={isPending} className="ui-button-primary">
        {isPending ? "送出中…" : "建立並送出待承接"}
      </button>
    </form>
  );
}
