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
