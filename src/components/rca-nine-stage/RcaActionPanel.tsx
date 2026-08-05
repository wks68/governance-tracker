"use client";

// RCA 流程：詳情頁「目前責任人的操作／簽核區」，依目前關卡動態顯示對應表單，比照
// src/components/incident-nine-stage/IncidentActionPanel.tsx 既有慣例（isResponsible 唯讀
// 切換、駁回強制填寫原因）。改善措施本身的新增／進度更新／驗證另在 RcaActionItemsPanel。

import { useState, useTransition } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import {
  rcaTeamClaimAction,
  assignRcaOwnerAction,
  submitRcaAnalysisAction,
  decideRcaTechnicalReviewAction,
  decideRcaSecurityIntegrityReviewAction,
  decideRcaManagementConfirmationAction,
  submitImprovementProgressAction,
  submitRcaEvidenceAction,
  decideRcaVerificationAction,
  confirmRcaClosureAction,
} from "@/app/issues/[id]/rca/actions";
import { RCA_CAUSE_TYPES, RCA_ANALYSIS_METHODS } from "@/lib/constants";

function useRcaAction() {
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: (formData: FormData) => Promise<{ ok: boolean; message: string; code?: string }>, formData: FormData) {
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.message);
        setErrorCode(result.code ?? null);
        return;
      }
      window.location.reload();
    });
  }

  return { error, errorCode, isPending, run };
}

function ReadOnlyNotice({ text }: { text: string }) {
  return <p className="mt-2 text-xs text-text-muted">{text}</p>;
}

export type RcaManagementReviewSlice = {
  approvalType: "RCA_VP_CONFIRMATION" | "RCA_DIRECTOR_APPROVAL";
  isResponsible: boolean;
  decisionPending: boolean;
} | null;

export interface RcaActionPanelProps {
  issueId: string;
  stageKey: string;
  isResponsible: boolean;
  waitingRoleLabel: string;
  // pendingRcaOwnerAssignment
  candidateOwners?: Array<{ id: string; name: string }>;
  // pendingManagementConfirmation：可能同時有副部長／部長兩筆，各自獨立判斷 isResponsible。
  managementReview?: RcaManagementReviewSlice;
}

