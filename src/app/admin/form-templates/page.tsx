import { ISSUE_TYPES } from "@/lib/constants";
import { FORM_TEMPLATES } from "@/lib/workflow";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  text: "文字",
  textarea: "多行文字",
  select: "下拉選單",
  checkbox: "是 / 否",
  number: "數字",
  date: "日期",
};

export default async function FormTemplatesAdminPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">表單範本</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          MVP 版本以靜態方式呈現各工單類型的動態欄位範本，尚未提供拖拉式表單編輯器。
        </p>
      </div>

      <div className="space-y-4">
        {ISSUE_TYPES.map((t) => {
          const fields = FORM_TEMPLATES[t.key];
          return (
            <div key={t.key} className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-800">{t.label}</h2>
              {fields.length === 0 ? (
                <p className="text-sm text-gray-400">此類型無額外動態欄位。</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400">
                      <th className="py-1 pr-4">欄位名稱</th>
                      <th className="py-1 pr-4">型態</th>
                      <th className="py-1 pr-4">選項</th>
                      <th className="py-1">卡控說明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {fields.map((f) => (
                      <tr key={f.key}>
                        <td className="py-1.5 pr-4 font-medium text-gray-700">{f.label}</td>
                        <td className="py-1.5 pr-4 text-gray-500">{TYPE_LABEL[f.type]}</td>
                        <td className="py-1.5 pr-4 text-gray-500">{f.options ? f.options.join("、") : "—"}</td>
                        <td className="py-1.5 text-gray-500">{f.helpText || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
