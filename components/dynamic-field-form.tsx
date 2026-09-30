"use client";

import { useMemo, useState } from "react";
import { DYNAMIC_FIELDS, ISSUE_TYPES, type IssueTypeName } from "@/lib/governance";
import {
  displayFieldLabel,
  displayIssueType,
  displayOption
} from "@/lib/i18n";

type DynamicFieldFormProps = {
  issueType: string;
  values?: Record<string, string>;
  allowIssueTypeChange?: boolean;
};

function renderInput(field: (typeof DYNAMIC_FIELDS)[IssueTypeName][number], value = "") {
  const baseClass =
    "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100";
  const name = `field:${field.key}`;

  if (field.type === "textarea") {
    return (
      <textarea
        name={name}
        defaultValue={value}
        rows={4}
        placeholder={field.placeholder}
        className={baseClass}
      />
    );
  }

  if (field.type === "select") {
    return (
      <select name={name} defaultValue={value} className={baseClass}>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {displayOption(option)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      name={name}
      type={field.type}
      defaultValue={value}
      placeholder={field.placeholder}
      className={baseClass}
    />
  );
}

export function DynamicFieldForm({
  issueType,
  values = {},
  allowIssueTypeChange = false
}: DynamicFieldFormProps) {
  const [selectedType, setSelectedType] = useState<IssueTypeName>(
    ISSUE_TYPES.includes(issueType as IssueTypeName) ? (issueType as IssueTypeName) : "Hotfix"
  );
  const fields = useMemo(() => DYNAMIC_FIELDS[selectedType], [selectedType]);

  return (
    <div className="space-y-4">
      {allowIssueTypeChange ? (
        <label className="block">
          <span className="text-sm font-medium text-slate-700">議題類型</span>
          <select
            name="issueType"
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value as IssueTypeName)}
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
          >
            {ISSUE_TYPES.map((item) => (
              <option key={item} value={item}>
                {displayIssueType(item)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="issueType" value={selectedType} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {fields.map((field) => (
          <label
            key={`${selectedType}:${field.key}`}
            className={field.type === "textarea" ? "block lg:col-span-2" : "block"}
          >
            <span className="text-sm font-medium text-slate-700">
              {displayFieldLabel(field.label)}
              {field.required ? <span className="text-red-600"> *</span> : null}
            </span>
            {renderInput(field, values[field.key])}
          </label>
        ))}
      </div>
    </div>
  );
}
