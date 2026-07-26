// M2-B 新增：Issue Workflow 執行狀態唯讀查詢（Runtime View）。
//
// 供 UI Server Component 讀取（Plan 第九節：Server Component 讀取 ViewModel，UI 不直接
// Prisma、不自行決定合法 Transition）。所有欄位皆為現場查詢結果，不快取。

import type { Prisma } from "@prisma/client";
import { hasExecutionCapability } from "./access";
import { evaluateWorkflowStageRequirements, findLatestActiveApprovalRecord } from "./requirementService";
import { getAvailableIssueTransitions, type AvailableTransitionPreview } from "./transitionService";
import { isIssueOnVersionedWorkflow } from "./compatibility";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionNotFoundError } from "./types";
import type { StageRequirementStatus } from "./types";
import { prisma } from "../prisma";

type WorkflowVersionWithDefinition = Prisma.WorkflowVersionGetPayload<{ include: { workflowDefinition: true } }>;
type WorkflowStagePlain = Prisma.WorkflowStageGetPayload<Record<string, never>>;

export interface IssueWorkflowRuntimeNotStarted {
  onVersionedWorkflow: false;
}

export interface IssueWorkflowRuntimeActive {
  onVersionedWorkflow: true;
  version: WorkflowVersionWithDefinition;
  currentStage: WorkflowStagePlain;
  stageRequirements: StageRequirementStatus[];
  availableTransitions: AvailableTransitionPreview[];
  pendingApproval: Awaited<ReturnType<typeof findLatestActiveApprovalRecord>> | null;
}

export type IssueWorkflowRuntime = IssueWorkflowRuntimeNotStarted | IssueWorkflowRuntimeActive;

export async function getIssueWorkflowRuntime(issueId: string, actorId: string): Promise<IssueWorkflowRuntime> {
  const canView = await hasExecutionCapability(actorId, "issue.view");
  if (!canView) throw new WorkflowExecutionAccessDeniedError("僅具備 issue.view 能力者可查看 Workflow 執行狀態");

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new WorkflowExecutionNotFoundError(`找不到 Issue：${issueId}`);

  if (!isIssueOnVersionedWorkflow(issue) || !issue.currentWorkflowStageId) {
    return { onVersionedWorkflow: false };
  }

  const [version, currentStage] = await Promise.all([
    prisma.workflowVersion.findUniqueOrThrow({ where: { id: issue.workflowVersionId! }, include: { workflowDefinition: true } }),
    prisma.workflowStage.findUniqueOrThrow({ where: { id: issue.currentWorkflowStageId } }),
  ]);

  const [stageRequirements, availableTransitions, pendingApproval] = await Promise.all([
    evaluateWorkflowStageRequirements(prisma, issue.id, currentStage.id),
    getAvailableIssueTransitions(issueId, actorId),
    currentStage.stageType === "APPROVAL" && currentStage.approvalType
      ? findLatestActiveApprovalRecord(prisma, issue.id, currentStage.approvalType, currentStage.stageKey)
      : Promise.resolve(null),
  ]);

  return {
    onVersionedWorkflow: true,
    version,
    currentStage,
    stageRequirements,
    availableTransitions,
    pendingApproval,
  };
}

// recordStageRequirementResult：見 requirementService.evaluateWorkflowStageRequirements
// 設計說明——本 API 刻意不新增任何「需求達成快照」資料表，每次呼叫皆現場對照
// IssueFieldValue／Evidence／Comment 重新計算，本身即是「不信任 UI 傳入狀態、一律現場
// 重新解析」信任邊界原則的體現，也避免快取結果與實際資料不同步。實際的欄位／佐證／留言
// 寫入仍走既有 src/lib/actions.ts（updateDynamicFieldsAction／addEvidenceAction／
// addCommentAction）——那些既有 Server Action 本就不分舊流程／新流程 Issue，執行引擎
// 只負責「讀出目前這些資料是否已滿足目前關卡的 Requirement 清單」，不重建一套平行的
// 寫入路徑（避免 UI 出現兩套不同步的「新增佐證」入口）。
export async function recordStageRequirementResult(issueId: string, actorId: string): Promise<StageRequirementStatus[]> {
  const canView = await hasExecutionCapability(actorId, "issue.view");
  if (!canView) throw new WorkflowExecutionAccessDeniedError("僅具備 issue.view 能力者可查看關卡需求達成狀態");

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new WorkflowExecutionNotFoundError(`找不到 Issue：${issueId}`);
  if (!issue.currentWorkflowStageId) return [];

  return evaluateWorkflowStageRequirements(prisma, issue.id, issue.currentWorkflowStageId);
}
