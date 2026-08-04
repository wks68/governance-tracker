// M1.5-A 新增：Hotfix 主流程狀態機（純常數與純函式設計）。
//
// 重要限制：本檔案僅供未來（M3 起）串接參考，M1.5-A 本輪不接入 src/lib/actions.ts、
// 不改變 Issue.workflowStatus 既有資料、不影響任何現有 UI。
//
// 「RD／QA／OP 是否存在唯一有效 primary mapping」的路由判斷依賴 Issue 與 System 的正式
// FK 關聯，但 Issue.systemName 目前仍為自由文字、尚未與 System 建立關聯（M1 既有限制，
// 留待 M3 漸進導入）。因此本檔案的路由判斷函式一律以「已知結果」作為輸入參數（例如
// hasUniqueMapping: boolean），不在此檔案內查詢資料庫或解析 Issue.systemName。
//
// 不再使用單純 next／previous 線性推進：所有轉換皆為顯式 event → to 對照。

export const HOTFIX_MAIN_STATES = [
  "draft",
  "pendingBusinessApproval",
  "pendingRdTriage",
  "pendingRdClaim",
  "rdInProgress",
  "pendingRdLeadApproval",
  "pendingQaTriage",
  "pendingQaClaim",
  "qaInProgress",
  "pendingQaLeadApproval",
  "pendingOpTriage",
  "pendingOpClaim",
  "opPreparing",
  "pendingDeploymentApproval",
  "opDeploying",
  "opCompleted",
  "pendingReporterConfirmation",
  "reporterConfirming",
  "closed",
] as const;

export const HOTFIX_BRANCH_STATES = [
  "pendingReporterSupplement",
  "pendingExceptionTriage",
  "opRollbackInProgress",
  "opRolledBack",
  "cancelled",
] as const;

export const HOTFIX_STATES = [...HOTFIX_MAIN_STATES, ...HOTFIX_BRANCH_STATES] as const;
export type HotfixState = (typeof HOTFIX_STATES)[number];

export function isHotfixState(value: string): value is HotfixState {
  return (HOTFIX_STATES as readonly string[]).includes(value);
}

export type HotfixActorHint =
  | "reporter" // 開單人
  | "businessApprover" // 業務核准人／有效代理人
  | "rdTriageRole" // RD 團隊主管／分流角色／資安治理管理角色／明確授權管理者
  | "rdExecutor" // 被指定之 RD 執行人
  | "rdLeadApprover" // RD 主管／有效代理人
  | "qaTriageRole"
  | "qaExecutor"
  | "qaLeadApprover"
  | "opTriageRole"
  | "opExecutor"
  | "opLeadApprover"
  | "system" // 系統自動轉換
  | "exceptionTriageRole" // RD/OP 主管或資安治理管理角色
  | "reporterOrDesignatedConfirmer" // 開單人／指定驗收人
  | "authorizedManager"; // 開單人或有權限管理者（cancel）

export interface HotfixTransition {
  event: string;
  to: HotfixState;
  actor: HotfixActorHint;
  requiresApprovalType?: "BUSINESS_APPROVAL" | "RD_LEAD_APPROVAL" | "QA_LEAD_APPROVAL" | "DEPLOYMENT_APPROVAL";
  isReject?: boolean;
  note?: string;
}

