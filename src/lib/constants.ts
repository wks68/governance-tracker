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

// 建立工單頁欄位收斂：系統名稱不再是自由文字（原本是 datalist 建議值，使用者可自行輸入
// 任意字串），改為固定值域的下拉選單。這是全系統唯一一份系統名稱清單，建立頁、編輯頁、
// Preview fixture 與驗證腳本一律引用本常數，不得在各頁面各自硬編碼一份。
//
// 既有歷史工單的舊系統名稱（Token Provider／DMS 平台／GitLab／MariaDB／Grafana 等）不因
// 本次調整被批次覆寫或刪除——詳情頁與列表頁一律原樣顯示 Issue.systemName；只有「新建」與
// 「可編輯」表單受此值域限制，舊值不會出現在任何下拉選項中。
export const SYSTEM_NAME_OPTIONS = ["MyDMS", "Jarvis AI", "Community", "APP Center"] as const;

export type SystemName = (typeof SYSTEM_NAME_OPTIONS)[number];

export function isValidSystemName(value: string): value is SystemName {
  return (SYSTEM_NAME_OPTIONS as readonly string[]).includes(value);
}

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

// RD/QA/OP 接單流程新增：Team.domain 值域（見 prisma/schema.prisma Team model 註解）。
// 與 SYSTEM_RESPONSIBILITY_TYPES 刻意分開宣告——後者是「System＋Team 配對」的自動路由設定，
// 語意上不是 Team 本身的固定屬性；Team.domain 才是 Team 本身領域的正式判斷來源，兩者不得混用。
// Incident 事件通報流程新增：INCIDENT＝事件受理窗口／系統負責人團隊（承接與分級）、
// SECURITY＝資安推動小組（RCA 啟動判定與後續 RCA 完整性／驗證審查共用同一個團隊）。
// RCA 第二階段新增：MANAGEMENT_VP／MANAGEMENT_DIRECTOR——條件式管理階層確認（DMS 副部長／
// 部長）沿用同一套「團隊 LEAD 核准」機制建模，該團隊只有一位 LEAD＝實際擔任該管理職務的人，
// 不另外新增角色型核准解析路徑，降低對 approvalService 信任邊界核心的變動幅度。
// 純新增值域，不影響既有 RD/QA/OP/BUSINESS/OTHER 的既有判斷邏輯。
export const TEAM_DOMAINS = ["RD", "QA", "OP", "BUSINESS", "OTHER", "INCIDENT", "SECURITY", "MANAGEMENT_VP", "MANAGEMENT_DIRECTOR"] as const;
export type TeamDomain = (typeof TEAM_DOMAINS)[number];
export function isTeamDomain(value: string): value is TeamDomain {
  return (TEAM_DOMAINS as readonly string[]).includes(value);
}

export const CHANGE_SUB_TYPES = ["QUARTERLY_RELEASE", "GENERAL_CHANGE"] as const;
export type ChangeSubType = (typeof CHANGE_SUB_TYPES)[number];
export function isChangeSubType(value: string): value is ChangeSubType {
  return (CHANGE_SUB_TYPES as readonly string[]).includes(value);
}

