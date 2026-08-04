# UI 動畫盤點

盤點日期：2026-08-01
範圍：目前工作區的 App Shell、Hotfix 九階段頁面、通用工單頁與共用 UI 元件。

## 原則

- 動畫只補強狀態改變，不承擔唯一的資訊傳達；文字、顏色、圖示與 `aria-*` 狀態在停用動畫後仍完整。
- Workflow 只有目前節點可播放持續動畫。完成與未來節點只允許一次性轉場，穩定狀態不得持續播放。
- 所有新動畫都必須由 `prefers-reduced-motion: reduce` 停用，既有 hover／focus 與 loading 文字仍保留。
- Hotfix 九階段的完成色只取用 `workflow-complete*` semantic tokens，不在元件內寫死色碼。

## Workflow 動畫

| 項目 | 觸發與效果 | 實作位置 | Reduced motion | 驗證重點 |
| --- | --- | --- | --- | --- |
| Workflow 呼吸動畫 | 僅目前節點顯示向外擴散的藍色 halo，2.2 秒循環 | `NineStageProgressBar.tsx` 的 `animate-stage-halo`；`tailwind.config.ts` 的 `stage-halo` | 停用 animation，並把 halo opacity 設為 0 | active 狀態恰有一個 current；completed／future／closed／cancelled 不渲染 halo |
| Workflow 圓心動畫 | 僅目前節點的藍色圓心做輕微縮放與透明度呼吸，2.2 秒循環 | `animate-stage-core` / `stage-core` | 停用 animation；保留靜態藍色圓心 | 與 halo 同一個 `isCurrent` 分支，不可能出現在完成節點 |
| 藍轉綠動畫 | 流程向前或結案時，新完成節點由 primary 藍一次轉為完成綠並輕微放大回彈 | `animate-stage-complete-enter` / `stage-complete-enter` | 停用一次性動畫，直接呈現綠色終態 | 只套在 `newlyCompleted`，不在既有 completed 節點持續播放 |
| 白色勾選動畫 | 新完成節點的 Lucide `Check` 由縮小／旋轉／透明進場 | `animate-stage-check-in` / `stage-check-in` | 停用一次性動畫；白色勾選仍存在 | 勾選色為 `workflow-complete-foreground`，不是文字字元或藍色圖示 |
| 完成連線動畫 | 新完成節點右側連線以 `scaleX(0→1)` 填滿；跨多階段前進時逐段標示 | `animate-stage-line-fill` / `stage-line-fill` | 停用一次性動畫；連線直接呈現 `workflow-complete-line` | completed 之間與 completed→current 的有效連線為綠色；future 連線維持灰色 |
| 新目前節點動畫 | 前進或駁回後的新 current 由縮小／淡入進場，之後只保留 halo/core | `animate-stage-current-enter` / `stage-current-enter` | 停用一次性動畫；目前節點仍為藍框、藍心、藍字 | 同一時間只允許一個 current；結案與取消時為零個 |
| 駁回返回動畫 | `sessionStorage` 的前一狀態索引大於新索引時判定為 `return`；不把退回跨過的節點誤標完成，只替新 current 播放一次進場 | `NineStageProgressBar.tsx` 的 `ProgressTransition.kind === "return"` | 同上 | 退回後完成區依新索引重算；不播放錯誤的綠色完成轉場 |

Workflow 轉場以 `dms-workflow-progress:<issueId>` 保存前一個視覺快照。相同快照在 React Strict Mode 下只處理一次，但同一個 component instance 因 route refresh 收到新狀態時仍會重新比較並觸發轉場。Storage 不可用時 fail-soft：只失去一次性動畫，靜態狀態仍正確。

## Shell、回饋與共用元件

