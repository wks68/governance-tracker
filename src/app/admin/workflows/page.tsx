import { ISSUE_TYPES } from "@/lib/constants";
import { getWorkflow } from "@/lib/workflow";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WorkflowsAdminPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">流程設定</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          MVP 版本以靜態方式呈現各工單類型的流程關卡設定，尚未提供視覺化流程編輯器。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ISSUE_TYPES.map((t) => {
          const steps = getWorkflow(t.key);
          return (
            <div key={t.key} className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-800">{t.label}</h2>
              <ol className="mt-3 space-y-1.5">
                {steps.map((s, idx) => (
                  <li key={s} className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-xs text-gray-500">
                      {idx + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}
