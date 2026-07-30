"use client";

import { useMemo, useState } from "react";
import type {
  GovernanceRelationCandidate,
  GovernanceRelationCandidates,
} from "@/lib/issue-relations/viewService";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";

function YesNoChoice({
  name,
  value,
  onChange,
}: {
  name: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-5 text-sm">
      <label className="inline-flex items-center gap-2">
        <input
          type="radio"
          name={name}
          value="no"
          checked={!value}
          onChange={() => onChange(false)}
        />
        否
      </label>
      <label className="inline-flex items-center gap-2">
        <input
          type="radio"
          name={name}
          value="yes"
          checked={value}
          onChange={() => onChange(true)}
        />
        是
      </label>
    </div>
  );
}

function filterCandidates(
  candidates: GovernanceRelationCandidate[],
  query: string,
): GovernanceRelationCandidate[] {
  const normalized = query.trim().toLocaleLowerCase("zh-TW");
  if (!normalized) return candidates;
  return candidates.filter((candidate) =>
    candidate.searchText.toLocaleLowerCase("zh-TW").includes(normalized),
  );
}

function SearchableMultiSelect({
  inputName,
  searchLabel,
  emptyLabel,
  candidates,
  selectedIds,
  onToggle,
}: {
  inputName: string;
  searchLabel: string;
  emptyLabel: string;
  candidates: GovernanceRelationCandidate[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string, selected: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterCandidates(candidates, query), [candidates, query]);

  return (
    <div className="mt-3 space-y-2">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={searchLabel}
        aria-label={searchLabel}
        className={inputClass}
      />
      <div className="max-h-52 overflow-y-auto rounded-md border border-gray-200">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-gray-400">{emptyLabel}</p>
        ) : (
          filtered.map((candidate) => (
            <label
              key={candidate.id}
              className="flex cursor-pointer items-start gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                name={inputName}
                value={candidate.id}
                checked={selectedIds.has(candidate.id)}
                onChange={(event) => onToggle(candidate.id, event.target.checked)}
                className="mt-0.5"
              />
              <span className="leading-5 text-gray-700">{candidate.label}</span>
            </label>
          ))
        )}
      </div>
      {selectedIds.size > 0 && (
        <p className="text-xs text-gray-500">已選擇 {selectedIds.size} 筆</p>
      )}
    </div>
  );
}

function toggleSet(
  current: ReadonlySet<string>,
  id: string,
  selected: boolean,
): Set<string> {
  const next = new Set(current);
  if (selected) next.add(id);
  else next.delete(id);
  return next;
}

export default function HotfixGovernanceRelationFields({
  candidates,
}: {
  candidates: GovernanceRelationCandidates;
}) {
  const [relateIncidents, setRelateIncidents] = useState(false);
  const [relateRcas, setRelateRcas] = useState(false);
  const [relateProject, setRelateProject] = useState(false);
  const [incidentIds, setIncidentIds] = useState<Set<string>>(new Set());
  const [rcaIds, setRcaIds] = useState<Set<string>>(new Set());
  const [projectId, setProjectId] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const filteredProjects = useMemo(
    () => filterCandidates(candidates.projects, projectQuery),
    [candidates.projects, projectQuery],
  );

  return (
    <section
      aria-labelledby="governance-relations-create-title"
      className="space-y-5 rounded-lg border border-gray-200 bg-white p-4"
    >
      <div>
        <h2
          id="governance-relations-create-title"
          className="text-sm font-semibold text-gray-800"
        >
          關聯治理紀錄（選填）
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          可先關聯既有事件通報、RCA 或主要季度專案；建立後仍可於詳情頁調整。
        </p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-700">是否關聯事件通報</legend>
        <YesNoChoice
          name="relateIncidents"
          value={relateIncidents}
          onChange={(value) => {
            setRelateIncidents(value);
            if (!value) setIncidentIds(new Set());
          }}
        />
        {relateIncidents && (
          <SearchableMultiSelect
            inputName="incidentRelationIds"
            searchLabel="搜尋事件編號、系統／服務、標題或等級"
            emptyLabel="目前沒有可選的事件通報"
            candidates={candidates.incidents}
            selectedIds={incidentIds}
            onToggle={(id, selected) =>
              setIncidentIds((current) => toggleSet(current, id, selected))
            }
          />
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-700">是否關聯 RCA</legend>
        <YesNoChoice
          name="relateRcas"
          value={relateRcas}
          onChange={(value) => {
            setRelateRcas(value);
            if (!value) setRcaIds(new Set());
          }}
        />
        {relateRcas && (
          <SearchableMultiSelect
            inputName="rcaRelationIds"
            searchLabel="搜尋 RCA 編號、系統／服務、關聯事件或改善狀態"
            emptyLabel="目前沒有可選的 RCA"
            candidates={candidates.rcas}
            selectedIds={rcaIds}
            onToggle={(id, selected) =>
              setRcaIds((current) => toggleSet(current, id, selected))
            }
          />
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-700">
          是否關聯專案<span className="ml-1 text-danger">*</span>
        </legend>
        <YesNoChoice
          name="relateProject"
          value={relateProject}
          onChange={(value) => {
            setRelateProject(value);
            if (!value) {
              setProjectId("");
              setProjectQuery("");
            }
          }}
        />
        {relateProject && (
          <div className="mt-3 space-y-2">
            <label
              htmlFor="project-relation-search"
              className="block text-sm font-medium text-gray-700"
            >
              關聯專案<span className="ml-1 text-danger">*</span>
            </label>
            <input
              id="project-relation-search"
              type="search"
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
              placeholder="搜尋專案編號、名稱、季度或系統"
              className={inputClass}
            />
            <select
              name="projectRelationId"
              required
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className={inputClass}
              aria-describedby="project-relation-required"
            >
              <option value="">請選擇關聯專案</option>
              {filteredProjects.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
            {!projectId && (
              <p id="project-relation-required" className="text-xs text-danger-text">
                請選擇關聯專案。
              </p>
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}
