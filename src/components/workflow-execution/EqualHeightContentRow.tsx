import type { ReactNode } from "react";

// equalHeight：預設 false，維持既有「高度依內容自然決定，不強制 stretch」行為（例如
// main／side 雙欄）。僅在明確傳入 equalHeight 時才對該列 stretch 且撐滿子卡片高度——目前
// 只有「Hotfix 基本資訊｜目前 Hotfix 流程」這一列需要，其餘雙欄列不受影響。
export default function EqualHeightContentRow({ left, right, equalHeight = false }: { left?: ReactNode; right?: ReactNode; equalHeight?: boolean }) {
  if (!left && !right) return null;
  if (!left || !right) {
    return (
      <div data-hotfix-scroll-section className="min-w-0 scroll-mt-24">
        {left ?? right}
      </div>
    );
  }
  return (
    <div
      data-hotfix-scroll-section
      className={`grid scroll-mt-24 grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 xl:gap-6 ${equalHeight ? "items-stretch" : "items-start"}`}
    >
      <div className={`min-w-0 ${equalHeight ? "[&>section]:h-full" : ""}`}>{left}</div>
      <div className={`min-w-0 ${equalHeight ? "[&>section]:h-full" : ""}`}>{right}</div>
    </div>
  );
}
