// 系統共用常數：角色、工單類型、狀態燈號、佐證類型等
// 程式內部 key 使用英文，畫面顯示文字一律使用繁體中文

export type IssueTypeKey =
  | "Hotfix"
  | "Incident"
  | "RCA"
  | "RiskException"
  | "QaVerification"
  | "ChangeRelease"
  | "MonitoringInventory"
  | "BackupRecoveryTest";

export const ISSUE_TYPES: { key: IssueTypeKey; label: string; shortLabel: string }[] = [
  { key: "Hotfix", label: "Hotfix：緊急修正", shortLabel: "緊急修正" },
  { key: "Incident", label: "Incident：事件通報", shortLabel: "事件通報" },
  { key: "RCA", label: "RCA：根因分析", shortLabel: "根因分析" },
  { key: "RiskException", label: "Risk Exception：風險例外", shortLabel: "風險例外" },
  { key: "QaVerification", label: "QA Verification：QA 驗證", shortLabel: "QA 驗證" },
  { key: "ChangeRelease", label: "Change / Release：變更 / 上線", shortLabel: "變更 / 上線" },
  { key: "MonitoringInventory", label: "Monitoring Inventory：監控盤點", shortLabel: "監控盤點" },
  { key: "BackupRecoveryTest", label: "Backup / Recovery Test：備份與復原驗證", shortLabel: "備份復原驗證" },
];

export function issueTypeLabel(key: string): string {
  return ISSUE_TYPES.find((t) => t.key === key)?.label ?? key;
}
export function issueTypeShortLabel(key: string): string {
  return ISSUE_TYPES.find((t) => t.key === key)?.shortLabel ?? key;
}

export type RoleKey = "PM" | "RD" | "QA" | "OP" | "資安推動小組" | "DMS主管" | "Admin";

export const ROLES: { key: RoleKey; label: string }[] = [
  { key: "PM", label: "PM" },
  { key: "RD", label: "RD" },
  { key: "QA", label: "QA" },
  { key: "OP", label: "OP" },
  { key: "資安推動小組", label: "資安推動小組" },
  { key: "DMS主管", label: "DMS 主管" },
  { key: "Admin", label: "Admin" },
];

export const DEFAULT_ROLE: RoleKey = "PM";

export function roleLabel(key: string): string {
  return ROLES.find((r) => r.key === key)?.label ?? key;
}

export function isRoleKey(value: string): value is RoleKey {
  return ROLES.some((r) => r.key === value);
}

export type StatusLight = "Red" | "Yellow" | "Blue" | "Green" | "Gray";

export const STATUS_LIGHT_META: Record<StatusLight, { label: string; desc: string; badgeClass: string; dotClass: string }> = {
  Red: {
    label: "異常 / 逾期",
    desc: "已逾期、關卡卡控未通過、Critical 告警未回應、QA 不通過或高風險未核准",
    badgeClass: "bg-gov-redbg text-gov-red border border-danger-border",
    dotClass: "bg-gov-red",
  },
  Yellow: {
    label: "待處理",
    desc: "有待辦事項、接近期限，或必要欄位尚未完成但未逾期",
    badgeClass: "bg-gov-yellowbg text-gov-yellow border border-warning-border",
    dotClass: "bg-gov-yellow",
  },
  Blue: {
    label: "等待確認",
    desc: "等待 QA、OP、資安推動小組、系統負責人或 DMS 主管確認",
    badgeClass: "bg-gov-bluebg text-gov-blue border border-info-border",
    dotClass: "bg-gov-blue",
  },
  Green: {
    label: "正常",
    desc: "流程正常，無逾期、無重大缺漏",
    badgeClass: "bg-gov-greenbg text-gov-green border border-success-border",
    dotClass: "bg-gov-green",
  },
  Gray: {
    label: "已結案",
    desc: "已結案或不適用",
    badgeClass: "bg-gov-graybg text-gov-gray border border-secondary-border",
    dotClass: "bg-gov-gray",
  },
};

export const EVIDENCE_TYPES = [
  "Jira 連結",
  "GitLab PR / MR",
  "Log",
  "監控截圖",
  "Email",
  "MS Teams 紀錄",
  "文件",
  "其他",
];

export const ENVIRONMENTS = ["Production", "Staging", "UAT", "Dev"];
export const RISK_LEVELS = ["高", "中", "低"];
export const PRIORITIES = ["P1", "P2", "P3", "P4"];
export const ALERT_LEVELS = ["Critical", "Warning", "Info"];

export const SYSTEM_NAME_EXAMPLES = [
  "MyDMS",
  "Jarvis AI",
  "Token Provider",
  "DMS 平台",
  "GitLab",
  "MariaDB",
  "Grafana",
];

export const ISSUE_TYPE_PREFIX: Record<string, string> = {
  Hotfix: "HOTFIX",
  Incident: "INC",
  RCA: "RCA",
  RiskException: "RISK",
  QaVerification: "QA",
  ChangeRelease: "CHG",
  MonitoringInventory: "MON",
  BackupRecoveryTest: "BAK",
};

