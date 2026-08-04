// M2-A 新增：Workflow 領域模組聚合匯出。
//
// src/lib/workflowService.ts（穩定 Facade）從本檔案匯出，外部呼叫端一律經由
// workflowService.ts 呼叫，不直接 import src/lib/workflow/* 內部檔案。

export * from "./types";

export { createWorkflowDefinition, updateWorkflowDefinition, activateWorkflowDefinition, deactivateWorkflowDefinition } from "./definitionService";
export { createDraftVersion, cloneVersionToDraft, archiveVersion } from "./versionService";
export {
  addWorkflowStage,
  updateWorkflowStage,
  removeWorkflowStage,
  addWorkflowStageRequirement,
  removeWorkflowStageRequirement,
} from "./stageService";
export { addWorkflowTransition, updateWorkflowTransition, removeWorkflowTransition } from "./transitionService";
export { validateWorkflowVersion, publishWorkflowVersion, assertDraftVersion, canManageWorkflowDraft } from "./publishService";
export {
  listWorkflowDefinitionsForActor,
  getWorkflowDefinitionDetailForActor,
  getWorkflowVersionDetailForActor,
} from "./queries";
export { isIssueOnVersionedWorkflow, listSelectablePublishedVersionsForIssueType } from "./compatibility";

// UI 需要「這位 actor 能不能做 X」的唯讀提示（僅供決定要不要顯示某個按鈕／表單），
// 實際授權仍一律由各服務在呼叫當下重新解析——UI 不得快取或傳遞此結果代替服務層檢查。
// 比照 src/lib/people/index.ts 既有慣例，刻意只匯出 has*，不匯出 require*。
export { hasWorkflowCapability } from "./access";
