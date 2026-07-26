// M2-B 新增：workflowStatus 相容層（執行引擎視角）。
//
// 單一事實來源原則（Plan M2 第六節，M2-A 已在 src/lib/workflow/compatibility.ts 建立唯讀
// 判斷）：workflowVersionId／currentWorkflowStageId 是新流程 Issue 的唯一權威來源，
// workflowStatus 只在 transition transaction 內同步為目前 Stage 的 stageKey，純快取，
// 新流程的授權、可用動作、transition 判斷一律不得讀取 workflowStatus。
//
// 本檔案只重新匯出 M2-A 已定義的判斷函式，讓 workflow-execution 目錄內其他檔案統一從
// "./compatibility" import，不需要每個檔案各自處理 "../workflow.ts"（legacy）與
// "../workflow/index.ts"（M2-A 模組）同名相對路徑解析衝突（見 src/lib/workflowService.ts
// 檔案頂端註解）。

export { isIssueOnVersionedWorkflow, listSelectablePublishedVersionsForIssueType } from "../workflow/index";
