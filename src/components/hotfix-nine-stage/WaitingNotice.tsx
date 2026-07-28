// Hotfix 九階段 UI：分流／認領（TRIAGE／CLAIM）這類技術性中繼關卡的通用唯讀提示——
// 這些關卡不是 9 個正式業務階段本身要求的填寫表單，只是既有引擎「指派處理團隊→認領」
// 的既定流程，沿用既有機制，這裡不重建一套新的團隊指派 UI（超出本輪範圍）。

export default function WaitingNotice({ stageLabel }: { stageLabel: string }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-600">目前關卡：{stageLabel}</p>
      <p className="mt-1 text-xs text-gray-400">此關卡由既有處理團隊指派／認領機制處理，待處理團隊認領後即可在此頁填寫工作內容。</p>
    </section>
  );
}
