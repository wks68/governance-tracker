import { FieldTemplate } from "@/lib/workflow";

function displayValue(f: FieldTemplate, raw: string): string {
  if (!raw) return "（尚未填寫）";
  if (f.type === "checkbox") {
    return raw === "true" ? f.checkboxTrueLabel ?? "是" : f.checkboxFalseLabel ?? "否";
  }
  if (f.type === "checkboxGroup") return raw.split("、").join("、");
  return raw;
}

export default function DynamicFieldsView({
  template,
  values,
}: {
  template: FieldTemplate[];
  values: Record<string, string>;
}) {
  if (template.length === 0) return <p className="text-sm text-gray-400">此工單類型無額外動態欄位。</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {template.map((f) => {
        const raw = values[f.key] ?? "";
        const empty = !raw;
        return (
          <div
            key={f.key}
            className={f.type === "textarea" || (f.options && f.options.length > 3) ? "sm:col-span-2" : ""}
          >
            <dt className="text-xs font-medium text-gray-500">{f.label}</dt>
            <dd className={`mt-0.5 whitespace-pre-wrap text-sm ${empty ? "italic text-gray-400" : "text-gray-800"}`}>
              {displayValue(f, raw)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
