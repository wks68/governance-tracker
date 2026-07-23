import { FieldTemplate } from "@/lib/workflow";

export interface DynamicOption {
  value: string;
  label: string;
}

// 依工單類型顯示不同動態欄位的表單輸入元件
export default function DynamicFieldsForm({
  template,
  values,
  dynamicOptions,
}: {
  template: FieldTemplate[];
  values: Record<string, string>;
  // select 欄位若設定 dynamicOptionsRole，選項改由此處依 key 傳入（例如依角色查詢出的使用者名單）
  dynamicOptions?: Record<string, DynamicOption[]>;
}) {
  if (template.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {template.map((f) => {
        const name = `dyn__${f.key}`;
        const value = values[f.key] ?? "";
        return (
          <div
            key={f.key}
            className={f.type === "textarea" || (f.options && f.options.length > 3) ? "sm:col-span-2" : ""}
          >
            <label className="mb-1 block text-sm font-medium text-gray-700">{f.label}</label>
            {f.type === "textarea" && (
              <textarea
                name={name}
                defaultValue={value}
                placeholder={f.placeholder}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            )}
            {f.type === "text" && (
              <input
                type="text"
                name={name}
                defaultValue={value}
                placeholder={f.placeholder}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            )}
            {f.type === "number" && (
              <input
                type="number"
                name={name}
                defaultValue={value}
                placeholder={f.placeholder}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            )}
            {f.type === "date" && (
              <input
                type="date"
                name={name}
                defaultValue={value}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            )}
            {f.type === "select" &&
              (() => {
                const dynOpts = f.dynamicOptionsRole ? dynamicOptions?.[f.key] ?? [] : null;
                return (
                  <select
                    name={name}
                    defaultValue={value}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  >
                    <option value="">請選擇</option>
                    {dynOpts
                      ? dynOpts.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))
                      : f.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                  </select>
                );
              })()}
            {f.type === "checkbox" && (
              <label className="flex items-center gap-2 pt-2 text-sm text-gray-700">
                <input type="checkbox" name={name} defaultChecked={value === "true"} className="h-4 w-4" />
                {f.checkboxTrueLabel ?? "是"}
                {f.checkboxFalseLabel && (
                  <span className="text-xs text-gray-400">（未勾選 = {f.checkboxFalseLabel}）</span>
                )}
              </label>
            )}
            {f.type === "datetime" && (
              <input
                type="datetime-local"
                name={name}
                defaultValue={value}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            )}
            {f.type === "radio" && (
              <div className="flex flex-col gap-1.5 pt-1">
                {f.options?.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="radio" name={name} value={o} defaultChecked={value === o} className="h-4 w-4" />
                    {o}
                  </label>
                ))}
              </div>
            )}
            {f.type === "checkboxGroup" &&
              (() => {
                const selected = value ? value.split("、") : [];
                return (
                  <div className="flex flex-col gap-1.5 pt-1">
                    {f.options?.map((o) => (
                      <label key={o} className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="h-4 w-4" />
                        {o}
                      </label>
                    ))}
                  </div>
                );
              })()}
            {f.helpText && <p className="mt-1 text-xs text-gray-400">{f.helpText}</p>}
          </div>
        );
      })}
    </div>
  );
}
