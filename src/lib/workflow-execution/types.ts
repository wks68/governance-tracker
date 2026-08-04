// M2-B 新增：Issue Workflow 執行引擎共用型別與錯誤類別。
//
// 本檔案刻意不 import Prisma、不執行任何查詢——純型別／值域守衛，供本目錄下其他
// 模組與 src/lib/workflowExecutionService.ts facade 共用（呼叫端一律從
// workflowExecutionService.ts import，不直接深入 import 本目錄內部檔案，比照
// src/lib/workflow/types.ts 既有慣例）。
//
// 責任邊界：本模組是「Issue 實際執行」（M2-B），不是「流程定義管理」（M2-A，見
// src/lib/workflow/）。本模組只讀取 M2-A 已發布的 WorkflowVersion／Stage／Transition／
// Requirement 資料作為執行依據，不提供任何修改流程定義的函式。

export class WorkflowExecutionValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Workflow 執行服務驗證失敗：${issues.join("; ")}`);
    this.name = "WorkflowExecutionValidationError";
  }
}

export class WorkflowExecutionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowExecutionNotFoundError";
  }
}

// Issue 尚未啟動 Workflow、版本已封存不可再執行、current stage 與傳入 transition 不符
// （涵蓋重複送出／舊畫面覆蓋新狀態）、跨 Version transition、CANCEL 後再嘗試 FORWARD 等
// 狀態衝突，一律拋此類別，fail closed。
export class WorkflowExecutionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowExecutionStateError";
  }
}

export class WorkflowExecutionAccessDeniedError extends Error {
  constructor(message: string = "沒有權限執行此操作") {
    super(message);
    this.name = "WorkflowExecutionAccessDeniedError";
  }
}

// 結構化「為何不能執行這個 Transition」清單（Requirement 未完成／Approval 未過或未駁回／
// 風險檢核未就緒／TRIAGE 尚未指派團隊…），比照 src/lib/workflow/types.ts 的
// WorkflowPublishValidationError 慣例，永遠帶完整清單，不得只丟一段字串。
export type BlockedReasonCode =
  | "VERSION_NOT_PUBLISHED"
  | "STAGE_REQUIREMENT_NOT_MET"
  | "APPROVAL_NOT_GRANTED"
  | "APPROVAL_NOT_REJECTED"
  | "TRIAGE_TEAM_NOT_ASSIGNED"
  | "ACTOR_NOT_ELIGIBLE"
  | "REASON_CODE_REQUIRED";

export interface BlockedReason {
  code: BlockedReasonCode;
  message: string;
}

export class WorkflowExecutionBlockedError extends Error {
  constructor(public readonly reasons: BlockedReason[]) {
    super(`Transition 無法執行（${reasons.length} 項阻擋原因）：${reasons.map((r) => r.message).join("; ")}`);
    this.name = "WorkflowExecutionBlockedError";
  }
}

// ---------------------------------------------------------------------------
// 需求（Requirement）評估結果
// ---------------------------------------------------------------------------

export interface StageRequirementStatus {
  requirementId: string;
  requirementType: string;
  targetKey: string;
  satisfied: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// 服務輸入型別
// ---------------------------------------------------------------------------

export interface StartIssueWorkflowInput {
  issueId: string;
  workflowVersionId: string;
  actorId: string;
  reasonCode: string;
}

export interface ExecuteTransitionInput {
  issueId: string;
  transitionId: string;
  actorId: string;
  reasonCode?: string | null;
}

export interface SetIssueAssignedTeamAtTriageInput {
  issueId: string;
  teamId: string;
  actorId: string;
  reasonCode: string;
}
