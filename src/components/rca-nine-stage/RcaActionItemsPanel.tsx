"use client";

// RCA 流程：改善追蹤——矯正／預防措施清單，各自獨立追蹤責任單位／責任人／預定與實際完成
// 日期／完成狀態／佐證／驗證方法與結果／展延原因（見任務規格第十五節），比照
// RcaActionItem 資料模型逐欄位呈現，不塞進單一大文字欄位。

import { useState, useTransition } from "react";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { createRcaActionItemAction, updateRcaActionItemProgressAction, verifyRcaActionItemAction } from "@/app/issues/[id]/rca/actions";
import { RCA_ACTION_ITEM_TYPES, RCA_ACTION_ITEM_STATUSES, RCA_VERIFICATION_STATUSES } from "@/lib/constants";
import { formatDateTime } from "@/lib/datetime";

const TYPE_LABEL: Record<string, string> = { CORRECTIVE: "矯正措施", PREVENTIVE: "預防措施" };
const STATUS_LABEL: Record<string, string> = { PLANNED: "規劃中", IN_PROGRESS: "執行中", COMPLETED: "已完成", EXTENDED: "已展延", RISK_EXCEPTION: "風險例外" };
const VERIFICATION_LABEL: Record<string, string> = { PENDING: "待驗證", PASSED: "通過", FAILED: "不通過", NOT_APPLICABLE: "不適用" };

export interface RcaActionItemRow {
  id: string;
  sequence: number;
  type: string;
  description: string;
  ownerTeamName: string | null;
  ownerUserName: string | null;
  plannedCompletionDate: string;
  actualCompletionDate: string | null;
  status: string;
  evidenceSummary: string | null;
  verificationMethod: string | null;
  verificationStatus: string;
  verificationNote: string | null;
  extensionReason: string | null;
}

function useItemAction() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  function run(action: (formData: FormData) => Promise<{ ok: boolean; message: string }>, formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) { setError(result.message); return; }
      window.location.reload();
    });
  }
  return { error, isPending, run };
}

