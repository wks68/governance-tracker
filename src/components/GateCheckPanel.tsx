import { GateResult } from "@/lib/gateRules";
import clsx from "clsx";

export default function GateCheckPanel({
  gate,
  nextStatusLabel,
}: {
  gate: GateResult;
  nextStatusLabel: string | null;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border p-4",
        gate.passed ? "border-success-border bg-success-bg" : "border-warning-border bg-warning-bg"
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">關卡卡控檢查</h3>
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            gate.passed ? "bg-success-bg text-success-text" : "bg-warning-bg text-warning-text"
          )}
        >
          {gate.passed ? "通過" : "未通過"}
        </span>
      </div>

      {nextStatusLabel ? (
        <p className="mt-1 text-xs text-gray-500">下一關卡：{nextStatusLabel}</p>
      ) : (
        <p className="mt-1 text-xs text-gray-500">目前已無下一關卡</p>
      )}

      {gate.missingFields.length > 0 && (
        <div className="mt-2 text-sm">
          <span className="font-medium text-warning-text">缺少必填欄位：</span>
          <span className="text-gray-700">{gate.missingFields.join("、")}</span>
          <a
            href="#dynamic-fields-section"
            className="ml-2 inline-block rounded-md border border-primary px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary hover:text-white"
          >
            前往下方填寫
          </a>
        </div>
      )}
      {gate.missingEvidence.length > 0 && (
        <div className="mt-2 text-sm">
          <span className="font-medium text-warning-text">缺少佐證資料：</span>
          <span className="text-gray-700">{gate.missingEvidence.join("、")}</span>
        </div>
      )}
      {gate.blockReasons.length > 0 && (
        <div className="mt-2 text-sm">
          <span className="font-medium text-danger-text">目前無法進入下一關的原因：</span>
          <ul className="ml-4 list-disc text-gray-700">
            {gate.blockReasons.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2 text-sm">
        <span className="font-medium text-gray-600">下一步建議：</span>
        <span className="text-gray-700">{gate.nextStep || "無"}</span>
      </div>
    </div>
  );
}
