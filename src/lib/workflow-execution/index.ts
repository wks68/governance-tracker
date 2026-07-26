// M2-B 新增：Issue Workflow 執行引擎模組聚合匯出。
//
// src/lib/workflowExecutionService.ts（穩定 Facade）從本檔案匯出，外部呼叫端一律經由
// workflowExecutionService.ts 呼叫，不直接 import src/lib/workflow-execution/* 內部檔案
// （比照 src/lib/workflow/index.ts 既有慣例）。

export * from "./types";

export { startIssueWorkflow, startWorkflowForIssueSystemTx } from "./startService";
export {
  executeIssueTransition,
  returnIssueToStage,
  cancelIssueWorkflow,
  completeIssueWorkflow,
  getAvailableIssueTransitions,
  validateIssueTransition,
  type AvailableTransitionPreview,
  type ValidateTransitionResult,
} from "./transitionService";
export { setIssueAssignedTeamAtTriage } from "./assignmentService";
export { getIssueWorkflowHistory } from "./historyService";
export { getIssueWorkflowRuntime, recordStageRequirementResult, type IssueWorkflowRuntime } from "./queries";
export { evaluateWorkflowStageRequirements, submitStageFieldValue } from "./requirementService";
export { isIssueOnVersionedWorkflow, listSelectablePublishedVersionsForIssueType } from "./compatibility";

// UI 需要「這位 actor 能不能做 X」的唯讀提示（僅供決定要不要顯示某個按鈕／表單），
// 實際授權仍一律由各服務在呼叫當下重新解析——UI 不得快取或傳遞此結果代替服務層檢查。
export { hasExecutionCapability } from "./access";