export default function RcaActionItemsPanel({
  issueId,
  items,
  canManage,
  canVerify,
  candidateOwnerTeamId,
  candidateOwnerMembers,
}: {
  issueId: string;
  items: RcaActionItemRow[];
  canManage: boolean;
  canVerify: boolean;
  candidateOwnerTeamId: string | null;
  candidateOwnerMembers: Array<{ id: string; name: string }>;
}) {
  const { error, isPending, run } = useItemAction();

  return (
    <section id="rca-action-items-section" className="ui-card p-5 sm:p-6">
      <h2 className="text-base font-semibold text-text-primary">改善追蹤</h2>
      <ActionErrorText message={error} code={null} itemKey={issueId} />

      {items.length === 0 && <p className="mt-3 text-sm text-text-muted">尚未建立任何矯正或預防措施。</p>}

      <ul className="mt-3 space-y-4">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-text-primary">#{item.sequence} {TYPE_LABEL[item.type] ?? item.type}</span>
              <span className="rounded-full bg-primary-muted px-2 py-0.5 text-xs font-medium text-primary">{STATUS_LABEL[item.status] ?? item.status}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{item.description}</p>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <div><dt className="text-text-muted">責任單位</dt><dd className="text-text-primary">{item.ownerTeamName ?? "—"}</dd></div>
              <div><dt className="text-text-muted">責任人</dt><dd className="text-text-primary">{item.ownerUserName ?? "—"}</dd></div>
              <div><dt className="text-text-muted">預定完成日期</dt><dd className="text-text-primary">{formatDateTime(item.plannedCompletionDate)}</dd></div>
              <div><dt className="text-text-muted">實際完成日期</dt><dd className="text-text-primary">{item.actualCompletionDate ? formatDateTime(item.actualCompletionDate) : "—"}</dd></div>
              <div><dt className="text-text-muted">驗證方法</dt><dd className="text-text-primary">{item.verificationMethod ?? "—"}</dd></div>
              <div><dt className="text-text-muted">驗證結果</dt><dd className="text-text-primary">{VERIFICATION_LABEL[item.verificationStatus] ?? item.verificationStatus}</dd></div>
              {item.evidenceSummary && <div className="sm:col-span-2"><dt className="text-text-muted">佐證</dt><dd className="whitespace-pre-wrap text-text-primary">{item.evidenceSummary}</dd></div>}
              {item.extensionReason && <div className="sm:col-span-2"><dt className="text-text-muted">展延／風險例外原因</dt><dd className="whitespace-pre-wrap text-text-primary">{item.extensionReason}</dd></div>}
              {item.verificationNote && <div className="sm:col-span-2"><dt className="text-text-muted">驗證意見</dt><dd className="whitespace-pre-wrap text-text-primary">{item.verificationNote}</dd></div>}
            </dl>

            {canManage && (
              <form
                className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
                action={(fd) => { fd.set("issueId", issueId); fd.set("actionItemId", item.id); run(updateRcaActionItemProgressAction, fd); }}
              >
                <div>
                  <label className="block text-[11px] text-text-muted" htmlFor={`status-${item.id}`}>更新狀態</label>
                  <select id={`status-${item.id}`} name="status" defaultValue={item.status} className="ui-input">
                    {RCA_ACTION_ITEM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-text-muted" htmlFor={`actual-${item.id}`}>實際完成日期</label>
                  <input id={`actual-${item.id}`} name="actualCompletionDate" type="date" className="ui-input" />
                </div>
                <div className="min-w-[10rem] flex-1">
                  <label className="block text-[11px] text-text-muted" htmlFor={`evidence-${item.id}`}>佐證摘要</label>
                  <input id={`evidence-${item.id}`} name="evidenceSummary" type="text" className="ui-input" />
                </div>
                <div className="min-w-[10rem] flex-1">
                  <label className="block text-[11px] text-text-muted" htmlFor={`extension-${item.id}`}>展延／風險例外原因</label>
                  <input id={`extension-${item.id}`} name="extensionReason" type="text" className="ui-input" />
                </div>
                <button type="submit" disabled={isPending} className="ui-button-secondary">{isPending ? "處理中…" : "更新"}</button>
              </form>
            )}

            {canVerify && (
              <form
                className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
                action={(fd) => { fd.set("issueId", issueId); fd.set("actionItemId", item.id); run(verifyRcaActionItemAction, fd); }}
              >
                <div>
                  <label className="block text-[11px] text-text-muted" htmlFor={`verify-status-${item.id}`}>驗證結果</label>
                  <select id={`verify-status-${item.id}`} name="verificationStatus" defaultValue="PASSED" className="ui-input">
                    {RCA_VERIFICATION_STATUSES.filter((s) => s !== "PENDING").map((s) => <option key={s} value={s}>{VERIFICATION_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="min-w-[10rem] flex-1">
                  <label className="block text-[11px] text-text-muted" htmlFor={`verify-note-${item.id}`}>驗證意見</label>
                  <input id={`verify-note-${item.id}`} name="verificationNote" type="text" className="ui-input" />
                </div>
                <button type="submit" disabled={isPending} className="ui-button-secondary">{isPending ? "處理中…" : "填寫驗證結果"}</button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <form
          className="mt-5 space-y-3 border-t border-border pt-4"
          action={(fd) => {
            fd.set("issueId", issueId);
            fd.set("ownerTeamId", candidateOwnerTeamId ?? "");
            run(createRcaActionItemAction, fd);
          }}
        >
          <h3 className="text-sm font-semibold text-text-primary">新增改善措施</h3>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="new-item-type">類型（必填）</label>
            <select id="new-item-type" name="type" required className="ui-input">
              <option value="">請選擇</option>
              {RCA_ACTION_ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="new-item-desc">措施內容（必填）</label><textarea id="new-item-desc" name="description" required rows={2} className="ui-input" /></div>
          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="new-item-owner">責任人</label>
            <select id="new-item-owner" name="ownerUserId" className="ui-input">
              <option value="">未指定</option>
              {candidateOwnerMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="new-item-planned">預定完成日期（必填）</label><input id="new-item-planned" name="plannedCompletionDate" type="date" required className="ui-input" /></div>
          <div><label className="block text-xs font-medium text-text-muted" htmlFor="new-item-verification">驗證方法</label><input id="new-item-verification" name="verificationMethod" type="text" className="ui-input" /></div>
          <button type="submit" disabled={isPending} className="ui-button-primary">{isPending ? "處理中…" : "新增措施"}</button>
        </form>
      )}
    </section>
  );
}
