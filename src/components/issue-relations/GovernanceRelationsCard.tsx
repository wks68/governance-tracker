"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addGovernanceRelationAction,
  removeGovernanceRelationAction,
} from "@/app/issues/[id]/relation-actions";
import {
  ActionErrorText,
  ActionSuccessText,
} from "@/components/ActionResultBanner";
import type {
  GovernanceRelationCandidate,
  GovernanceRelationGroup,
  GovernanceRelationView,
} from "@/lib/issue-relations/viewService";
import ExpandableContentBlock from "@/components/ui/ExpandableContentBlock";
import GovernanceRelationSelector from "./GovernanceRelationSelector";

const KIND_LABELS: Record<GovernanceRelationGroup["key"], string> = {
  incident: "事件通報",
  rca: "RCA",
  hotfix: "Hotfix",
  project: "季度專案",
};

const ALLOWED_TARGETS: Record<
  GovernanceRelationGroup["key"],
  readonly GovernanceRelationGroup["key"][]
> = {
  incident: ["rca", "hotfix"],
  rca: ["incident", "hotfix"],
  hotfix: ["incident", "rca", "project"],
  project: ["hotfix"],
};

interface TypedCandidate extends GovernanceRelationCandidate {
  kind: GovernanceRelationGroup["key"];
}

function candidateList(view: GovernanceRelationView): TypedCandidate[] {
  const directIds = new Set(
    view.directRelations.map((relation) => relation.relatedIssueId),
  );
  const allowed = new Set(ALLOWED_TARGETS[view.currentKind]);
  const groups: Array<{
    kind: GovernanceRelationGroup["key"];
    candidates: GovernanceRelationCandidate[];
  }> = [
    { kind: "incident", candidates: view.candidates.incidents },
    { kind: "rca", candidates: view.candidates.rcas },
    { kind: "hotfix", candidates: view.candidates.hotfixes },
    { kind: "project", candidates: view.candidates.projects },
  ];
  return groups.flatMap(({ kind, candidates }) =>
    allowed.has(kind)
      ? candidates
          .filter(
            (candidate) =>
              candidate.id !== view.issueId && !directIds.has(candidate.id),
          )
          .map((candidate) => ({ ...candidate, kind }))
      : [],
  );
}

