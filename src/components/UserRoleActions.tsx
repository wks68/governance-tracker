import { roleLabel } from "@/lib/constants";

// C1-B5：fail-closed 過渡狀態。
//
// 舊版角色下拉／啟停按鈕直接呼叫 assignUserRoleAction／setUserActiveAction，兩者已改為
// 一律要求 reasonCode 並改經 peopleService 授權與寫入（見 src/lib/actions.ts）；本元件
// 目前沒有能讓使用者填寫 reasonCode 的欄位，若照舊呼叫一定會被拒絕。與其讓使用者點擊後
// 才收到錯誤，這裡直接停用操作、只顯示唯讀狀態與過渡說明。完整角色／帳號狀態管理介面
// （含必填異動原因）留待 C1-C 提供。
export default function UserRoleActions({ currentRole, isActive }: { userId: string; currentRole: string; isActive: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-500">
          {roleLabel(currentRole)}
        </span>
        <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-400">
          {isActive ? "停用" : "啟用"}（暫停開放）
        </span>
      </div>
      <p className="text-xs text-gray-400">角色與帳號狀態管理將於 C1-C 提供完整介面（含必填異動原因紀錄），此處操作暫時停用。</p>
    </div>
  );
}
