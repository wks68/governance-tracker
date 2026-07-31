// M2-B 新增：Issue Workflow 執行引擎模組聚合匯出。
//
// src/lib/workflowExecutionService.ts（穩定 Facade）從本檔案匯出，外部呼叫端一律經由
// workflowExecutionService.ts 呼叫，不直接 import src/lib/workflow-execution/* 內部檔案
// （比照 src/lib/workflow/index.ts 既有慣例）。

export * from "./types";

export { startIssueWorkflow, startWorkflowForIssueSystemTx } from "./startService";
export {
  executeIssueTransition,
  // 供「建立工單即送簽」等需要在自己 transaction 內接續推進關卡的呼叫端使用
  // （見 src/lib/issueCreation.ts、claimService、assignmentService）。
  executeIssueTransitionInTx,
  returnIssueToStage,
  returnPostDeploymentForCorrection,
  cancelIssueWorkflow,
  completeIssueWorkflow,
  getAvailableIssueTransitions,
  validateIssueTransition,
  type AvailableTransitionPreview,
  type ValidateTransitionResult,
} from "./transitionService";
export {
  setIssueAssignedTeamAtTriage,
  listAssignableMembers,
  assignIssueExecutor,
  reassignIssueExecutor,
  getCurrentExecutorUserId,
  assertActorIsCurrentExecutor,
  type AssignableMemberInfo,
  type AssignableMembersPreview,
  type AssignIssueExecutorInput,
  type ReassignIssueExecutorInput,
} from "./assignmentService";
export {
  listClaimableTeamsForStage,
  evaluateClaimEligibility,
  claimIssueForTeam,
  type ClaimableTeamInfo,
  type ClaimableStagePreview,
  type ClaimEligibilityResult,
  type ClaimIssueForTeamInput,
} from "./claimService";
export { getClaimDomainForStageKey, getExecutorDomainForStageKey } from "./hotfixDomainMap";
export { evaluateCurrentActorTask, type ActorTaskSummary, type IssueActionKind } from "./responsibilityService";
export {
  listActionableTasksForActor,
  resolveActionableTasksForActor,
  resolveIssueTasksForActor,
  type ActionableIssueTask,
  type ActionableIssueSource,
  type ResolvedIssueTask,
} from "./actionabilityService";
export { getIssueWorkflowHistory } from "./historyService";
export { getIssueWorkflowRuntime, recordStageRequirementResult, type IssueWorkflowRuntime } from "./queries";
export { evaluateWorkflowStageRequirements, submitStageFieldValue, submitStageRiskCheckAnswer } from "./requirementService";
export { isIssueOnVersionedWorkflow, listSelectablePublishedVersionsForIssueType, resolveUniqueAutoStartVersionForIssueType } from "./compatibility";

// UI 需要「這位 actor 能不能做 X」的唯讀提示（僅供決定要不要顯示某個按鈕／表單），
// 實際授權仍一律由各服務在呼叫當下重新解析——UI 不得快取或傳遞此結果代替服務層檢查。
export { hasExecutionCapability, evaluateActorEligibilityForStage, type ActorEligibilityResult } from "./access";