function RelationItem({
  item,
  canManage,
  onRemove,
  expandable = false,
}: {
  item: GovernanceRelationGroup["items"][number];
  canManage: boolean;
  onRemove: (relationId: string, label: string) => void;
  expandable?: boolean;
}) {
  return (
    <article
      className={`rounded-md border p-3 ${
        item.isCurrent
          ? "border-primary/30 bg-blue-50/40"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={item.detailHref}
              className="font-mono text-xs font-semibold text-primary hover:underline"
            >
              {item.issueKey}
            </Link>
            {item.isCurrent && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                目前紀錄
              </span>
            )}
            {item.pathLabel && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                {item.pathLabel}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm font-medium text-gray-800">
            {expandable ? <ExpandableContentBlock text={item.title} characterThreshold={180} /> : <p className="line-clamp-2">{item.title}</p>}
          </div>
        </div>
        <Link
          href={item.detailHref}
          className="text-xs font-medium text-primary hover:underline"
        >
          查看
        </Link>
      </div>
      <dl className="mt-2 grid gap-1 text-xs text-gray-500">
        <div>
          <dt className="inline">類型：</dt>
          <dd className="inline">{item.issueTypeLabel}</dd>
        </div>
        <div>
          <dt className="inline">系統／服務：</dt>
          <dd className="inline">{item.systemName}</dd>
        </div>
        <div>
          <dt className="inline">目前狀態：</dt>
          <dd className="inline">{item.statusLabel}</dd>
        </div>
        {item.createdAt && (
          <div>
            <dt className="inline">建立關聯時間：</dt>
            <dd className="inline">{item.createdAt}</dd>
          </div>
        )}
      </dl>
      {canManage && item.relationId && (
        <button
          type="button"
          onClick={() =>
            onRemove(item.relationId!, `${item.issueKey} ${item.title}`)
          }
          className="mt-3 text-xs font-medium text-danger-text hover:underline"
        >
          解除關聯
        </button>
      )}
    </article>
  );
}

export default function GovernanceRelationsCard({
  view,
  presentation = "default",
  hotfixCurrentStageLabel,
}: {
  view: GovernanceRelationView;
  presentation?: "default" | "hotfix-flow";
  hotfixCurrentStageLabel?: string;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{
    relationId: string;
    label: string;
  } | null>(null);
  const [removalReason, setRemovalReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const candidates = useMemo(() => candidateList(view), [view]);
  const filteredCandidates = useMemo(() => {
    const query = addQuery.trim().toLocaleLowerCase("zh-TW");
    if (!query) return candidates;
    return candidates.filter((candidate) =>
      candidate.searchText.toLocaleLowerCase("zh-TW").includes(query),
    );
  }, [addQuery, candidates]);
  const currentItem = view.groups.find((group) => group.key === "hotfix")?.items.find((item) => item.isCurrent) ?? null;
  const incidentItems = view.groups.find((group) => group.key === "incident")?.items.filter((item) => !item.isCurrent) ?? [];
  const rcaItems = view.groups.find((group) => group.key === "rca")?.items.filter((item) => !item.isCurrent) ?? [];
  const projectItems = view.groups.find((group) => group.key === "project")?.items.filter((item) => !item.isCurrent) ?? [];

  function resetDialogs() {
    setAddOpen(false);
    setRemoveTarget(null);
    setAddQuery("");
    setSelectedIssueId("");
    setRemovalReason("");
    setError(null);
  }

  function closeDialogs() {
    if (isPending) return;
    resetDialogs();
  }

  function addRelation() {
    if (!selectedIssueId || isPending) return;
    setError(null);
    const formData = new FormData();
    formData.set("issueId", view.issueId);
    formData.set("relatedIssueId", selectedIssueId);
    startTransition(async () => {
      const result = await addGovernanceRelationAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      resetDialogs();
      router.refresh();
    });
  }

  function removeRelation() {
    if (!removeTarget || isPending) return;
    if (!removalReason.trim()) {
      setError("請填寫解除原因。");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("relationId", removeTarget.relationId);
    formData.set("removalReason", removalReason);
    startTransition(async () => {
      const result = await removeGovernanceRelationAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      resetDialogs();
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="governance-relations-title"
      className={presentation === "hotfix-flow" ? "ui-card p-5 sm:p-6" : "rounded-lg border border-gray-200 bg-white p-4"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="governance-relations-title"
            className="text-sm font-semibold text-gray-800"
          >
            {presentation === "hotfix-flow" ? "治理關聯與追蹤" : "關聯治理紀錄"}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {presentation === "hotfix-flow"
              ? "顯示與本次 Hotfix 相關的事件通報、RCA 及季度專案。"
              : "事件通報 → RCA → Hotfix → 季度專案"}
          </p>
        </div>
        {view.canManage && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAddOpen(true);
            }}
            className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:border-primary hover:text-primary sm:w-auto"
          >
            管理關聯
          </button>
        )}
      </div>

      <div className="mt-3">
        <ActionSuccessText message={success} />
      </div>
      {!view.hasRelations && presentation !== "hotfix-flow" && (
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-500">
          尚未關聯
        </p>
      )}

      {presentation === "hotfix-flow" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-primary/25 bg-primary-muted p-4 sm:p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">本次 Hotfix</h3>
            {currentItem ? (
              <div className="mt-3">
                <p className="font-mono text-xs font-semibold text-primary">{currentItem.issueKey}</p>
                <div className="mt-1 font-semibold text-text-primary"><ExpandableContentBlock text={currentItem.title} characterThreshold={180} /></div>
                <p className="mt-3 text-xs text-text-secondary">目前流程階段：{hotfixCurrentStageLabel ?? currentItem.statusLabel}</p>
                <span className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-primary">{currentItem.statusLabel}</span>
              </div>
            ) : <p className="mt-3 text-sm text-text-muted">目前 Hotfix</p>}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {([ ["關聯事件通報", incidentItems], ["關聯 RCA", rcaItems], ["所屬季度專案", projectItems] ] as const).map(([label, items]) => <div key={label} className="min-w-0 rounded-xl border border-border bg-surface-muted p-4"><h3 className="text-xs font-semibold text-text-secondary">{label}</h3><div className="mt-3 space-y-2">{items.length === 0 ? <p className="text-sm text-text-muted">尚未關聯</p> : items.map((item) => <RelationItem key={item.id} item={item} canManage={view.canManage} expandable onRemove={(relationId, itemLabel) => { setError(null); setRemovalReason(""); setRemoveTarget({ relationId, label: itemLabel }); }} />)}</div></div>)}
          </div>
        </div>
      ) : (
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        {view.groups.map((group, index) => (
          <div key={group.key} className="contents">
            <div className="min-w-0">
              <h3 className="mb-2 text-xs font-semibold text-gray-600">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.items.length === 0 ? (
                  <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
                    尚未關聯
                  </div>
                ) : (
                  group.items.map((item) => (
                    <RelationItem
                      key={`${item.id}-${item.pathLabel ?? "direct"}`}
                      item={item}
                      canManage={view.canManage}
                      onRemove={(relationId, label) => {
                        setError(null);
                        setRemovalReason("");
                        setRemoveTarget({ relationId, label });
                      }}
                    />
                  ))
                )}
              </div>
            </div>
            {index < view.groups.length - 1 && (
              <div
                aria-hidden
                className="hidden self-start pt-7 text-gray-300 lg:block"
              >
                →
              </div>
            )}
          </div>
        ))}
      </div>
      )}

      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeDialogs}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-governance-relation-title"
            className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="add-governance-relation-title"
              className="text-base font-semibold text-gray-900"
            >
              新增治理紀錄關聯
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              關聯類型與固定方向將由 Server 依兩筆正式紀錄重新判斷。
            </p>
            <div className="mt-4">
              <ActionErrorText message={error} />
              {presentation === "hotfix-flow" ? <GovernanceRelationSelector candidates={view.candidates} excludedIds={view.directRelations.map((item) => item.relatedIssueId)} onManageSelect={(candidate) => setSelectedIssueId(candidate.id)} /> : <><label
                htmlFor="relation-candidate-search"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                搜尋治理紀錄
              </label>
              <input
                id="relation-candidate-search"
                type="search"
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="搜尋編號、標題或系統"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <select
                value={selectedIssueId}
                onChange={(event) => setSelectedIssueId(event.target.value)}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">請選擇關聯紀錄</option>
                {filteredCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {KIND_LABELS[candidate.kind]}｜{candidate.label}
                  </option>
                ))}
              </select>
              {filteredCandidates.length === 0 && (
                <p className="mt-2 text-xs text-gray-400">
                  目前沒有符合條件且可建立的治理紀錄。
                </p>
              )}
              </>}
              {presentation === "hotfix-flow" && selectedIssueId && <p className="mt-3 rounded-md bg-primary-muted px-3 py-2 text-xs text-primary">已選擇治理紀錄，按「新增關聯」後正式儲存。</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialogs}
                disabled={isPending}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={addRelation}
                disabled={!selectedIssueId || isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPending ? "處理中…" : "新增關聯"}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeDialogs}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-governance-relation-title"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="remove-governance-relation-title"
              className="text-base font-semibold text-gray-900"
            >
              解除治理紀錄關聯
            </h2>
            <p className="mt-1 text-sm text-gray-600">{removeTarget.label}</p>
            <div className="mt-4">
              <ActionErrorText message={error} />
              <label
                htmlFor="relation-removal-reason"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                解除原因<span className="ml-1 text-danger">*</span>
              </label>
              <textarea
                id="relation-removal-reason"
                value={removalReason}
                onChange={(event) => setRemovalReason(event.target.value)}
                rows={3}
                maxLength={500}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialogs}
                disabled={isPending}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={removeRelation}
                disabled={isPending}
                className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {isPending ? "處理中…" : "確認解除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
