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

import { listSelectablePublishedVersionsForIssueType } from "../workflow/index";

// 新 Issue 建立當下自動啟動的目標版本解析：唯一規則來源，createIssueAction 與任何未來
// 呼叫端一律共用本函式，不得各自在呼叫端重新挑選。
//
// listSelectablePublishedVersionsForIssueType 依 versionNo 由大到小排序，但當「兩個不同
// WorkflowDefinition 同時符合同一個 issueType」時（Plan 未禁止此設定，M2-A 也未強制同一
// issueType 只能有一個啟用中 Definition），取全域 versionNo 最大者並不能真正消除歧義——
// 不同 Definition 的 versionNo 各自獨立計數，同分時退回資料庫回傳順序，等同「依查詢回傳
// 順序隨機挑選」，Plan 明確禁止。因此規則改為：
//   - 候選版本橫跨 0 個 Definition → 回傳 null（沿用今天完全一致的舊模型建立流程）。
//   - 候選版本恰好橫跨 1 個 Definition（該 Definition 可能有多個已發布版本）→ 取該
//     Definition 內 versionNo 最大者，這是有明確定義的排序，不是任意選擇。
//   - 候選版本橫跨 ≥2 個不同 Definition → 無法唯一判定應使用哪一個，fail closed：回傳
//     null，退回舊模型建立流程（不阻擋建立工單本身，只是不自動綁定新版執行引擎），
//     不得任意挑選其中一個。
export async function resolveUniqueAutoStartVersionForIssueType(issueType: string) {
  const candidates = await listSelectablePublishedVersionsForIssueType(issueType);
  if (candidates.length === 0) return null;

  const distinctDefinitionIds = new Set(candidates.map((c) => c.workflowDefinitionId));
  if (distinctDefinitionIds.size > 1) return null; // 歧義，fail closed

  return candidates[0]; // 已按 versionNo desc 排序，同一 Definition 內最大版號
}
