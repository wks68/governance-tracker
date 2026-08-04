"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import ConfirmButton from "@/components/ConfirmButton";
import { ActionErrorText } from "@/components/ActionResultBanner";
import ReasonCodeField from "./ReasonCodeField";
import DeactivationImpactPanel from "./DeactivationImpactPanel";
import type { DeactivationImpactItem } from "@/lib/peopleService";
import { activatePersonAction, checkDeactivationImpactAction, deactivatePersonAction } from "@/app/admin/people/actions";

// M1.5-C1-C 新增：啟用／停用管理面板。
//
// 停用一律兩階段：先明確按「檢查停用影響」（寫入 UserDeactivationImpactChecked
// AuditLog），blocking 存在時第二階段（確認停用）表單直接停用送出；deactivatePerson
// 服務層仍會在 transaction 內重新計算一次，本元件的 disabled 只是 UX 提示，不是唯一防線。
export default function PersonStatusManager({ userId, isActive }: { userId: string; isActive: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [activateOpen, setActivateOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [impact, setImpact] = useState<DeactivationImpactItem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const deactivateFormRef = useRef<HTMLFormElement>(null);

  const hasBlocking = impact?.some((i) => i.blocking) ?? false;
  const hasWarning = impact?.some((i) => !i.blocking) ?? false;

  function onActivateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await activatePersonAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setActivateOpen(false);
      router.refresh();
    });
  }

  function onCheckImpact() {
    setError(null);
    setChecking(true);
    const formData = new FormData();
    formData.set("userId", userId);
    startTransition(async () => {
      const result = await checkDeactivationImpactAction(formData);
      setChecking(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setImpact(result.data ?? []);
    });
  }

  function submitDeactivate() {
    const formEl = deactivateFormRef.current;
    if (!formEl) return;
    setError(null);
    const formData = new FormData(formEl);
    startTransition(async () => {
      const result = await deactivatePersonAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDeactivateOpen(false);
      setImpact(null);
      router.refresh();
    });
  }

  if (!isActive) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">帳號狀態</h3>
        <p className="mb-3 text-xs text-gray-500">此人員目前為停用狀態。</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setActivateOpen(true);
          }}
          className="rounded-md border border-success-border bg-success-bg px-3 py-1.5 text-sm font-medium text-success-text hover:opacity-80"
        >
          啟用
        </button>
        <Drawer open={activateOpen} onClose={() => setActivateOpen(false)} title="啟用人員" isSubmitting={isPending}>
          <form onSubmit={onActivateSubmit} className="space-y-3">
            <ActionErrorText message={error} />
            <input type="hidden" name="userId" value={userId} />
            <ReasonCodeField disabled={isPending} />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "送出中…" : "確認啟用"}
            </button>
          </form>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">帳號狀態</h3>
      <p className="mb-3 text-xs text-gray-500">此人員目前為啟用狀態。停用前必須先檢查停用影響。</p>
      <ActionErrorText message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCheckImpact}
          disabled={checking}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? "檢查中…" : "檢查停用影響"}
        </button>
        <button
          type="button"
          disabled={impact === null || hasBlocking}
          onClick={() => setDeactivateOpen(true)}
          className="rounded-md border border-danger-border bg-danger-bg px-3 py-1.5 text-sm font-medium text-danger-text hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          停用
        </button>
        {impact !== null && hasBlocking && <span className="text-xs text-danger-text">存在阻擋事項，無法停用</span>}
      </div>

      {impact !== null && (
        <div className="mt-3">
          <DeactivationImpactPanel items={impact} />
        </div>
      )}

      <Drawer open={deactivateOpen} onClose={() => setDeactivateOpen(false)} title="確認停用" isSubmitting={isPending}>
        <form ref={deactivateFormRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <input type="hidden" name="userId" value={userId} />
          {hasWarning && (
            <p className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-text">
              上方檢查結果包含警告事項，停用後仍會生效，請確認已了解影響。
            </p>
          )}
          <ReasonCodeField disabled={isPending} />
          <ConfirmButton label="確認停用" confirmLabel="真的要停用？" disabled={isPending} onConfirm={submitDeactivate} />
        </form>
      </Drawer>
    </div>
  );
}
