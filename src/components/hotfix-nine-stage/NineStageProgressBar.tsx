// Hotfix 九階段 UI：正式核准的 9 階段進度列，出現在每一個 Hotfix 工單／簽核／結案頁面
// 頂部。已完成＝藍色打勾，目前＝實心藍點＋藍字，尚未進入＝白底灰框灰字。桌面不得出現
// 水平捲軸，9 個節點平均分佈（flex + justify-between）。
//
// cancelled 狀態不屬於 9 階段任何一個，改由呼叫端傳入 cancelled=true 顯示終態橫幅，
// 進度列本身仍以最後一次尚在 9 階段內的 currentIndex 呈現（cancelled 前通常仍在階段 1）。

import { NINE_STAGES } from "@/lib/hotfix-ui/nineStage";

export default function NineStageProgressBar({ currentIndex, cancelled }: { currentIndex: number | null; cancelled?: boolean }) {
  return (
    <div className="w-full">
      {cancelled && (
        <div className="mb-3 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-600">此工單已取消，不再走正式九階段流程。</div>
      )}
      <ol className="flex w-full items-start justify-between">
        {NINE_STAGES.map((stage, i) => {
          const isCompleted = currentIndex !== null && stage.index < currentIndex;
          const isCurrent = currentIndex !== null && stage.index === currentIndex && !cancelled;
          return (
            <li key={stage.key} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <div className={`h-px flex-1 ${i === 0 ? "invisible" : isCompleted || isCurrent ? "bg-primary" : "bg-gray-200"}`} />
                <div
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                    isCompleted ? "border-primary bg-primary text-white" : isCurrent ? "border-primary bg-white text-primary" : "border-gray-300 bg-white text-gray-400",
                  ].join(" ")}
                >
                  {isCompleted ? (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
                    </svg>
                  ) : isCurrent ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  ) : (
                    <span>{stage.index}</span>
                  )}
                </div>
                <div className={`h-px flex-1 ${i === NINE_STAGES.length - 1 ? "invisible" : isCompleted ? "bg-primary" : "bg-gray-200"}`} />
              </div>
              <span className={`mt-1.5 px-0.5 text-[11px] leading-tight ${isCurrent ? "font-semibold text-primary" : isCompleted ? "text-gray-700" : "text-gray-400"}`}>{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
