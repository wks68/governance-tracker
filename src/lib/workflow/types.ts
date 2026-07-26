// M2-A 新增：Workflow 領域共用型別、固定值域與錯誤類別。
//
// 本檔案刻意不 import Prisma、不執行任何查詢——純型別／純邏輯值域守衛，供本目錄下
// 其他模組與 src/lib/workflowService.ts facade 共用（呼叫端 import 型別一律從
// workflowService.ts 或 index.ts 取得，不直接深入 import 本目錄內部檔案）。
//
// 固定值域沿用既有 src/lib/constants.ts 的「String 欄位 + as const + literal union +
// 型別守衛」慣例（SQLite 不支援原生 enum），但刻意獨立放在本模組內部而非 constants.ts，
// 保持 Workflow 領域自成一體，不與既有 M1/M1.5 值域混雜。

export const TRANSITION_TYPES = ["FORWARD", "RETURN", "CANCEL"] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];
export function isTransitionType(value: string): value is TransitionType {
  return (TRANSITION_TYPES as readonly string[]).includes(value);
}

export const STAGE_TYPES = [
  "SUBMISSION",
  "TRIAGE",
  "CLAIM",
  "WORK",
  "REVIEW",
  "APPROVAL",
  "DEPLOYMENT",
  "CONFIRMATION",
  "CLOSURE",
] as const;
export type StageType = (typeof STAGE_TYPES)[number];
export function isStageType(value: string): value is StageType {
  return (STAGE_TYPES as readonly string[]).includes(value);
}

export const TERMINAL_OUTCOMES = ["COMPLETED", "CANCELLED"] as const;
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];
export function isTerminalOutcome(value: string): value is TerminalOutcome {
  return (TERMINAL_OUTCOMES as readonly string[]).includes(value);
}

export const WORKFLOW_VERSION_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];
export function isWorkflowVersionStatus(value: string): value is WorkflowVersionStatus {
  return (WORKFLOW_VERSION_STATUSES as readonly string[]).includes(value);
}

export const WORKFLOW_STAGE_REQUIREMENT_TYPES = ["REQUIRE_FIELD", "REQUIRE_EVIDENCE", "REQUIRE_COMMENT"] as const;
export type WorkflowStageRequirementType = (typeof WORKFLOW_STAGE_REQUIREMENT_TYPES)[number];
export function isWorkflowStageRequirementType(value: string): value is WorkflowStageRequirementType {
  return (WORKFLOW_STAGE_REQUIREMENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 錯誤類別（比照 src/lib/people/types.ts 既有慣例）
// ---------------------------------------------------------------------------

export class WorkflowValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Workflow 服務驗證失敗：${issues.join("; ")}`);
    this.name = "WorkflowValidationError";
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowNotFoundError";
  }
}

// 版本不可變（已發布／已封存）或其他狀態衝突（例如發布前驗證未通過）一律拋此類別。
export class WorkflowStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowStateError";
  }
}

export class WorkflowAccessDeniedError extends Error {
  constructor(message: string = "沒有權限執行此操作") {
    super(message);
    this.name = "WorkflowAccessDeniedError";
  }
}

// 發布前驗證失敗時，攜帶完整結構化問題清單，不得只丟一段字串。
export class WorkflowPublishValidationError extends Error {
  constructor(public readonly issues: WorkflowValidationIssue[]) {
    super(`Workflow 版本發布前驗證未通過（共 ${issues.length} 項問題）`);
    this.name = "WorkflowPublishValidationError";
  }
}

// ---------------------------------------------------------------------------
// 發布前驗證：結構化問題（第五節），不得只回傳字串
// ---------------------------------------------------------------------------

export type WorkflowValidationSeverity = "error" | "warning";
export type WorkflowValidationEntityType = "WorkflowVersion" | "WorkflowStage" | "WorkflowTransition" | "WorkflowStageRequirement";

export interface WorkflowValidationIssue {
  code: string;
  severity: WorkflowValidationSeverity;
  entityType: WorkflowValidationEntityType;
  entityId: string | null;
  message: string;
  suggestedAction: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

// ---------------------------------------------------------------------------
// definitionService 輸入型別
// ---------------------------------------------------------------------------

export interface CreateWorkflowDefinitionInput {
  key: string;
  name: string;
  description?: string;
  issueType: string;
  actorId: string;
  reasonCode: string;
}

export interface UpdateWorkflowDefinitionInput {
  definitionId: string;
  name?: string;
  description?: string;
  actorId: string;
  reasonCode: string;
}

export interface SetWorkflowDefinitionActiveInput {
  definitionId: string;
  actorId: string;
  reasonCode: string;
}

// ---------------------------------------------------------------------------
// versionService 輸入型別
// ---------------------------------------------------------------------------

export interface CreateDraftVersionInput {
  workflowDefinitionId: string;
  actorId: string;
  reasonCode: string;
}

export interface CloneVersionToDraftInput {
  sourceVersionId: string;
  actorId: string;
  reasonCode: string;
}

export interface ArchiveVersionInput {
  versionId: string;
  actorId: string;
  reasonCode: string;
}

// ---------------------------------------------------------------------------
// stageService 輸入型別
// ---------------------------------------------------------------------------

export interface AddWorkflowStageInput {
  workflowVersionId: string;
  stageKey: string;
  label: string;
  stageType: string;
  sortOrder: number;
  isStart?: boolean;
  isEnd?: boolean;
  terminalOutcome?: string | null;
  assignedTeamId?: string | null;
  requiredExecutionRole?: string | null;
  requiredMembershipRole?: string | null;
  approvalType?: string | null;
  requireReason?: boolean;
  actorId: string;
  reasonCode: string;
}

export interface UpdateWorkflowStageInput {
  stageId: string;
  label?: string;
  stageType?: string;
  sortOrder?: number;
  isStart?: boolean;
  isEnd?: boolean;
  terminalOutcome?: string | null;
  assignedTeamId?: string | null;
  requiredExecutionRole?: string | null;
  requiredMembershipRole?: string | null;
  approvalType?: string | null;
  requireReason?: boolean;
  actorId: string;
  reasonCode: string;
}

export interface RemoveWorkflowStageInput {
  stageId: string;
  actorId: string;
  reasonCode: string;
}

export interface AddWorkflowStageRequirementInput {
  workflowStageId: string;
  requirementType: string;
  targetKey: string;
  actorId: string;
  reasonCode: string;
}

export interface RemoveWorkflowStageRequirementInput {
  requirementId: string;
  actorId: string;
  reasonCode: string;
}

// ---------------------------------------------------------------------------
// transitionService 輸入型別
// ---------------------------------------------------------------------------

export interface AddWorkflowTransitionInput {
  workflowVersionId: string;
  fromStageId: string;
  toStageId: string;
  transitionType: string;
  actionKey: string;
  label: string;
  requireReason?: boolean;
  actorId: string;
  reasonCode: string;
}

export interface UpdateWorkflowTransitionInput {
  transitionId: string;
  label?: string;
  requireReason?: boolean;
  actorId: string;
  reasonCode: string;
}

export interface RemoveWorkflowTransitionInput {
  transitionId: string;
  actorId: string;
  reasonCode: string;
}

// ---------------------------------------------------------------------------
// publishService 輸入型別
// ---------------------------------------------------------------------------

export interface ValidateWorkflowVersionInput {
  versionId: string;
  actorId: string;
}

export interface PublishWorkflowVersionInput {
  versionId: string;
  actorId: string;
  reasonCode: string;
}