| 項目 | 現況 | 實作位置 | Reduced motion / 注意事項 |
| --- | --- | --- | --- |
| Sidebar 收合／展開 | 桌面 sidebar 的 width 與主內容 padding 以 200ms transition 收合；工作管理、設定及群組子選單以 grid row + opacity 展開／收合 | `src/components/app-shell/AppShell.tsx` | 子選單有 `motion-reduce:transition-none`；桌面 width/padding 為既有 transition，資訊不因動畫停用而缺失 |
| Mobile Drawer | overlay 淡入、面板由左滑入；關閉時保留 DOM 220ms 以完成 opacity/transform 離場；包含 Escape、focus trap、body scroll lock 與焦點返回 | `AppShell.tsx`；`drawer-overlay-in`、`mobile-drawer-panel-in` | transition 與 keyframe 都可停用；`aria-hidden` 隨 open 狀態更新 |
| Notification Bell | 有待辦且 popover 未開啟時，以 2.4 秒週期輕微擺動 | `ActionableNotificationBell.tsx`、`globals.css` 的 `notification-bell-wiggle` | `prefers-reduced-motion` 停用；badge 數字仍傳達待辦數 |
| Toast | 新 Toast 180ms 向下淡入，關閉前以 400ms opacity 淡出 | `src/components/toast/AppToastProvider.tsx`、`globals.css` 的 `app-toast-enter` | enter keyframe 會停用；淡出仍有靜態可讀訊息及關閉按鈕 |
| Modal／Dialog | Hotfix 駁回／退回 Dialog 有 overlay/content 進出場；共用右側 Drawer 有 overlay 淡入與面板滑入／滑出；關閉後焦點回觸發按鈕 | `ApprovalReviewPanel.tsx`、`ClosureConfirmPanel.tsx`、`Drawer.tsx` | 所有新增 dialog/drawer keyframe 都在 reduced-motion 清單；`AssignExecutorPanel`、附件文字預覽等舊式 modal 目前仍是無動畫立即顯示，未移除任何既有行為 |
| Progress Bar | Hotfix 九階段使用上述狀態轉場；非 Hotfix 的 `WorkflowProgress.tsx` 是可水平捲動的靜態 legacy progress，沒有動畫 | `NineStageProgressBar.tsx`、`WorkflowProgress.tsx` | 不把 Hotfix 九階段動畫硬套到其他 Issue Type；需先抽象 stage/view model |
| 條件式欄位 | OP 公告、服務操作、其他影響、Rollback、監控與異常說明依欄位值即時 mount/unmount；通用 `DynamicFieldsForm` 依 template 顯示 | `OpDeploymentForms.tsx`、`DynamicFieldsForm.tsx` | 現況沒有專用進出場動畫；本次未移除既有條件與資料清理邏輯。若日後加動畫，須保留 label/input 關聯及 reduced-motion fallback |
| 附件 Drag-over | drag-over 時以 150ms border/background color transition 顯示 drop target | `AttachmentSection.tsx` | `motion-reduce:transition-none`；drag leave/drop 都會清除狀態 |
| 附件上傳 | 上傳期間按鈕 disabled，文案切換為「上傳中…」；成功後 refresh | `AttachmentSection.tsx` | 這是 pending 狀態回饋，不依賴動畫 |
| 附件新增 | server refresh 後，附件 item 以 180ms 向上淡入 | `animate-item-enter` / `item-enter` | reduced motion 停用後直接顯示 |
| 附件刪除 | 刪除期間按鈕 disabled，文案切換為「刪除中…」；成功後 refresh；沒有虛假的預先離場 | `AttachmentSection.tsx` | pending 文字保留；不以動畫掩蓋失敗回復 |
| Button pending／loading | 全站使用 `useTransition` / `isPending` / `isSubmitting` 停用重複操作並切換「處理中…／建立中…／上傳中…」等文案；Loading feedback 使用 `animate-spin` | Hotfix forms、`NewIssueForm.tsx`、workflow-execution 元件、`FeedbackState.tsx` 等 | 即使 reduced motion 停止 spinner，文字仍可辨識狀態；不得只靠旋轉表示 pending |

## `prefers-reduced-motion` 覆蓋

`src/app/globals.css` 已集中停用以下 keyframe class：

- `animate-notification-bell`
- `animate-stage-halo`、`animate-stage-core`
- `animate-stage-complete-enter`、`animate-stage-check-in`
- `animate-stage-line-fill`、`animate-stage-current-enter`
- `animate-drawer-overlay-in`、`animate-drawer-panel-in`、`animate-mobile-drawer-panel-in`
- `animate-dialog-overlay-in/out`、`animate-dialog-content-in/out`
- `animate-item-enter`
- `app-toast-enter`

使用 Tailwind transition 的 Drawer、Mobile Drawer、子選單與附件 drag-over 另以 `motion-reduce:transition-none` 覆蓋。Reduced motion 下 Workflow 仍以藍色 current、綠色 completed、灰色 future、結案／取消文字提示完整表達狀態。

## 驗證方式

- `scripts/hotfix_ui-verify.ts` 靜態檢查 semantic tokens、單一 current、closed/cancelled 狀態、動畫 class 與 reduced-motion 覆蓋。
- 同一腳本的隔離 DB 整合測試實際推進、駁回、結案及取消 Workflow，避免只驗字串而未驗業務狀態。
- TypeScript、lint、build 與 HTTP smoke 負責驗證 client/server 邊界、Tailwind class 產出與實際頁面可啟動性。