export default function RcaActionPanel(props: RcaActionPanelProps) {
  const { error, errorCode, isPending, run } = useRcaAction();

  const managementBranch = props.stageKey === "pendingManagementConfirmation";
  if (!props.isResponsible && !managementBranch) {
    return (
      <section id="rca-action-section" className="ui-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-text-primary">目前責任人操作／簽核</h2>
        <ReadOnlyNotice text={`僅「${props.waitingRoleLabel}」可執行此關卡操作，其餘人員唯讀。`} />
      </section>
    );
  }
  if (managementBranch && !props.managementReview) {
    return (
      <section id="rca-action-section" className="ui-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-text-primary">目前責任人操作／簽核</h2>
        <ReadOnlyNotice text="此等級不需管理階層確認，畫面即將自動更新。" />
      </section>
    );
  }

  return (
    <section id="rca-action-section" className="ui-card p-5 sm:p-6">
      <h2 className="text-base font-semibold text-text-primary">目前責任人操作／簽核</h2>
      <ActionErrorText message={error} code={errorCode} itemKey={props.issueId} />

      {props.stageKey === "pendingRcaTeamClaim" && (
        <form className="mt-3" action={(fd) => { fd.set("issueId", props.issueId); run(rcaTeamClaimAction, fd); }}>
          <button type="submit" disabled={isPending} className="ui-button-primary">{isPending ? "處理中…" : "承接此 RCA"}</button>
        </form>
      )}

      {props.stageKey === "pendingRcaOwnerAssignment" && (
        <form className="mt-3 space-y-3" action={(fd) => { fd.set("issueId", props.issueId); run(assignRcaOwnerAction, fd); }}>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="ownerUserId">RCA 主責人（必填）</label>
            <select id="ownerUserId" name="ownerUserId" required className="ui-input">
              <option value="">請選擇</option>
              {(props.candidateOwners ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={isPending} className="ui-button-primary">{isPending ? "處理中…" : "指派 RCA 主責人"}</button>
        </form>
      )}

      {props.stageKey === "rcaAnalysisInProgress" && (
        <form className="mt-3 space-y-3" action={(fd) => {
          fd.set("issueId", props.issueId);
          run(submitRcaAnalysisAction, fd);
        }}>
          <p className="text-xs text-text-muted">送出前請先在下方「改善追蹤」新增至少一項矯正或預防措施。</p>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="directCause">直接原因（必填）</label><textarea id="directCause" name="directCause" required rows={2} className="ui-input" /></div>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="rootCause">根本原因（必填）</label><textarea id="rootCause" name="rootCause" required rows={2} className="ui-input" /></div>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="controlFailurePoint">控制失效點</label><textarea id="controlFailurePoint" name="controlFailurePoint" rows={2} className="ui-input" /></div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="causeType">原因類型（必填）</label>
            <select id="causeType" name="causeType" required className="ui-input">
              <option value="">請選擇</option>
              {RCA_CAUSE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <fieldset>
            <legend className="block text-xs font-medium text-text-muted">分析方法（至少選擇一項）</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {RCA_ANALYSIS_METHODS.map((v) => (
                <label key={v} className="flex items-center gap-1.5 text-sm text-text-primary">
                  <input type="checkbox" name="analysisMethods" value={v} className="h-4 w-4" />{v}
                </label>
              ))}
            </div>
          </fieldset>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="rcaConclusion">RCA 結論（必填）</label><textarea id="rcaConclusion" name="rcaConclusion" required rows={2} className="ui-input" /></div>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="actualImpact">實際影響（必填）</label><textarea id="actualImpact" name="actualImpact" required rows={2} className="ui-input" /></div>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="verificationMethod">驗證方法</label><textarea id="verificationMethod" name="verificationMethod" rows={2} className="ui-input" /></div>
          <button type="submit" disabled={isPending} className="ui-button-primary">{isPending ? "處理中…" : "送出根因分析與改善計畫"}</button>
        </form>
      )}

      {props.stageKey === "pendingTechnicalReview" && (
        <div className="mt-3 space-y-3">
          <form action={(fd) => { fd.set("issueId", props.issueId); fd.set("decision", "approve"); run(decideRcaTechnicalReviewAction, fd); }}>
            <label className="block text-xs font-medium text-text-muted" htmlFor="tech-review-comment">審查意見</label>
            <textarea id="tech-review-comment" name="comment" rows={2} className="ui-input" />
            <button type="submit" disabled={isPending} className="ui-button-primary mt-2">{isPending ? "處理中…" : "技術審查通過"}</button>
          </form>
          <form action={(fd) => { fd.set("issueId", props.issueId); fd.set("decision", "reject"); run(decideRcaTechnicalReviewAction, fd); }}>
            <label className="block text-xs font-medium text-text-muted" htmlFor="tech-review-reason">退回原因（必填）</label>
            <textarea id="tech-review-reason" name="reason" required rows={2} className="ui-input" />
            <button type="submit" disabled={isPending} className="ui-button-secondary mt-2">{isPending ? "處理中…" : "退回補正"}</button>
          </form>
        </div>
      )}

      {props.stageKey === "pendingSecurityIntegrityReview" && (
        <div className="mt-3 space-y-3">
          <form action={(fd) => { fd.set("issueId", props.issueId); fd.set("decision", "approve"); run(decideRcaSecurityIntegrityReviewAction, fd); }}>
            <label className="block text-xs font-medium text-text-muted" htmlFor="integrity-comment">審查意見</label>
            <textarea id="integrity-comment" name="comment" rows={2} className="ui-input" />
            <label className="mt-2 flex items-center gap-1.5 text-sm text-text-primary">
              <input type="checkbox" name="requiresDirectorEscalation" value="是" className="h-4 w-4" />
              符合升級 DMS 部長核准之條件（跨單位廣泛影響／對外或客戶可見／法遵或個資通報義務／高稽核關注／高風險例外／經指定／符合程序4.7.3）
            </label>
            <button type="submit" disabled={isPending} className="ui-button-primary mt-2">{isPending ? "處理中…" : "完整性審查通過"}</button>
          </form>
          <form action={(fd) => { fd.set("issueId", props.issueId); fd.set("decision", "reject"); run(decideRcaSecurityIntegrityReviewAction, fd); }}>
            <label className="block text-xs font-medium text-text-muted" htmlFor="integrity-reason">退回原因（必填）</label>
            <textarea id="integrity-reason" name="reason" required rows={2} className="ui-input" />
            <button type="submit" disabled={isPending} className="ui-button-secondary mt-2">{isPending ? "處理中…" : "退回補正"}</button>
          </form>
        </div>
      )}

      {managementBranch && props.managementReview && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-text-muted">
            {props.managementReview.approvalType === "RCA_DIRECTOR_APPROVAL" ? "DMS 部長核准" : "DMS 副部長確認"}
            {props.managementReview.isResponsible ? "（您是本階段責任人）" : "（尚待其他責任人操作，本頁唯讀）"}
          </p>
          {props.managementReview.isResponsible && (
            <>
              <form action={(fd) => { fd.set("issueId", props.issueId); fd.set("approvalType", props.managementReview!.approvalType); fd.set("decision", "approve"); run(decideRcaManagementConfirmationAction, fd); }}>
                <label className="block text-xs font-medium text-text-muted" htmlFor="mgmt-comment">意見</label>
                <textarea id="mgmt-comment" name="comment" rows={2} className="ui-input" />
                <button type="submit" disabled={isPending} className="ui-button-primary mt-2">{isPending ? "處理中…" : "確認通過"}</button>
              </form>
              <form action={(fd) => { fd.set("issueId", props.issueId); fd.set("approvalType", props.managementReview!.approvalType); fd.set("decision", "reject"); run(decideRcaManagementConfirmationAction, fd); }}>
                <label className="block text-xs font-medium text-text-muted" htmlFor="mgmt-reason">駁回原因（必填）</label>
                <textarea id="mgmt-reason" name="reason" required rows={2} className="ui-input" />
                <button type="submit" disabled={isPending} className="ui-button-secondary mt-2">{isPending ? "處理中…" : "駁回"}</button>
              </form>
            </>
          )}
        </div>
      )}

      {props.stageKey === "improvementInProgress" && (
        <form className="mt-3" action={(fd) => { fd.set("issueId", props.issueId); run(submitImprovementProgressAction, fd); }}>
          <p className="text-xs text-text-muted">請先於下方「改善追蹤」將全部措施更新為已完成或建立風險例外，再送出。</p>
          <button type="submit" disabled={isPending} className="ui-button-primary mt-2">{isPending ? "處理中…" : "送出改善措施執行進度"}</button>
        </form>
      )}

      {props.stageKey === "pendingImprovementEvidence" && (
        <form className="mt-3 space-y-3" action={(fd) => { fd.set("issueId", props.issueId); run(submitRcaEvidenceAction, fd); }}>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="evidenceSummary">改善佐證摘要（必填）</label><textarea id="evidenceSummary" name="evidenceSummary" required rows={3} className="ui-input" /></div>
          <button type="submit" disabled={isPending} className="ui-button-primary">{isPending ? "處理中…" : "提交改善佐證"}</button>
        </form>
      )}

      {props.stageKey === "pendingVerificationConfirmation" && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-text-muted">請先於下方「改善追蹤」為每項措施填寫驗證結果，全部通過或建立風險例外後再確認。</p>
          <form action={(fd) => { fd.set("issueId", props.issueId); fd.set("decision", "approve"); run(decideRcaVerificationAction, fd); }}>
            <label className="block text-xs font-medium text-text-muted" htmlFor="verify-comment">意見</label>
            <textarea id="verify-comment" name="comment" rows={2} className="ui-input" />
            <button type="submit" disabled={isPending} className="ui-button-primary mt-2">{isPending ? "處理中…" : "驗證與資安確認通過"}</button>
          </form>
          <form action={(fd) => { fd.set("issueId", props.issueId); fd.set("decision", "reject"); run(decideRcaVerificationAction, fd); }}>
            <label className="block text-xs font-medium text-text-muted" htmlFor="verify-reason">不通過原因（必填）</label>
            <textarea id="verify-reason" name="reason" required rows={2} className="ui-input" />
            <button type="submit" disabled={isPending} className="ui-button-secondary mt-2">{isPending ? "處理中…" : "驗證不通過，退回改善"}</button>
          </form>
        </div>
      )}

      {props.stageKey === "pendingRcaClosureConfirmation" && (
        <form className="mt-3 space-y-3" action={(fd) => { fd.set("issueId", props.issueId); run(confirmRcaClosureAction, fd); }}>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="closure-comment">結案意見</label><textarea id="closure-comment" name="comment" rows={2} className="ui-input" /></div>
          <button type="submit" disabled={isPending} className="ui-button-primary">{isPending ? "處理中…" : "確認 RCA 結案"}</button>
        </form>
      )}
    </section>
  );
}
