import { Rows3 } from "lucide-react";
import { DYNAMIC_FIELDS } from "@/lib/governance";
import {
  displayFieldLabel,
  displayFieldType,
  displayIssueType,
  displayOption,
  displayYesNo
} from "@/lib/i18n";

export default function AdminFormTemplatesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">表單範本</h1>
        <p className="mt-1 text-sm text-slate-500">MVP 靜態動態欄位範本。</p>
      </div>

      <section className="space-y-4">
        {Object.entries(DYNAMIC_FIELDS).map(([issueType, fields]) => (
          <div key={issueType} className="rounded-lg border border-line bg-white shadow-panel">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <Rows3 className="h-4 w-4 text-delta-700" />
              <h2 className="text-sm font-semibold text-slate-950">{displayIssueType(issueType)}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="border-b border-line px-3 py-3">欄位鍵值</th>
                    <th className="border-b border-line px-3 py-3">顯示名稱</th>
                    <th className="border-b border-line px-3 py-3">型態</th>
                    <th className="border-b border-line px-3 py-3">必填</th>
                    <th className="border-b border-line px-3 py-3">選項</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.key} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-3 font-mono text-xs text-slate-700">{field.key}</td>
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {displayFieldLabel(field.label)}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{displayFieldType(field.type)}</td>
                      <td className="px-3 py-3 text-slate-700">{displayYesNo(Boolean(field.required))}</td>
                      <td className="px-3 py-3 text-slate-700">
                        {field.options?.filter(Boolean).map(displayOption).join("、") ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
