// M1.5-C1-C 新增：Server Action 統一回傳型別。
//
// 只給 C1-C 新增的人員／Team 管理 Action 使用；既有 M1.5-B
// approvalGovernanceActions.ts（throw-and-catch）維持原樣，不在此次一併回頭修改。
//
// toActionResult 只信任「已知的領域錯誤類別」的 .message（皆為服務層自行組出的可讀
// 中文訊息，不含 SQL／DB 路徑／stack trace）。任何未知錯誤（例如 Prisma 例外）一律
// 記錄到 server console，回傳固定的通用訊息，不把原始錯誤內容往前端透露。

import {
  PeopleValidationError,
  PeopleStateError,
  PeopleAccessDeniedError,
  PeopleNotFoundError,
} from "./peopleService";
import {
  GovernanceValidationError,
  GovernanceStateError,
  GovernanceAccessDeniedError,
  GovernanceNotFoundError,
} from "./supervisorAssignmentService";
import {
  WorkflowValidationError,
  WorkflowStateError,
  WorkflowAccessDeniedError,
  WorkflowNotFoundError,
  WorkflowPublishValidationError,
} from "./workflowService";
import {
  WorkflowExecutionValidationError,
  WorkflowExecutionNotFoundError,
  WorkflowExecutionStateError,
  WorkflowExecutionAccessDeniedError,
  WorkflowExecutionBlockedError,
} from "./workflowExecutionService";
import {
  ApprovalValidationError,
  ApprovalNotFoundError,
  ApprovalStateError,
  ApprovalAuthorityMismatchError,
  DuplicateActivePendingApprovalError,
  RiskCheckIncompleteError,
  UnresolvedUnknownRiskError,
} from "./approvalService";
import { AttachmentValidationError, AttachmentAuthorizationError } from "./hotfix-ui/attachmentService";
import { IssueAttachmentValidationError, IssueAttachmentAuthorizationError } from "./issue-attachments/service";
import { HotfixPageNotApplicableError } from "./hotfix-ui/pageContext";
import { TeamApplicantAccessDeniedError, TeamApplicantValidationError } from "./team-applicant/teamApplicantService";
import { NoEligibleApproverError } from "./approvalService";
import { TeamManagementValidationError, TeamManagementStateError, TeamManagementAccessDeniedError } from "./team-applicant/teamManagementService";
import { IssueDeletionValidationError, IssueDeletionStateError, IssueDeletionAccessDeniedError } from "./issue-management/issueDeletionService";
import { IssueCreationValidationError } from "./issueCreation";
import { IncidentCreationValidationError } from "./incident-ui/incidentCreation";
import { IncidentPageNotApplicableError } from "./incident-ui/pageContext";
import { IncidentRcaNotClosedError } from "./incident-ui/incidentClosureService";
import {
  IssueRelationAccessDeniedError,
  IssueRelationConflictError,
  IssueRelationNotFoundError,
  IssueRelationValidationError,
} from "./issue-relations/service";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message: string }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

export function actionOk<T = undefined>(message: string, data?: T): ActionResult<T> {
  return { ok: true, data, message };
}

const KNOWN_DOMAIN_ERRORS = [
  PeopleValidationError,
  PeopleStateError,
  PeopleAccessDeniedError,
  PeopleNotFoundError,
  GovernanceValidationError,
  GovernanceStateError,
  GovernanceAccessDeniedError,
  GovernanceNotFoundError,
  WorkflowValidationError,
  WorkflowStateError,
  WorkflowAccessDeniedError,
  WorkflowNotFoundError,
  WorkflowPublishValidationError,
  WorkflowExecutionValidationError,
  WorkflowExecutionNotFoundError,
  WorkflowExecutionStateError,
  WorkflowExecutionAccessDeniedError,
  WorkflowExecutionBlockedError,
  ApprovalValidationError,
  ApprovalNotFoundError,
  ApprovalStateError,
  ApprovalAuthorityMismatchError,
  DuplicateActivePendingApprovalError,
  RiskCheckIncompleteError,
  UnresolvedUnknownRiskError,
  AttachmentValidationError,
  AttachmentAuthorizationError,
  IssueAttachmentValidationError,
  IssueAttachmentAuthorizationError,
  HotfixPageNotApplicableError,
  TeamApplicantAccessDeniedError,
  TeamApplicantValidationError,
  NoEligibleApproverError,
  TeamManagementValidationError,
  TeamManagementStateError,
  TeamManagementAccessDeniedError,
  IssueDeletionValidationError,
  IssueDeletionStateError,
  IssueDeletionAccessDeniedError,
  IssueCreationValidationError,
  IssueRelationAccessDeniedError,
  IssueRelationConflictError,
  IssueRelationNotFoundError,
  IssueRelationValidationError,
  IncidentCreationValidationError,
  IncidentPageNotApplicableError,
  IncidentRcaNotClosedError,
] as const;

export function toActionResult(err: unknown, fallbackMessage = "操作失敗，請稍後再試"): ActionResult<never> {
  for (const ErrorClass of KNOWN_DOMAIN_ERRORS) {
    if (err instanceof ErrorClass) {
      return { ok: false, code: err.name, message: err.message };
    }
  }
  console.error("[actionResult] 未預期錯誤：", err);
  return { ok: false, code: "UNKNOWN_ERROR", message: fallbackMessage };
}