// 治理紀錄關聯固定值域。資料庫因 SQLite connector 限制使用 String，所有寫入入口必須
// 先經此型別守衛，且服務層依 relationType 再驗證 source／target 的固定方向。
export const ISSUE_RELATION_TYPES = [
  "INCIDENT_TO_RCA",
  "INCIDENT_TO_HOTFIX",
  "RCA_TO_HOTFIX",
  "HOTFIX_TO_PROJECT",
] as const;
export type IssueRelationType = (typeof ISSUE_RELATION_TYPES)[number];
export function isIssueRelationType(value: string): value is IssueRelationType {
  return (ISSUE_RELATION_TYPES as readonly string[]).includes(value);
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
  // Incident 事件通報流程新增：事件受理窗口／系統負責人確認事件結案。走既有「Team Lead
  // 核准」模式（approverTeamId＝Issue.assignedTeamId，事件受理團隊全程未再變動）。
  "INCIDENT_CLOSURE_CONFIRMATION",
  // 第二階段新增：資安推動小組正式確認是否需要 RCA——改走正式 ApprovalRecord（approverTeamId
  // 固定解析為 domain=SECURITY 的團隊，不等於 Issue.assignedTeamId，見
  // src/lib/approvalService.ts 的 APPROVAL_TEAM_RESOLUTION 對照表），取代第一階段的
  // capability-gated 暫行實作。
  "INCIDENT_RCA_DECISION_CONFIRMATION",
  // RCA 正式 12 階段核准層，皆走既有「Team Lead 核准」引擎，差別只在核准責任團隊的解析方式
  // （見 APPROVAL_TEAM_RESOLUTION）：
  //   RCA_TECHNICAL_REVIEW：RCA 負責單位主管技術審查，approverTeamId＝RCA Issue 自己的
  //     assignedTeamId（沿用既有機制，非新增解析路徑）。
  //   RCA_SECURITY_INTEGRITY_REVIEW：資安推動小組完整性審查，固定解析 domain=SECURITY。
  //   RCA_VP_CONFIRMATION：DMS 副部長確認，固定解析 domain=MANAGEMENT_VP，僅高等級或符合
  //     條件時才會建立此關卡的 ApprovalRecord。
  //   RCA_DIRECTOR_APPROVAL：DMS 部長核准，固定解析 domain=MANAGEMENT_DIRECTOR。
  //   RCA_SECURITY_VERIFICATION_CONFIRMATION：資安推動小組驗證與佐證完整性確認，固定解析
  //     domain=SECURITY（與 RCA_SECURITY_INTEGRITY_REVIEW 為同一團隊、不同關卡各自獨立
  //     ApprovalRecord）。
  //   RCA_CLOSURE_CONFIRMATION：權責主管／系統負責人結案確認，approverTeamId＝RCA Issue
  //     自己的 assignedTeamId。
  "RCA_TECHNICAL_REVIEW",
  "RCA_SECURITY_INTEGRITY_REVIEW",
  "RCA_VP_CONFIRMATION",
  "RCA_DIRECTOR_APPROVAL",
  "RCA_SECURITY_VERIFICATION_CONFIRMATION",
  "RCA_CLOSURE_CONFIRMATION",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export function isApprovalType(value: string): value is ApprovalType {
  return (APPROVAL_TYPES as readonly string[]).includes(value);
}

// RCA 第二階段新增：矯正／預防措施值域（見 prisma/schema.prisma RcaActionItem 註解）。
export const RCA_ACTION_ITEM_TYPES = ["CORRECTIVE", "PREVENTIVE"] as const;
export type RcaActionItemType = (typeof RCA_ACTION_ITEM_TYPES)[number];
export function isRcaActionItemType(value: string): value is RcaActionItemType {
  return (RCA_ACTION_ITEM_TYPES as readonly string[]).includes(value);
}

export const RCA_ACTION_ITEM_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "EXTENDED", "RISK_EXCEPTION"] as const;
export type RcaActionItemStatus = (typeof RCA_ACTION_ITEM_STATUSES)[number];
export function isRcaActionItemStatus(value: string): value is RcaActionItemStatus {
  return (RCA_ACTION_ITEM_STATUSES as readonly string[]).includes(value);
}

export const RCA_VERIFICATION_STATUSES = ["PENDING", "PASSED", "FAILED", "NOT_APPLICABLE"] as const;
export type RcaVerificationStatus = (typeof RCA_VERIFICATION_STATUSES)[number];
export function isRcaVerificationStatus(value: string): value is RcaVerificationStatus {
  return (RCA_VERIFICATION_STATUSES as readonly string[]).includes(value);
}

// RCA 根因分析：原因類型／分析方式固定值域（見任務規格第十四節）。
export const RCA_CAUSE_TYPES = [
  "需求／設計不足",
  "程式缺陷",
  "測試覆蓋不足",
  "變更／上線問題",
  "環境／設定問題",
  "權限／資料處理問題",
  "API／介接問題",
  "監控／維運不足",
  "流程／文件不足",
  "人為操作錯誤",
  "其他",
] as const;
export type RcaCauseType = (typeof RCA_CAUSE_TYPES)[number];

export const RCA_ANALYSIS_METHODS = ["Log／監控分析", "會議檢討", "程式碼分析", "設定比對", "測試重現", "其他"] as const;

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
