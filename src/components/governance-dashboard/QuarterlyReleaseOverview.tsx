// 治理儀表板第四輪：季度上版總覽（四區塊版型 D 區）。
//
// 正式季度上版 Workflow（ChangeRelease issueType 的新版 Workflow）目前尚未建立
// （viewModel.quarterlyReleaseEnabled 依實際資料判斷，不是寫死 false）。尚未啟用時
// 保留區塊版型、只顯示小型說明，不顯示假進度、不寫入正式資料庫。

export default function QuarterlyReleaseOverview({ enabled }: { enabled: boolean }) {
  return (
    <div id="quarterly-release" className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold text-gray-600">季度上版總覽</h3>
      {!enabled ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-400">
          季度上版流程模板尚未啟用。
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-400">
          季度上版資料尚無法完整呈現。
        </div>
      )}
    </div>
  );
}
