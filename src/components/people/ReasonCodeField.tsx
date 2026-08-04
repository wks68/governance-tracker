"use client";

import { useRef } from "react";

// M1.5-C1-C 新增：所有人員／Team 治理寫入表單共用的 reasonCode 欄位。
//
// 一律必填，不提供預設假值；下方僅為「快速帶入」建議 chip，點擊後仍只是把文字填入
// textarea，使用者仍可自行編輯或改寫，不構成隱性預設值。前端 required 只是便利性，
// 實際驗證一律由 Server Action 呼叫的服務層（validation.ts／各 xxxTx）重新檢查。
const COMMON_REASON_SUGGESTIONS = ["組織調整", "人員異動", "新人入職", "職務調整", "離職／停用", "角色矯正", "資安要求"];

export default function ReasonCodeField({
  disabled = false,
  name = "reasonCode",
  label = "原因（必填）",
  defaultValue = "",
}: {
  disabled?: boolean;
  name?: string;
  label?: string;
  defaultValue?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      <textarea
        ref={ref}
        name={name}
        required
        rows={2}
        defaultValue={defaultValue}
        disabled={disabled}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100"
      />
      <div className="mt-1 flex flex-wrap gap-1">
        {COMMON_REASON_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (ref.current) ref.current.value = s;
            }}
            className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
