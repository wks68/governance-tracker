import { ENVIRONMENTS, PRIORITIES, RISK_LEVELS, ROLES } from "@/lib/governance";
import {
  displayEnvironment,
  displayPriority,
  displayRiskLevel,
  displayRole
} from "@/lib/i18n";

type OptionList = readonly string[] | string[];

type SelectFieldProps = {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: OptionList;
  includeEmpty?: boolean;
  emptyLabel?: string;
  optionLabel?: (value: string) => string;
};

type TextFieldProps = {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
};

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100";

export function TextField({
  label,
  name,
  defaultValue,
  type = "text",
  required = false
}: TextFieldProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        className={inputClass}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  required = false
}: Omit<TextFieldProps, "type">) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        rows={4}
        className={inputClass}
      />
    </label>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  options,
  includeEmpty = false,
  emptyLabel = "無",
  optionLabel = (value) => value
}: SelectFieldProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className={inputClass}>
        {includeEmpty ? <option value="">{emptyLabel}</option> : null}
        {options.map((item) => (
          <option key={item} value={item}>
            {optionLabel(item)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RoleField({ name, label, defaultValue }: Omit<SelectFieldProps, "options">) {
  return (
    <SelectField
      name={name}
      label={label}
      defaultValue={defaultValue}
      options={ROLES}
      optionLabel={displayRole}
    />
  );
}

export function EnvironmentField({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <SelectField
      name="environment"
      label="環境"
      defaultValue={defaultValue}
      options={ENVIRONMENTS}
      optionLabel={displayEnvironment}
    />
  );
}

export function RiskLevelField({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <SelectField
      name="riskLevel"
      label="風險等級"
      defaultValue={defaultValue}
      options={RISK_LEVELS}
      optionLabel={displayRiskLevel}
    />
  );
}

export function PriorityField({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <SelectField
      name="priority"
      label="優先級"
      defaultValue={defaultValue}
      options={PRIORITIES}
      optionLabel={displayPriority}
    />
  );
}

export function CheckboxField({
  name,
  label,
  defaultChecked = false
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-700">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-line text-delta-700"
      />
      {label}
    </label>
  );
}