export const STATE_TRANSITIONS: Record<HotfixState, HotfixTransition[]> = {
  draft: [
    { event: "submit", to: "pendingBusinessApproval", actor: "reporter" },
    { event: "cancel", to: "cancelled", actor: "authorizedManager" },
  ],
  pendingBusinessApproval: [
    {
      event: "businessReject",
      to: "pendingReporterSupplement",
      actor: "businessApprover",
      requiresApprovalType: "BUSINESS_APPROVAL",
      isReject: true,
    },
    {
      event: "businessApprove",
      to: "pendingRdClaim",
      actor: "businessApprover",
      requiresApprovalType: "BUSINESS_APPROVAL",
      note: "僅當 RD 存在唯一有效 primary mapping 時使用此分支，否則走下一筆 pendingRdTriage",
    },
    {
      event: "businessApprove",
      to: "pendingRdTriage",
      actor: "businessApprover",
      requiresApprovalType: "BUSINESS_APPROVAL",
      note: "RD 無唯一有效 primary mapping 時使用",
    },
    { event: "cancel", to: "cancelled", actor: "authorizedManager" },
  ],
  pendingReporterSupplement: [{ event: "resupply", to: "pendingBusinessApproval", actor: "reporter" }],
  pendingRdTriage: [
    {
      event: "rdAssign",
      to: "pendingRdClaim",
      actor: "rdTriageRole",
      note: "一般 RD 執行人不得看到全部未分流案件，僅分流角色可見全部",
    },
  ],
  pendingRdClaim: [{ event: "rdClaim", to: "rdInProgress", actor: "rdExecutor" }],
  rdInProgress: [{ event: "rdSubmit", to: "pendingRdLeadApproval", actor: "rdExecutor" }],
  pendingRdLeadApproval: [
    {
      event: "rdLeadReject",
      to: "rdInProgress",
      actor: "rdLeadApprover",
      requiresApprovalType: "RD_LEAD_APPROVAL",
      isReject: true,
    },
    {
      event: "rdLeadApprove",
      to: "pendingQaClaim",
      actor: "rdLeadApprover",
      requiresApprovalType: "RD_LEAD_APPROVAL",
      note: "僅當 QA 存在唯一有效 primary mapping 時使用",
    },
    {
      event: "rdLeadApprove",
      to: "pendingQaTriage",
      actor: "rdLeadApprover",
      requiresApprovalType: "RD_LEAD_APPROVAL",
      note: "QA 無唯一有效 primary mapping 時使用",
    },
  ],
  pendingQaTriage: [{ event: "qaAssign", to: "pendingQaClaim", actor: "qaTriageRole" }],
  pendingQaClaim: [{ event: "qaClaim", to: "qaInProgress", actor: "qaExecutor" }],
  qaInProgress: [{ event: "qaSubmit", to: "pendingQaLeadApproval", actor: "qaExecutor" }],
  pendingQaLeadApproval: [
    {
      event: "qaLeadReject",
      to: "qaInProgress",
      actor: "qaLeadApprover",
      requiresApprovalType: "QA_LEAD_APPROVAL",
      isReject: true,
    },
    {
      event: "qaLeadApprove",
      to: "pendingOpClaim",
      actor: "qaLeadApprover",
      requiresApprovalType: "QA_LEAD_APPROVAL",
      note: "僅當 OP 存在唯一有效 primary mapping 時使用",
    },
    {
      event: "qaLeadApprove",
      to: "pendingOpTriage",
      actor: "qaLeadApprover",
      requiresApprovalType: "QA_LEAD_APPROVAL",
      note: "OP 無唯一有效 primary mapping 時使用",
    },
  ],
  pendingOpTriage: [{ event: "opAssign", to: "pendingOpClaim", actor: "opTriageRole" }],
  pendingOpClaim: [{ event: "opClaim", to: "opPreparing", actor: "opExecutor" }],
  opPreparing: [{ event: "opSubmit", to: "pendingDeploymentApproval", actor: "opExecutor" }],
  pendingDeploymentApproval: [
    {
      event: "opLeadReject",
      to: "opPreparing",
      actor: "opLeadApprover",
      requiresApprovalType: "DEPLOYMENT_APPROVAL",
      isReject: true,
    },
    {
      event: "opLeadApprove",
      to: "opDeploying",
      actor: "opLeadApprover",
      requiresApprovalType: "DEPLOYMENT_APPROVAL",
    },
  ],
  opDeploying: [
    { event: "opDeployComplete", to: "opCompleted", actor: "opExecutor" },
    { event: "opRollbackStart", to: "opRollbackInProgress", actor: "opLeadApprover" },
  ],
  opRollbackInProgress: [{ event: "opRollbackComplete", to: "opRolledBack", actor: "opExecutor" }],
  opRolledBack: [{ event: "exceptionTriageOpen", to: "pendingExceptionTriage", actor: "system" }],
  pendingExceptionTriage: [
    { event: "resumeToRd", to: "rdInProgress", actor: "exceptionTriageRole" },
    { event: "resumeToOpPreparing", to: "opPreparing", actor: "exceptionTriageRole" },
    { event: "cancelIssue", to: "cancelled", actor: "exceptionTriageRole" },
  ],
  opCompleted: [
    {
      event: "opPostConfirmReject",
      to: "opDeploying",
      actor: "opLeadApprover",
      requiresApprovalType: "DEPLOYMENT_APPROVAL",
      isReject: true,
    },
    {
      event: "reporterConfirmOpen",
      to: "pendingReporterConfirmation",
      actor: "opLeadApprover",
      requiresApprovalType: "DEPLOYMENT_APPROVAL",
    },
  ],
  pendingReporterConfirmation: [
    { event: "reporterClaim", to: "reporterConfirming", actor: "reporterOrDesignatedConfirmer" },
  ],
  reporterConfirming: [
    { event: "reporterClose", to: "closed", actor: "reporterOrDesignatedConfirmer" },
    { event: "reporterRejectConfirm", to: "pendingExceptionTriage", actor: "reporterOrDesignatedConfirmer" },
  ],
  closed: [],
  cancelled: [],
};

export function getTransition(from: HotfixState, event: string): HotfixTransition[] {
  return (STATE_TRANSITIONS[from] ?? []).filter((t) => t.event === event);
}

// 純函式：業務核准後 RD 路由判斷。輸入由呼叫端解析（M3 起串接 SystemTeamMapping），
// 本檔案不查詢資料庫、不解析 Issue.systemName。
export function resolveRdRoutingAfterBusinessApproval(
  hasUniqueRdMapping: boolean,
): "pendingRdClaim" | "pendingRdTriage" {
  return hasUniqueRdMapping ? "pendingRdClaim" : "pendingRdTriage";
}

export function resolveQaRoutingAfterRdLeadApproval(
  hasUniqueQaMapping: boolean,
): "pendingQaClaim" | "pendingQaTriage" {
  return hasUniqueQaMapping ? "pendingQaClaim" : "pendingQaTriage";
}

export function resolveOpRoutingAfterQaLeadApproval(
  hasUniqueOpMapping: boolean,
): "pendingOpClaim" | "pendingOpTriage" {
  return hasUniqueOpMapping ? "pendingOpClaim" : "pendingOpTriage";
}
