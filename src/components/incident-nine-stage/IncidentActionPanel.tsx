"use client";

// Incident 事件通報流程：詳情頁「目前責任人的操作／簽核區」，依目前關卡動態顯示對應表單。
// 只有目前正式責任人（isMineToClaim／isMineToApprove／action !== VIEW_ONLY）看得到可操作
// 按鈕，非責任人僅唯讀顯示，所有退回動作皆要求填寫原因——比照既有 Hotfix ApprovalReviewPanel
// 慣例（isResponsible 唯讀切換、駁回強制填寫原因）。

import { useState, useTransition } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import {
  claimIncidentIntakeAction,
  requestIncidentSupplementAction,
  classifyIncidentAction,
  assignIncidentUnitAction,
  techLeadClaimAndAssignAction,
  techLeadReturnAction,
  submitIncidentHandlingAction,
  confirmIncidentRecoveryAction,
  confirmIncidentRcaDecisionAction,
  confirmIncidentClosureAction,
} from "@/app/issues/[id]/incident/actions";

const SEVERITY_OPTIONS = ["高", "中", "低"];
const RECOVERY_OPTIONS = ["已恢復", "部分恢復", "已控制", "尚未恢復"];

function useIncidentAction() {
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

export interface IncidentActionPanelProps {
  issueId: string;
  stageKey: string;
  isResponsible: boolean;
  waitingRoleLabel: string;
  // pendingIntake
  intakeTeamId?: string | null;
  suggestedSeverity?: string | null;
  // pendingUnitAssignment
  candidateTeams?: Array<{ id: string; name: string }>;
  // pendingTechLeadClaim
  technicalTeamMembers?: Array<{ id: string; name: string }>;
  // pendingClosureConfirmation
  approvalRecordId?: string | null;
}

export default function IncidentActionPanel(props: IncidentActionPanelProps) {
  const { error, errorCode, isPending, run } = useIncidentAction();

  if (!props.isResponsible) {
    return (
      <section id="incident-action-section" className="ui-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-text-primary">目前責任人操作</h2>
        <ReadOnlyNotice text={`僅「${props.waitingRoleLabel}」可執行此關卡操作，其餘人員唯讀。`} />
      </section>
    );
  }

  return (
    <section id="incident-action-section" className="ui-card p-5 sm:p-6">
      <h2 className="text-base font-semibold text-text-primary">目前責任人操作</h2>
      <ActionErrorText message={error} code={errorCode} itemKey={props.issueId} />

      {props.stageKey === "pendingIntake" && (
        <div className="mt-3 space-y-4">
          <form
            action={(fd) => {
              fd.set("issueId", props.issueId);
              fd.set("teamId", props.intakeTeamId ?? "");
              run(claimIncidentIntakeAction, fd);
            }}
          >
            <button type="submit" disabled={isPending || !props.intakeTeamId} className="ui-button-primary">
              {isPending ? "處理中…" : "承接此事件"}
            </button>
          </form>
          <form
            className="space-y-2"
            action={(fd) => {
              fd.set("issueId", props.issueId);
              run(requestIncidentSupplementAction, fd);
            }}
          >
            <label className="block text-xs font-medium text-text-muted" htmlFor="supplement-reason">退回補件原因（必填）</label>
            <textarea id="supplement-reason" name="reason" required rows={3} className="ui-input" placeholder="請說明需要補充的資料" />
            <button type="submit" disabled={isPending} className="ui-button-secondary">
              {isPending ? "處理中…" : "退回補件"}
            </button>
          </form>
        </div>
      )}

      {props.stageKey === "pendingClassification" && (
        <form
          className="mt-3 space-y-3"
          action={(fd) => {
            fd.set("issueId", props.issueId);
            run(classifyIncidentAction, fd);
          }}
        >
          <div>
            <label className="block text-xs font-medium text-text-muted">通報人初步影響感受（僅供參考，非正式等級）</label>
            <p className="mt-0.5 text-sm text-text-primary">{props.suggestedSeverity ?? "未提供"}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="formalSeverity">正式事件等級（必填）</label>
            <select id="formalSeverity" name="formalSeverity" required className="ui-input">
              <option value="">請選擇</option>
              {SEVERITY_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="adjustReason">等級調整原因（與建議等級不同時必填）</label>
            <textarea id="adjustReason" name="adjustReason" rows={2} className="ui-input" />
          </div>
          <button type="submit" disabled={isPending} className="ui-button-primary">
            {isPending ? "處理中…" : "完成分級"}
          </button>
        </form>
      )}

      {props.stageKey === "pendingUnitAssignment" && (
        <form
          className="mt-3 space-y-3"
          action={(fd) => {
            fd.set("issueId", props.issueId);
            run(assignIncidentUnitAction, fd);
          }}
        >
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="technicalTeamId">主要處理技術單位（必填）</label>
            <select id="technicalTeamId" name="technicalTeamId" required className="ui-input">
              <option value="">請選擇</option>
              {(props.candidateTeams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={isPending} className="ui-button-primary">
            {isPending ? "處理中…" : "指派處理單位"}
          </button>
        </form>
      )}

      {props.stageKey === "pendingTechLeadClaim" && (
        <div className="mt-3 space-y-4">
          <form
            className="space-y-3"
            action={(fd) => {
              fd.set("issueId", props.issueId);
              run(techLeadClaimAndAssignAction, fd);
            }}
          >
            <div>
              <label className="block text-xs font-medium text-text-muted" htmlFor="executorUserId">實際處理人員（必填）</label>
              <select id="executorUserId" name="executorUserId" required className="ui-input">
                <option value="">請選擇</option>
                {(props.technicalTeamMembers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button type="submit" disabled={isPending} className="ui-button-primary">
              {isPending ? "處理中…" : "接單並指派"}
            </button>
          </form>
          <form
            className="space-y-2"
            action={(fd) => {
              fd.set("issueId", props.issueId);
              run(techLeadReturnAction, fd);
            }}
          >
            <label className="block text-xs font-medium text-text-muted" htmlFor="tech-return-reason">退回原因（必填）</label>
            <textarea id="tech-return-reason" name="reason" required rows={2} className="ui-input" placeholder="目前無法承接的原因" />
            <button type="submit" disabled={isPending} className="ui-button-secondary">
              {isPending ? "處理中…" : "無法承接，退回重新指派"}
            </button>
          </form>
        </div>
      )}

      {props.stageKey === "inHandling" && (
        <form
          className="mt-3 space-y-3"
          action={(fd) => {
            fd.set("issueId", props.issueId);
            run(submitIncidentHandlingAction, fd);
          }}
        >
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="initialHandling">初步處置（必填）</label>
            <textarea id="initialHandling" name="initialHandling" required rows={3} className="ui-input" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="recoveryMeasures">復原措施（必填）</label>
            <textarea id="recoveryMeasures" name="recoveryMeasures" required rows={3} className="ui-input" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="recoveryTime">服務恢復時間</label>
            <input id="recoveryTime" name="recoveryTime" type="datetime-local" className="ui-input" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="recoveryResult">恢復結果（必填）</label>
            <select id="recoveryResult" name="recoveryResult" required className="ui-input">
              <option value="">請選擇</option>
              {RECOVERY_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="evidence">佐證／連結</label>
            <input id="evidence" name="evidence" type="text" className="ui-input" />
          </div>
          <button type="submit" disabled={isPending} className="ui-button-primary">
            {isPending ? "處理中…" : "送出初步處置與服務恢復"}
          </button>
        </form>
      )}

      {props.stageKey === "pendingRecoveryConfirmation" && (
        <form
          className="mt-3 space-y-3"
          action={(fd) => {
            fd.set("issueId", props.issueId);
            run(confirmIncidentRecoveryAction, fd);
          }}
        >
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="confirmResult">恢復結果確認（必填）</label>
            <select id="confirmResult" name="confirmResult" required className="ui-input">
              <option value="">請選擇</option>
              {RECOVERY_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="recovery-confirm-reason">未通過時的退回原因（未通過時必填）</label>
            <textarea id="recovery-confirm-reason" name="reason" rows={2} className="ui-input" />
          </div>
          <button type="submit" disabled={isPending} className="ui-button-primary">
            {isPending ? "處理中…" : "送出確認"}
          </button>
        </form>
      )}

      {props.stageKey === "pendingRcaDecision" && (
        <form
          className="mt-3 space-y-3"
          action={(fd) => {
            fd.set("issueId", props.issueId);
            run(confirmIncidentRcaDecisionAction, fd);
          }}
        >
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="needRca">是否需要 RCA（必填）</label>
            <select id="needRca" name="needRca" required className="ui-input">
              <option value="">請選擇</option>
              <option value="是">是，需要 RCA</option>
              <option value="否">否，不需要 RCA</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="rca-reason">RCA 判定原因（判定不需要 RCA 時必填）</label>
            <textarea id="rca-reason" name="reason" rows={2} className="ui-input" />
          </div>
          <button type="submit" disabled={isPending} className="ui-button-primary">
            {isPending ? "處理中…" : "完成 RCA 啟動判定"}
          </button>
        </form>
      )}

      {props.stageKey === "pendingClosureConfirmation" && (
        <form
          className="mt-3"
          action={(fd) => {
            fd.set("issueId", props.issueId);
            fd.set("approvalRecordId", props.approvalRecordId ?? "");
            run(confirmIncidentClosureAction, fd);
          }}
        >
          <button type="submit" disabled={isPending || !props.approvalRecordId} className="ui-button-primary">
            {isPending ? "處理中…" : "確認事件結案"}
          </button>
        </form>
      )}
    </section>
  );
}
