"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Search, X } from "lucide-react";
import type { GovernanceRelationCandidate, GovernanceRelationCandidates } from "@/lib/issue-relations/viewService";

type Kind = "incident" | "rca" | "project";
const config: Record<Kind, { title: string; description: string; placeholder: string; inputName: string; multiple: boolean }> = {
  incident: { title: "事件通報", description: "關聯造成、觸發或與本次 Hotfix 有關的事件通報。", placeholder: "搜尋事件編號或事件標題", inputName: "incidentRelationIds", multiple: true },
  rca: { title: "RCA", description: "關聯與本次 Hotfix 有關的根因分析紀錄。", placeholder: "搜尋 RCA 編號或標題", inputName: "rcaRelationIds", multiple: true },
  project: { title: "季度專案", description: "本次 Hotfix 若屬於既有季度治理範圍，可選擇對應專案。", placeholder: "搜尋專案編號或專案名稱", inputName: "projectRelationId", multiple: false },
};

export default function GovernanceRelationSelector({ candidates, onManageSelect, excludedIds = [] }: { candidates: GovernanceRelationCandidates; onManageSelect?: (candidate: GovernanceRelationCandidate) => void; excludedIds?: readonly string[] }) {
  const [open, setOpen] = useState<Set<Kind>>(new Set());
  const [queries, setQueries] = useState<Record<Kind, string>>({ incident: "", rca: "", project: "" });
  const [selected, setSelected] = useState<Record<Kind, GovernanceRelationCandidate[]>>({ incident: [], rca: [], project: [] });
  const excluded = useMemo(() => new Set(excludedIds), [excludedIds]);
  const lists: Record<Kind, GovernanceRelationCandidate[]> = { incident: candidates.incidents, rca: candidates.rcas, project: candidates.projects };

  function toggleOpen(kind: Kind) { setOpen((current) => { const next = new Set(current); next.has(kind) ? next.delete(kind) : next.add(kind); return next; }); }
  function choose(kind: Kind, item: GovernanceRelationCandidate) {
    if (onManageSelect) { onManageSelect(item); return; }
    setSelected((current) => ({ ...current, [kind]: config[kind].multiple ? [...current[kind], item] : [item] }));
  }

  return <div className="grid min-w-0 gap-3">
    {(Object.keys(config) as Kind[]).map((kind) => {
      const cfg = config[kind];
      const chosen = selected[kind];
      const chosenIds = new Set(chosen.map((item) => item.id));
      const query = queries[kind].trim().toLocaleLowerCase("zh-TW");
      const results = lists[kind].filter((item) => !excluded.has(item.id) && !chosenIds.has(item.id) && (!query || item.searchText.toLocaleLowerCase("zh-TW").includes(query)));
      return <section key={kind} className="min-w-0 rounded-lg border border-border bg-white">
        <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-expanded={open.has(kind)} onClick={() => toggleOpen(kind)}>
          <span className="min-w-0"><span className="block text-sm font-semibold text-text-primary">{cfg.title}</span><span className="mt-0.5 block text-xs text-text-secondary">{cfg.description}</span><span className="mt-1 block text-xs font-medium text-text-muted">{chosen.length ? `已選擇 ${chosen.length} 筆` : "尚未關聯"}</span></span>
          <ChevronDown className={`h-5 w-5 shrink-0 text-text-muted transition-transform ${open.has(kind) ? "rotate-180" : ""}`} />
        </button>
        {chosen.map((item) => <div key={item.id} className="mx-4 mb-3 flex min-w-0 items-start justify-between gap-3 rounded-md border border-primary/20 bg-primary-muted px-3 py-2">
          <span className="min-w-0"><span className="block font-mono text-xs font-semibold text-primary">{item.issueKey}</span><span className="block break-words text-sm font-medium text-text-primary">{item.title}</span></span>
          <span className="flex shrink-0 gap-1"><Link href={item.detailHref} target="_blank" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-primary focus-visible:ring-2 focus-visible:ring-primary" aria-label={`開啟 ${item.issueKey}`}><ExternalLink className="h-4 w-4" /></Link><button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-danger-text focus-visible:ring-2 focus-visible:ring-primary" aria-label={`移除 ${item.issueKey}`} onClick={() => setSelected((current) => ({ ...current, [kind]: current[kind].filter((entry) => entry.id !== item.id) }))}><X className="h-4 w-4" /></button></span>
          <input type="hidden" name={cfg.inputName} value={item.id} />
        </div>)}
        {open.has(kind) && <div className="min-w-0 border-t border-border p-4">
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" /><span className="sr-only">{cfg.placeholder}</span><input type="search" role="combobox" aria-expanded="true" aria-controls={`${kind}-relation-results`} value={queries[kind]} onChange={(event) => setQueries((current) => ({ ...current, [kind]: event.target.value }))} placeholder={cfg.placeholder} className="w-full rounded-md border border-input-border py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" /></label>
          <div id={`${kind}-relation-results`} role="listbox" className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border">
            {results.length === 0 ? <p className="px-3 py-5 text-center text-xs text-text-muted">目前沒有符合條件且可關聯的紀錄</p> : results.map((item) => <button key={item.id} type="button" role="option" aria-selected="false" className="block min-h-11 w-full border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface-muted focus-visible:bg-primary-muted focus-visible:outline-none" onClick={() => choose(kind, item)}><span className="block font-mono text-xs font-semibold text-primary">{item.issueKey}</span><span className="block break-words text-sm font-medium text-text-primary">{item.title}</span><span className="mt-0.5 block break-words text-xs text-text-secondary">{item.label}</span></button>)}
          </div>
        </div>}
      </section>;
    })}
  </div>;
}
