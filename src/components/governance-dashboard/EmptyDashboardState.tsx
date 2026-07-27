// 治理儀表板 MVP 新增：統一的「無資料」訊息元件。
//
// Plan 第七節要求：0 件、尚無資料、尚無可計算完成時間、尚無 RETURN 紀錄、尚無風險
// 紀錄等情境必須正確顯示，不得顯示假資料、不得把 0 顯示成錯誤。本元件只是純展示，
// 不做任何資料判斷。

export default function EmptyDashboardState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-400">
      {message}
    </div>
  );
}
