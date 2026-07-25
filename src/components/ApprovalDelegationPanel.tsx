"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "./Drawer";
import ConfirmButton from "./ConfirmButton";
import { createApprovalDelegationAction, revokeApprovalDelegationAction } from "@/lib/approvalGovernanceActions";

// M1.5-B2：核准代理的建立／撤銷操作面板。純 UI——delegator 是否具備原始資格、
// Team／approvalType 範圍是否一致、reasonCode／revocationReason 必填規則，全部由
// approvalGovernanceActions.ts 呼叫的 approvalDelegationService.ts 檢查並回傳可讀錯誤，
// 這裡只依 approvalType 決定要不要顯示 Team 欄位（純表單呈現，不構成授權判斷）。

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100";
const labelClass = "mb-1 block text-xs font-medium text-gray-700";
const submitClass =
  "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mb-1 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-text">{error}</p>;
}

const DELEGATION_APPROVAL_TYPES: { value: string; label: string; requiresTeam: boolean }[] = [
  { value: "BUSINESS_APPROVAL", label: "BUSINESS_APPROVAL（業務核准）", requiresTeam: false },
  { value: "RD_LEAD_APPROVAL", label: "RD_LEAD_APPROVAL（RD 主管核准）", requiresTeam: true },
  { value: "QA_LEAD_APPROVAL", label: "QA_LEAD_APPROVAL（QA 主管核准）", requiresTeam: true },
  { value: "DEPLOYMENT_APPROVAL", label: "DEPLOYMENT_APPROVAL（部署核准）", requiresTeam: true },
];

export function CreateApprovalDelegationPanel({
  actorId,
  canManageAnyDelegation,
  users,
  teams,
}: {
  actorId: string;
  canManageAnyDelegation: boolean;
  users: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [approvalType, setApprovalType] = useState("BUSINESS_APPROVAL");
  const [delegatorUserId, setDelegatorUserId] = useState(actorId);

  const requiresTeam = DELEGATION_APPROVAL_TYPES.find((t) => t.value === approvalType)?.requiresTeam ?? false;
  const needsReasonCode = canManageAnyDelegation && delegatorUserId !== actorId;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createApprovalDelegationAction(formData);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "發生未預期錯誤");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
      >
        ＋ 建立代理
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="建立核准代理" isSubmitting={isPending}>
        <form onSubmit={onSubmit} className="space-y-3">
          <ErrorText error={error} />
          <div>
            <label className={labelClass}>委託人（delegator）</label>
            {canManageAnyDelegation ? (
              <select
                name="delegatorUserId"
                required
                disabled={isPending}
                className={inputClass}
                value={delegatorUserId}
                onChange={(e) => setDelegatorUserId(e.target.value)}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input type="hidden" name="delegatorUserId" value={actorId} />
                <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {users.find((u) => u.id === actorId)?.name ?? actorId}（僅能建立自己是委託人的代理）
                </p>
              </>
            )}
          </div>
          <div>
            <label className={labelClass}>代理人（delegate）</label>
            <select name="delegateUserId" required disabled={isPending} className={inputClass} defaultValue="">
              <option value="" disabled>
                請選擇
              </option>
              {users
                .filter((u) => u.id !== delegatorUserId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>核准類型</label>
            <select
              name="approvalType"
              required
              disabled={isPending}
              className={inputClass}
              value={approvalType}
              onChange={(e) => setApprovalType(e.target.value)}
            >
              {DELEGATION_APPROVAL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {requiresTeam && (
            <div>
              <label className={labelClass}>Team（技術核准類型必填）</label>
              <select name="teamId" required disabled={isPending} className={inputClass} defaultValue="">
                <option value="" disabled>
                  請選擇
                </option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={labelClass}>生效日期（validFrom，可為未來日期以排定未來代理）</label>
            <input type="date" name="validFrom" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>終止日期（validUntil，必填）</label>
            <input type="date" name="validUntil" required disabled={isPending} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>業務理由（選填）</label>
            <textarea name="reason" rows={2} disabled={isPending} className={inputClass} />
          </div>
          {needsReasonCode && (
            <div>
              <label className={labelClass}>代他人建立原因（必填）</label>
              <textarea name="reasonCode" required rows={2} disabled={isPending} className={inputClass} />
            </div>
          )}
          <button type="submit" disabled={isPending} className={submitClass}>
            {isPending ? "送出中…" : "建立"}
          </button>
        </form>
      </Drawer>
    </>
  );
}

export function RevokeApprovalDelegationPanel({ delegationId }: { delegationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit() {
    const formEl = formRef.current;
    if (!formEl) return;
    setError(null);
    const formData = new FormData(formEl);
    startTransition(async () => {
      try {
        await revokeApprovalDelegationAction(formData);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "發生未預期錯誤");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-xs font-medium text-danger-text hover:opacity-80"
      >
        撤銷
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="撤銷核准代理" isSubmitting={isPending}>
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <ErrorText error={error} />
          <input type="hidden" name="delegationId" value={delegationId} />
          <div>
            <label className={labelClass}>撤銷原因（必填）</label>
            <textarea name="revocationReason" required rows={2} disabled={isPending} className={inputClass} />
          </div>
          <ConfirmButton label="撤銷" confirmLabel="確定撤銷？" disabled={isPending} onConfirm={submit} />
        </form>
      </Drawer>
    </>
  );
}
