// Hotfix 操作畫面收斂新增：畫面頂部「目前工作狀態」摘要＋7 階段流程進度（需求一／二）。
//
// 主要訊息必須能直接回答：「現在輪到誰，還差什麼，完成後會送去哪裡。」純 Server
// Component，資料完全由呼叫端（Issue 詳情頁）透過 buildHotfixRuntimeView 現場查詢後
// 傳入，本身不查詢 Prisma、不判斷任何授權。

import { HOTFIX_BUSINESS_STAGES } from "@/lib/hotfix-ui/stageProgress";
import type { HotfixRuntimeView } from "@/lib/hotfix-ui/runtimeView";

export default function HotfixStatusHeader({
  view,
  isTerminal,
  terminalLabel,
}: {
  view: HotfixRuntimeView;
  isTerminal: boolean;
  terminalLabel: string | null;
}) {
  return (
    <div className="space-y-4">
      {/* 目前工作狀態摘要 */}
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-gray-400">目前階段</div>
          <div className="font-medium text-gray-800">
            {view.businessStageLabel}
            {view.approvalBadge && (
              <span className="ml-1.5 rounded bg-gov-blue/10 px-1.5 py-0.5 text-xs font-medium text-gov-blue">{view.approvalBadge}</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400">目前責任單位</div>
          <div className="font-medium text-gray-800">{view.responsibleTeamName ?? "（尚未指派）"}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">目前等待角色</div>
          <div className="font-medium text-gray-800">
            {view.responsibleRoleLabel}
            {view.isCurrentActorResponsible && !isTerminal && (
              <span className="ml-1.5 rounded bg-gov-red/10 px-1.5 py-0.5 text-xs font-medium text-gov-red">待你處理</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400">已停留時間</div>
          <div className="font-medium text-gray-800">{view.dwellDays !== null ? `${view.dwellDays} 天` : "—"}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">下一個預計階段</div>
          <div className="font-medium text-gray-800">{isTerminal ? "—" : view.nextBusinessStageLabel ?? "（無可前進動作）"}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">尚未完成事項</div>
          <div className="font-medium text-gray-800">{view.todoItems.length} 項</div>
        </div>
        <div className="col-span-2 sm:col-span-2">
          <div className="text-xs text-gray-400">風險／例外狀態</div>
          <div
            className={`font-medium ${
              view.riskStatusLabel === "已確認有風險"
                ? "text-gov-red"
                : view.riskStatusLabel === "風險狀況待釐清"
                ? "text-gov-yellow"
                : view.riskStatusLabel === "尚未填寫風險確認"
                ? "text-gov-blue"
                : "text-gray-400"
            }`}
          >
            {view.riskStatusLabel}
          </div>
        </div>
      </div>

      {/* 7 階段流程進度：桌面版不得出現水平捲動條，採 CSS grid 等分排列 */}
      <div>
        <div className="grid grid-cols-7 gap-1">
          {HOTFIX_BUSINESS_STAGES.map((stage, idx) => {
            const isDone = !isTerminal && view.businessStageIndex !== null && idx < view.businessStageIndex;
            const isCurrent = !isTerminal && idx === view.businessStageIndex;
            const isTerminalDone = isTerminal; // 已結案／已取消：全部階段視為已走完，另外顯示終態徽章
            return (
              <div key={stage} className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                    isCurrent
                      ? "bg-primary text-white"
                      : isDone || isTerminalDone
                      ? "bg-gov-green text-white"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {isDone || isTerminalDone ? "✓" : idx + 1}
                </div>
                <div className={`text-center text-[11px] leading-tight ${isCurrent ? "font-semibold text-gray-800" : "text-gray-400"}`}>{stage}</div>
              </div>
            );
          })}
        </div>
        {isTerminal && terminalLabel && (
          <div className="mt-2 text-center">
            <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-medium text-white">{terminalLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
