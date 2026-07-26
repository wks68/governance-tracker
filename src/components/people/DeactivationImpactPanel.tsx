// M1.5-C1-C 新增：停用影響分析結果的結構化呈現（阻擋事項／警告事項／關聯對象／
// 建議處理方式），不得只顯示一段無結構文字。
export interface DeactivationImpactItemView {
  severity: "blocking" | "warning";
  blocking: boolean;
  category: string;
  message: string;
  relatedEntityId: string | null;
  suggestedAction: string;
}

export default function DeactivationImpactPanel({ items }: { items: DeactivationImpactItemView[] }) {
  const blocking = items.filter((i) => i.blocking);
  const warnings = items.filter((i) => !i.blocking);

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success-text">
        沒有發現任何阻擋或警告事項，可以直接停用。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {blocking.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-danger-text">阻擋事項（{blocking.length}，必須先處理才能停用）</p>
          <ul className="space-y-1.5">
            {blocking.map((item, idx) => (
              <li key={`${item.category}-${idx}`} className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs">
                <p className="font-medium text-danger-text">{item.message}</p>
                <p className="mt-0.5 text-danger-text/80">建議處理方式：{item.suggestedAction}</p>
                {item.relatedEntityId && <p className="mt-0.5 text-danger-text/60">關聯對象：{item.relatedEntityId}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-warning-text">警告事項（{warnings.length}，仍可停用但請確認）</p>
          <ul className="space-y-1.5">
            {warnings.map((item, idx) => (
              <li key={`${item.category}-${idx}`} className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs">
                <p className="font-medium text-warning-text">{item.message}</p>
                <p className="mt-0.5 text-warning-text/80">建議處理方式：{item.suggestedAction}</p>
                {item.relatedEntityId && <p className="mt-0.5 text-warning-text/60">關聯對象：{item.relatedEntityId}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