// ---------------------------------------------------------------------------
// M1 新增：以 String 欄位模擬固定值域者（SQLite 不支援原生 enum），
// 集中於此提供 TypeScript 層的 literal union type 及驗證函式，避免值域散落各處。
// ---------------------------------------------------------------------------

export const TEAM_MEMBERSHIP_ROLES = ["MEMBER", "LEAD"] as const;
export type TeamMembershipRole = (typeof TEAM_MEMBERSHIP_ROLES)[number];
export function isTeamMembershipRole(value: string): value is TeamMembershipRole {
  return (TEAM_MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

export const SYSTEM_RESPONSIBILITY_TYPES = ["RD", "QA", "OP", "OTHER"] as const;
export type SystemResponsibilityType = (typeof SYSTEM_RESPONSIBILITY_TYPES)[number];
export function isSystemResponsibilityType(value: string): value is SystemResponsibilityType {
  return (SYSTEM_RESPONSIBILITY_TYPES as readonly string[]).includes(value);
}

export const CHANGE_SUB_TYPES = ["QUARTERLY_RELEASE", "GENERAL_CHANGE"] as const;
export type ChangeSubType = (typeof CHANGE_SUB_TYPES)[number];
export function isChangeSubType(value: string): value is ChangeSubType {
  return (CHANGE_SUB_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// M1.5-A 新增：核准治理層固定值域（SQLite 不支援原生 enum，沿用 M1 慣例）。
// ---------------------------------------------------------------------------

export const APPROVAL_TYPES = [
  "BUSINESS_APPROVAL",
  "RD_LEAD_APPROVAL",
  "QA_LEAD_APPROVAL",
  "DEPLOYMENT_APPROVAL",
  "RISK_EXCEPTION_APPROVAL",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export function isApprovalType(value: string): value is ApprovalType {
  return (APPROVAL_TYPES as readonly string[]).includes(value);
}

export const APPROVAL_DECISIONS = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export function isApprovalDecision(value: string): value is ApprovalDecision {
  return (APPROVAL_DECISIONS as readonly string[]).includes(value);
}

// recordStatus：與 decision 分離的獨立生命週期欄位。
// ACTIVE=目前有效版本；INVALIDATED=原 APPROVED 因內容變更而追溯失效（decision 維持 APPROVED）；
// SUPERSEDED=因重新送核而不再是目前版本（decision 維持原值，例如 REJECTED/CANCELLED）。
export const APPROVAL_RECORD_STATUSES = ["ACTIVE", "INVALIDATED", "SUPERSEDED"] as const;
export type ApprovalRecordStatus = (typeof APPROVAL_RECORD_STATUSES)[number];
export function isApprovalRecordStatus(value: string): value is ApprovalRecordStatus {
  return (APPROVAL_RECORD_STATUSES as readonly string[]).includes(value);
}

// 核准資格來源：DIRECT_SUPERVISOR=業務直屬主管本人核准；TEAM_LEAD=團隊主管本人核准；
// DELEGATE=有效代理人核准。ApprovalRecord 建立時先填「預期」來源，決策時更新為「實際」來源，
// 不得依目前組織設定事後反推。
export const APPROVAL_AUTHORITY_TYPES = ["DIRECT_SUPERVISOR", "TEAM_LEAD", "DELEGATE"] as const;
export type ApprovalAuthorityType = (typeof APPROVAL_AUTHORITY_TYPES)[number];
export function isApprovalAuthorityType(value: string): value is ApprovalAuthorityType {
  return (APPROVAL_AUTHORITY_TYPES as readonly string[]).includes(value);
}

// StageRiskCheck.answer：資料庫欄位為 nullable String，null 代表「尚未填答」（非可選答案）。
// 此處固定值域僅涵蓋「已填答」的三種明確答案；null 由呼叫端另行判斷，不納入型別守衛值域。
export const RISK_CHECK_ANSWERS = ["YES", "NO", "UNKNOWN"] as const;
export type RiskCheckAnswer = (typeof RISK_CHECK_ANSWERS)[number];
export function isRiskCheckAnswer(value: string): value is RiskCheckAnswer {
  return (RISK_CHECK_ANSWERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// M1.5-B 新增：核准治理健康檢查嚴重度徽章，仿 STATUS_LIGHT_META 寫法。
// 顏色僅作輔助，文字（label）必須一律同時顯示，不得只靠顏色判讀。
// ---------------------------------------------------------------------------

export type GovernanceHealthSeverity = "normal" | "warning" | "critical";

export const HEALTH_STATUS_META: Record<GovernanceHealthSeverity, { label: string; badgeClass: string; dotClass: string }> = {
  normal: {
    label: "正常",
    badgeClass: "bg-gov-greenbg text-gov-green border border-success-border",
    dotClass: "bg-gov-green",
  },
  warning: {
    label: "注意",
    badgeClass: "bg-gov-yellowbg text-gov-yellow border border-warning-border",
    dotClass: "bg-gov-yellow",
  },
  critical: {
    label: "異常",
    badgeClass: "bg-gov-redbg text-gov-red border border-danger-border",
    dotClass: "bg-gov-red",
  },
};
