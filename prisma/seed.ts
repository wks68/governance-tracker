// Seed Data：建立預設使用者，以及涵蓋不同治理情境與五種狀態燈號的工單示範資料
import { PrismaClient } from "@prisma/client";
import { calculateStatusLight, suggestWaitingRole } from "../src/lib/statusLight";
import { evaluateGateRules } from "../src/lib/gateRules";
import { nextStatusOf, isClosed, getWorkflow, statusLabel } from "../src/lib/workflow";
import { generateAiSuggestion } from "../src/lib/mockAi";
import { issueTypeLabel } from "../src/lib/constants";
import { synchronizeIssueKeySequencesFromExistingIssues } from "../src/lib/issue-key-sequence";

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY);
}

interface SeedField {
  key: string;
  label: string;
  value: string;
}

interface SeedEvidence {
  type: string;
  title: string;
  url: string;
  description?: string;
}

interface SeedComment {
  authorRole: string;
  authorName: string;
  body: string;
}

interface SeedIssue {
  issueType: string;
  title: string;
  description: string;
  systemName: string;
  environment: string;
  riskLevel: string;
  priority: string;
  ownerRole: string;
  ownerName: string;
  reporter: string;
  workflowStatus: string;
  dueDate: Date | null;
  needRca: boolean;
  needRiskException: boolean;
  impactProduction: boolean;
  alertLevel: string;
  firstResponseAt: Date | null;
  createdAtOffsetDays?: number;
  fields: SeedField[];
  evidences: SeedEvidence[];
  comments: SeedComment[];
  genAiSuggestion?: "RcaDraft" | "NextStep" | "EvidenceGap" | "ImpactScope";
}

const seedIssues: SeedIssue[] = [
  // ------------------------- Hotfix (3) -------------------------
  {
    issueType: "Hotfix",
    title: "登入頁面驗證碼失效導致無法登入",
    description: "使用者反映登入頁面驗證碼圖片無法載入，導致大量使用者無法完成登入。",
    systemName: "MyDMS",
    environment: "Production",
    riskLevel: "中",
    priority: "P1",
    ownerRole: "OP",
    ownerName: "張志豪",
    reporter: "王小明",
    workflowStatus: "opDeploy",
    dueDate: daysFromNow(1),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "",
    firstResponseAt: new Date(),
    fields: [
      { key: "rdFixVersion", label: "修正版本 / Branch / Commit", value: "hotfix/captcha-cache" },
      { key: "rdManagerApproval", label: "主管核准結果", value: "已於 Comment 核准" },
      { key: "rdSelfTestItems", label: "自測項目", value: "1. 登入頁載入驗證碼\n2. 驗證碼逾時重新整理\n3. 輸入正確驗證碼登入" },
      { key: "rdSelfTestResult", label: "自測結果", value: "true" },
      { key: "rdTesterName", label: "RD", value: "陳大文" },
      { key: "qaTestItems", label: "測試項目", value: "登入流程複測、驗證碼逾時情境複測" },
      { key: "qaVerifyResult", label: "QA 驗證結果", value: "通過" },
      { key: "opPreApproval", label: "上線前核准結果", value: "已由單位主管於 Comment 核准" },
    ],
    evidences: [
      { type: "GitLab PR / MR", title: "修正驗證碼快取邏輯 PR", url: "https://gitlab.example.com/mydms/mydms/-/merge_requests/482", description: "已通過 Code Review" },
    ],
    comments: [{ authorRole: "OP", authorName: "張志豪", body: "已排定今日 20:00 進行上版，將於上版完成後回報結果。" }],
  },
  {
    issueType: "Hotfix",
    title: "AI 回覆內容出現亂碼",
    description: "Jarvis AI 部分對話回應出現亂碼字元，疑似編碼轉換錯誤。",
    systemName: "Jarvis AI",
    environment: "Production",
    riskLevel: "中",
    priority: "P2",
    ownerRole: "QA",
    ownerName: "林佳穎",
    reporter: "王小明",
    workflowStatus: "qaRelease",
    dueDate: daysFromNow(3),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "",
    firstResponseAt: new Date(),
    fields: [
      { key: "rdFixVersion", label: "修正版本 / Branch / Commit", value: "hotfix/encoding-utf8" },
      { key: "rdManagerApproval", label: "主管核准結果", value: "已於 Comment 核准" },
      { key: "rdSelfTestItems", label: "自測項目", value: "1. 中文對話輸出\n2. 多語系混合輸出" },
      { key: "rdSelfTestResult", label: "自測結果", value: "true" },
      { key: "rdTesterName", label: "RD", value: "陳大文" },
      { key: "qaTestItems", label: "測試項目", value: "多語系內容複測、歷史對話回放複測" },
      { key: "qaVerifyResult", label: "QA 驗證結果", value: "未通過" },
    ],
    evidences: [{ type: "監控截圖", title: "QA 複測失敗截圖", url: "https://drive.example.com/qa-retest-482", description: "仍有少量亂碼字元出現" }],
    comments: [{ authorRole: "QA", authorName: "林佳穎", body: "複測仍發現亂碼，退回 RD 重新確認編碼轉換邏輯。" }],
  },
  {
    issueType: "Hotfix",
    title: "Token 簽發偶發逾時待自測結果確認",
    description: "Token Provider 偶發簽發逾時，已完成初步修正，待補充自測結果。",
    systemName: "Token Provider",
    environment: "Staging",
    riskLevel: "低",
    priority: "P3",
    ownerRole: "RD",
    ownerName: "陳大文",
    reporter: "陳大文",
    workflowStatus: "rdSelfTest",
    dueDate: daysFromNow(5),
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "",
    firstResponseAt: null,
    fields: [
      { key: "rdFixVersion", label: "修正版本 / Branch / Commit", value: "hotfix/token-pool-size" },
      { key: "rdManagerApproval", label: "主管核准結果", value: "已於 Comment 核准" },
      { key: "rdSelfTestItems", label: "自測項目", value: "1. 批次簽發壓力測試\n2. 連線池滿載情境測試" },
      // 自測結果、RD 尚未填寫：demo 呈現「RD自測」關卡待補齊必填欄位的情境
    ],
    evidences: [],
    comments: [],
  },

  // ------------------------- Incident (3) -------------------------
  {
    issueType: "Incident",
    title: "核心交易 API 大量 502 錯誤",
    description: "DMS 平台核心交易 API 於尖峰時段出現大量 502 Bad Gateway 錯誤。",
    systemName: "DMS 平台",
    environment: "Production",
    riskLevel: "高",
    priority: "P1",
    ownerRole: "RD",
    ownerName: "陳大文",
    reporter: "資安推動小組",
    workflowStatus: "initialResponse",
    dueDate: daysFromNow(0),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "Critical",
    firstResponseAt: new Date(),
    fields: [{ key: "incidentLevel", label: "事件等級", value: "高" }],
    evidences: [{ type: "Log", title: "API Gateway 錯誤日誌", url: "https://grafana.example.com/logs/gateway-502", description: "502 錯誤集中於 14:00-14:20" }],
    comments: [{ authorRole: "RD", authorName: "陳大文", body: "初步判斷為下游服務連線池耗盡，已緊急擴充連線數。" }],
    genAiSuggestion: "RcaDraft",
  },
  {
    issueType: "Incident",
    title: "監控儀表板資料延遲",
    description: "Grafana 監控儀表板資料更新延遲約 15 分鐘，尚未確認是否影響告警即時性。",
    systemName: "Grafana",
    environment: "Production",
    riskLevel: "中",
    priority: "P2",
    ownerRole: "RD",
    ownerName: "陳大文",
    reporter: "張志豪",
    workflowStatus: "initialImpact",
    dueDate: daysFromNow(2),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "Warning",
    firstResponseAt: new Date(),
    fields: [],
    evidences: [],
    comments: [],
  },
  {
    issueType: "Incident",
    title: "資料庫連線數異常已排除",
    description: "MariaDB 連線數一度接近上限，已重啟服務並確認恢復正常。",
    systemName: "MariaDB",
    environment: "Production",
    riskLevel: "低",
    priority: "P3",
    ownerRole: "OP",
    ownerName: "張志豪",
    reporter: "張志豪",
    workflowStatus: "closed",
    dueDate: daysFromNow(-3),
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "",
    firstResponseAt: new Date(),
    fields: [
      { key: "incidentLevel", label: "事件等級", value: "低" },
      { key: "initialResponseResult", label: "初步處置結果", value: "已重啟資料庫服務並確認連線數恢復正常水位" },
    ],
    evidences: [{ type: "監控截圖", title: "連線數恢復正常截圖", url: "https://grafana.example.com/dashboards/mariadb-conn", description: "重啟後連線數回落至正常區間" }],
    comments: [{ authorRole: "OP", authorName: "張志豪", body: "已確認連線數恢復正常，結案。" }],
  },

  // ------------------------- RCA (2) -------------------------
  {
    issueType: "RCA",
    title: "登入逾時根因分析",
    description: "針對近期多次登入逾時事件進行根因分析。",
    systemName: "MyDMS",
    environment: "Production",
    riskLevel: "中",
    priority: "P2",
    ownerRole: "RD",
    ownerName: "陳大文",
    reporter: "王小明",
    workflowStatus: "analyzing",
    dueDate: daysFromNow(4),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "",
    firstResponseAt: null,
    fields: [],
    evidences: [],
    comments: [],
  },
  {
    issueType: "RCA",
    title: "CI Pipeline 失敗根因分析",
    description: "GitLab CI Pipeline 連續失敗，已完成根因分析與矯正 / 預防措施。",
    systemName: "GitLab",
    environment: "Staging",
    riskLevel: "低",
    priority: "P3",
    ownerRole: "RD",
    ownerName: "陳大文",
    reporter: "陳大文",
    workflowStatus: "closed",
    dueDate: daysFromNow(-5),
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "",
    firstResponseAt: null,
    fields: [
      { key: "rootCauseAnalysis", label: "事件原因分析", value: "CI Runner 磁碟空間不足導致建置失敗" },
      { key: "correctiveAction", label: "矯正措施", value: "清理 Runner 暫存空間並重新執行 Pipeline" },
      { key: "preventiveAction", label: "預防措施", value: "新增磁碟空間監控告警，並定期自動清理暫存檔" },
      { key: "verificationResult", label: "驗證結果", value: "後續一週 Pipeline 皆正常執行，驗證通過" },
    ],
    evidences: [{ type: "Jira 連結", title: "CI Pipeline 修復追蹤單", url: "https://jira.example.com/browse/DMS-2201" }],
    comments: [],
  },

  // ------------------------- Risk Exception (2) -------------------------
  {
    issueType: "RiskException",
    title: "第三方 SDK 暫時使用過期憑證風險例外申請",
    description: "第三方金流 SDK 憑證更新作業延後，申請短期風險例外以維持服務運作。",
    systemName: "Token Provider",
    environment: "Production",
    riskLevel: "高",
    priority: "P1",
    ownerRole: "資安推動小組",
    ownerName: "資安推動小組",
    reporter: "陳大文",
    workflowStatus: "pendingApproval",
    dueDate: daysFromNow(2),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "",
    firstResponseAt: null,
    fields: [
      { key: "exceptionReason", label: "例外原因", value: "供應商憑證更新作業延遲，短期內無法完成更換" },
      { key: "riskDescription", label: "風險說明", value: "過期憑證可能導致連線中斷或安全性風險提升" },
      { key: "tempMitigation", label: "暫時風險降低措施", value: "加強連線監控，並限制僅允許既有簽章白名單通過" },
      { key: "followUpPlan", label: "後續處理計畫", value: "兩週內完成憑證更新並關閉本例外" },
    ],
    evidences: [{ type: "Email", title: "供應商延遲通知信", url: "https://mail.example.com/msg/vendor-delay-0912" }],
    comments: [],
  },
  {
    issueType: "RiskException",
    title: "舊版 TLS 協定暫時保留風險例外",
    description: "部分舊版客戶端仍需 TLS 1.1 支援，申請風險例外並持續追蹤汰換進度。",
    systemName: "DMS 平台",
    environment: "Production",
    riskLevel: "中",
    priority: "P2",
    ownerRole: "資安推動小組",
    ownerName: "資安推動小組",
    reporter: "資安推動小組",
    workflowStatus: "tracking",
    dueDate: daysFromNow(20),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "",
    firstResponseAt: null,
    fields: [
      { key: "exceptionReason", label: "例外原因", value: "少數合作夥伴系統尚未完成升級" },
      { key: "riskDescription", label: "風險說明", value: "TLS 1.1 存在已知安全性疑慮" },
      { key: "tempMitigation", label: "暫時風險降低措施", value: "限制僅白名單 IP 可使用舊版協定連線" },
      { key: "followUpPlan", label: "後續處理計畫", value: "每季追蹤合作夥伴升級進度，目標年底前全面關閉" },
      { key: "approverRole", label: "核准角色", value: "DMS主管" },
    ],
    evidences: [{ type: "文件", title: "風險例外核准紀錄", url: "https://drive.example.com/risk-exception-tls11" }],
    comments: [],
  },

  // ------------------------- QA Verification (2) -------------------------
  {
    issueType: "QaVerification",
    title: "v2.3 版本回歸測試",
    description: "v2.3 版本上線前進行完整回歸測試。",
    systemName: "Jarvis AI",
    environment: "Staging",
    riskLevel: "中",
    priority: "P2",
    ownerRole: "QA",
    ownerName: "林佳穎",
    reporter: "林佳穎",
    workflowStatus: "testing",
    dueDate: daysFromNow(3),
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "",
    firstResponseAt: null,
    fields: [],
    evidences: [],
    comments: [],
  },
  {
    issueType: "QaVerification",
    title: "登入模組驗證完成",
    description: "登入模組改版後完成完整驗證，結果通過。",
    systemName: "MyDMS",
    environment: "Staging",
    riskLevel: "低",
    priority: "P3",
    ownerRole: "QA",
    ownerName: "林佳穎",
    reporter: "林佳穎",
    workflowStatus: "closed",
    dueDate: daysFromNow(-2),
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "",
    firstResponseAt: null,
    fields: [
      { key: "testItems", label: "測試項目", value: "登入、登出、忘記密碼、多重登入裝置管理" },
      { key: "qaVerifyResult", label: "QA 驗證結果", value: "通過" },
    ],
    evidences: [{ type: "文件", title: "回歸測試報告", url: "https://drive.example.com/qa-report-login" }],
    comments: [],
  },

  // ------------------------- Change / Release (2) -------------------------
  {
    issueType: "ChangeRelease",
    title: "Q3 版本上線審核",
    description: "Q3 季度版本上線前之審核作業。",
    systemName: "DMS 平台",
    environment: "Production",
    riskLevel: "中",
    priority: "P2",
    ownerRole: "PM",
    ownerName: "王小明",
    reporter: "王小明",
    workflowStatus: "releaseReview",
    dueDate: daysFromNow(6),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "",
    firstResponseAt: null,
    fields: [],
    evidences: [],
    comments: [],
  },
  {
    issueType: "ChangeRelease",
    title: "CI/CD 流程優化上線",
    description: "CI/CD 建置流程優化，已完成上線並確認正式環境運作正常。",
    systemName: "GitLab",
    environment: "Production",
    riskLevel: "低",
    priority: "P3",
    ownerRole: "OP",
    ownerName: "張志豪",
    reporter: "陳大文",
    workflowStatus: "closed",
    dueDate: daysFromNow(-7),
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "",
    firstResponseAt: null,
    fields: [
      { key: "releaseVersion", label: "上線版本", value: "v1.8.0" },
      { key: "rollbackPlan", label: "回復計畫", value: "保留前一版本 CI 設定檔，可於 10 分鐘內回復" },
      { key: "prodConfirmResult", label: "正式環境確認結果", value: "上線後建置時間縮短 30%，運作正常" },
    ],
    evidences: [{ type: "GitLab PR / MR", title: "CI/CD 優化上線 PR", url: "https://gitlab.example.com/dms/infra/-/merge_requests/108" }],
    comments: [],
  },

  // ------------------------- Monitoring Inventory (3) -------------------------
  {
    issueType: "MonitoringInventory",
    title: "API Gateway 錯誤率監控",
    description: "API Gateway 5xx 錯誤率監控項目，近期 Critical 告警尚未獲得回應。",
    systemName: "Grafana",
    environment: "Production",
    riskLevel: "高",
    priority: "P1",
    ownerRole: "OP",
    ownerName: "張志豪",
    reporter: "資安推動小組",
    workflowStatus: "active",
    dueDate: null,
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "Critical",
    firstResponseAt: null,
    fields: [
      { key: "hostServiceComponent", label: "主機 / 服務 / 元件名稱", value: "api-gateway-prod-01" },
      { key: "monitoringItem", label: "監控項目", value: "5xx 錯誤率" },
      { key: "alertCondition", label: "告警條件", value: "5 分鐘內 5xx 錯誤率 > 5%" },
      { key: "notifyMethod", label: "通知方式", value: "Email、MS Teams" },
      { key: "notifyTarget", label: "通知對象", value: "OP 值班群組" },
      { key: "logLocation", label: "日誌位置", value: "/var/log/api-gateway/" },
      { key: "logRetentionDays", label: "日誌留存天數", value: "90" },
    ],
    evidences: [],
    comments: [{ authorRole: "資安推動小組", authorName: "資安推動小組", body: "Critical 告警已超過 30 分鐘未見回應，請 OP 儘速確認並處理。" }],
  },
  {
    issueType: "MonitoringInventory",
    title: "資料庫查詢效能監控",
    description: "MariaDB 慢查詢監控項目，目前日誌留存天數低於建議值。",
    systemName: "MariaDB",
    environment: "Production",
    riskLevel: "中",
    priority: "P2",
    ownerRole: "OP",
    ownerName: "張志豪",
    reporter: "張志豪",
    workflowStatus: "active",
    dueDate: null,
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "Warning",
    firstResponseAt: new Date(),
    fields: [
      { key: "hostServiceComponent", label: "主機 / 服務 / 元件名稱", value: "mariadb-prod-cluster" },
      { key: "monitoringItem", label: "監控項目", value: "慢查詢數量" },
      { key: "alertCondition", label: "告警條件", value: "每分鐘慢查詢數 > 20" },
      { key: "notifyMethod", label: "通知方式", value: "Email" },
      { key: "notifyTarget", label: "通知對象", value: "DBA 群組" },
      { key: "logLocation", label: "日誌位置", value: "/var/log/mysql/slow.log" },
      { key: "logRetentionDays", label: "日誌留存天數", value: "14" },
    ],
    evidences: [],
    comments: [],
  },
  {
    issueType: "MonitoringInventory",
    title: "新服務監控項目盤點中",
    description: "訂單服務尚在監控項目盤點階段，相關欄位尚未填寫完整。",
    systemName: "MyDMS",
    environment: "Production",
    riskLevel: "低",
    priority: "P3",
    ownerRole: "OP",
    ownerName: "張志豪",
    reporter: "王小明",
    workflowStatus: "draft",
    dueDate: daysFromNow(7),
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "",
    firstResponseAt: null,
    fields: [{ key: "hostServiceComponent", label: "主機 / 服務 / 元件名稱", value: "order-service-prod" }],
    evidences: [],
    comments: [],
  },

  // ------------------------- Backup / Recovery Test (2) -------------------------
  {
    issueType: "BackupRecoveryTest",
    title: "每週例行備份驗證",
    description: "每週例行資料庫備份驗證作業，本次備份結果失敗。",
    systemName: "MariaDB",
    environment: "Production",
    riskLevel: "高",
    priority: "P1",
    ownerRole: "OP",
    ownerName: "張志豪",
    reporter: "張志豪",
    workflowStatus: "backupConfirming",
    dueDate: daysFromNow(1),
    needRca: false,
    needRiskException: false,
    impactProduction: true,
    alertLevel: "",
    firstResponseAt: null,
    fields: [{ key: "backupResult", label: "備份結果", value: "失敗" }],
    evidences: [{ type: "Log", title: "備份失敗錯誤日誌", url: "https://grafana.example.com/logs/backup-fail-0912" }],
    comments: [{ authorRole: "OP", authorName: "張志豪", body: "備份工作因磁碟空間不足而失敗，正在清理空間並重新排程。" }],
    genAiSuggestion: "NextStep",
  },
  {
    issueType: "BackupRecoveryTest",
    title: "季度復原演練",
    description: "季度性資料庫復原演練，備份與復原結果皆成功。",
    systemName: "DMS 平台",
    environment: "Production",
    riskLevel: "中",
    priority: "P2",
    ownerRole: "OP",
    ownerName: "張志豪",
    reporter: "張志豪",
    workflowStatus: "closed",
    dueDate: daysFromNow(-10),
    needRca: false,
    needRiskException: false,
    impactProduction: false,
    alertLevel: "",
    firstResponseAt: null,
    fields: [
      { key: "backupResult", label: "備份結果", value: "成功" },
      { key: "recoveryResult", label: "復原結果", value: "成功" },
    ],
    evidences: [{ type: "文件", title: "季度復原演練報告", url: "https://drive.example.com/dr-drill-report-q3" }],
    comments: [{ authorRole: "OP", authorName: "張志豪", body: "復原演練順利完成，資料完整性驗證通過。" }],
  },
];

const ISSUE_TYPE_PREFIX: Record<string, string> = {
  Hotfix: "HOTFIX",
  Incident: "INC",
  RCA: "RCA",
  RiskException: "RISK",
  QaVerification: "QA",
  ChangeRelease: "CHG",
  MonitoringInventory: "MON",
  BackupRecoveryTest: "BAK",
};

interface SeedUser {
  name: string;
  email: string;
  department: string;
  role: string;
}

// 預設使用者：涵蓋所有角色，供工單負責人 / 建立人選擇與 /admin/users 展示
const seedUsers: SeedUser[] = [
  { name: "王小明", email: "pm@example.com", department: "產品管理部", role: "PM" },
  { name: "陳大文", email: "rd@example.com", department: "研發部", role: "RD" },
  { name: "林佳穎", email: "qa@example.com", department: "品質保證部", role: "QA" },
  { name: "張志豪", email: "op@example.com", department: "維運部", role: "OP" },
  { name: "資安推動小組", email: "secteam@example.com", department: "資訊安全處", role: "資安推動小組" },
  { name: "李主管", email: "dms-lead@example.com", department: "資訊部", role: "DMS主管" },
  { name: "系統管理員", email: "admin@example.com", department: "資訊部", role: "Admin" },
];

// M1.5-C1-A 新增：建立 User 的同時同步建立對應 active UserRole 與 UserRoleHistory（SYSTEM_SEED／C1_SEED_INITIAL_ROLE）。
// 這是「全新建立」路徑（seed 全新執行時的正常路徑），與既有資料庫的回填（migration 內的 C1_ROLE_BACKFILL）
// 是兩條不同路徑，reasonCode 刻意不同，避免稽核時混淆「這是回填舊資料還是全新建立」。
async function createSeedUserWithRole(u: SeedUser) {
  const effectiveAt = new Date();
  const user = await prisma.user.create({
    data: { name: u.name, email: u.email, department: u.department, role: u.role, isActive: true },
  });
  const userRole = await prisma.userRole.create({
    data: { userId: user.id, role: u.role, isActive: true },
  });
  await prisma.userRoleHistory.create({
    data: {
      userRoleId: userRole.id,
      userId: user.id,
      role: u.role,
      eventType: "ASSIGNED",
      fromValue: null,
      toValue: u.role,
      actorUserId: null,
      eventSource: "SYSTEM_SEED",
      reasonCode: "C1_SEED_INITIAL_ROLE",
      effectiveAt,
    },
  });
  return user;
}

async function main() {
  console.log("清除既有資料...");
  await prisma.aiSuggestion.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.issueFieldValue.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.workflowStatus.deleteMany();
  await prisma.issueType.deleteMany();
  await prisma.userRoleHistory.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();

  console.log("建立使用者主檔...");
  const userByName = new Map<string, { id: string; role: string }>();
  for (const u of seedUsers) {
    const created = await createSeedUserWithRole(u);
    userByName.set(u.name, { id: created.id, role: created.role });
  }
  const adminUser = userByName.get("系統管理員")!;

  console.log("標記唯一有效 Admin 為 Break-glass...");
  const activeAdmins = await prisma.user.findMany({
    where: { isActive: true, userRoles: { some: { role: "Admin", isActive: true } } },
  });
  if (activeAdmins.length !== 1) {
    throw new Error(
      `C1 Break-glass 初始標記失敗：預期恰好 1 位有效 Admin（isActive=true 且擁有 active UserRole role="Admin"），實際偵測到 ${activeAdmins.length} 位，不得任意挑選，seed 中止。`,
    );
  }
  await prisma.user.update({
    where: { id: activeAdmins[0].id },
    data: { isBreakGlassAdmin: true },
  });

  console.log("建立工單類型主檔...");
  const { ISSUE_TYPES } = await import("../src/lib/constants");
  for (const t of ISSUE_TYPES) {
    await prisma.issueType.create({ data: { typeKey: t.key, label: t.label, description: t.shortLabel } });
  }

  console.log("建立流程狀態主檔...");
  for (const t of ISSUE_TYPES) {
    const steps = getWorkflow(t.key);
    for (let i = 0; i < steps.length; i++) {
      await prisma.workflowStatus.create({
        data: { issueType: t.key, stepOrder: i + 1, statusKey: steps[i].key, label: steps[i].label },
      });
    }
  }

  console.log("建立工單 Seed Data...");
  const typeCounter: Record<string, number> = {};

  for (const s of seedIssues) {
    typeCounter[s.issueType] = (typeCounter[s.issueType] ?? 0) + 1;
    const seq = String(typeCounter[s.issueType]).padStart(4, "0");
    const issueKey = `${ISSUE_TYPE_PREFIX[s.issueType]}-${seq}`;

    const ownerUser = userByName.get(s.ownerName);
    const reporterUser = userByName.get(s.reporter);

    const issue = await prisma.issue.create({
      data: {
        issueKey,
        issueType: s.issueType,
        title: s.title,
        description: s.description,
        systemName: s.systemName,
        environment: s.environment,
        riskLevel: s.riskLevel,
        priority: s.priority,
        ownerRole: s.ownerRole,
        ownerName: s.ownerName,
        ownerUserId: ownerUser?.id ?? null,
        reporter: s.reporter,
        reporterUserId: reporterUser?.id ?? null,
        workflowStatus: s.workflowStatus,
        statusLight: "Green",
        dueDate: s.dueDate,
        needRca: s.needRca,
        needRiskException: s.needRiskException,
        impactProduction: s.impactProduction,
        alertLevel: s.alertLevel,
        firstResponseAt: s.firstResponseAt,
      },
    });

    for (const f of s.fields) {
      await prisma.issueFieldValue.create({
        data: { issueId: issue.id, fieldKey: f.key, fieldLabel: f.label, fieldValue: f.value },
      });
    }
    for (const e of s.evidences) {
      await prisma.evidence.create({
        data: { issueId: issue.id, type: e.type, title: e.title, url: e.url, description: e.description ?? "" },
      });
    }
    for (const c of s.comments) {
      await prisma.comment.create({
        data: { issueId: issue.id, authorRole: c.authorRole, authorName: c.authorName, body: c.body },
      });
    }

    await prisma.auditLog.create({
      data: {
        entityType: "Issue",
        entityId: issue.id,
        actionType: "IssueCreated",
        summary: `建立工單「${issue.title}」，初始關卡：${statusLabel(s.issueType, s.workflowStatus)}（Seed Data）`,
        actorUserId: adminUser.id,
      },
    });

    // 計算並寫入衍生欄位（狀態燈號、等待角色、佐證狀態、卡關原因、下一步建議）
    const fieldsMap: Record<string, string> = {};
    for (const f of s.fields) fieldsMap[f.key] = f.value;
    fieldsMap["__impactProduction"] = s.impactProduction ? "true" : "false";

    const nextStatus = nextStatusOf(s.issueType, s.workflowStatus) ?? s.workflowStatus;
    const gate = evaluateGateRules({
      issueType: s.issueType,
      riskLevel: s.riskLevel,
      currentStatus: s.workflowStatus,
      targetStatus: nextStatus,
      fields: fieldsMap,
      needRca: s.needRca,
      needRiskException: s.needRiskException,
      evidenceCount: s.evidences.length,
      hasClosingComment: s.comments.length > 0,
    });

    const waitingRole = isClosed(s.issueType, s.workflowStatus) ? "" : suggestWaitingRole(s.issueType, s.workflowStatus);

    const { light } = calculateStatusLight({
      issueType: s.issueType,
      riskLevel: s.riskLevel,
      workflowStatus: s.workflowStatus,
      dueDate: s.dueDate,
      waitingRole,
      needRca: s.needRca,
      needRiskException: s.needRiskException,
      alertLevel: s.alertLevel,
      firstResponseAt: s.firstResponseAt,
      fields: fieldsMap,
      evidenceCount: s.evidences.length,
      hasClosingComment: s.comments.length > 0,
    });

    let evidenceStatus = "齊備";
    if (s.evidences.length === 0) evidenceStatus = "缺漏";
    else if (gate.missingEvidence.length > 0) evidenceStatus = "部分缺漏";

    const blockReason = gate.blockReasons[0] ?? (gate.missingFields.length > 0 ? `尚缺欄位：${gate.missingFields.join("、")}` : "");

    await prisma.issue.update({
      where: { id: issue.id },
      data: { statusLight: light, waitingRole, evidenceStatus, blockReason, nextStep: gate.nextStep },
    });

    if (s.genAiSuggestion) {
      const output = generateAiSuggestion(s.genAiSuggestion, {
        issueKey: issue.issueKey,
        issueType: s.issueType,
        issueTypeLabel: issueTypeLabel(s.issueType),
        title: s.title,
        description: s.description,
        systemName: s.systemName,
        environment: s.environment,
        riskLevel: s.riskLevel,
        workflowStatus: statusLabel(s.issueType, s.workflowStatus),
        missingFields: gate.missingFields,
        missingEvidence: gate.missingEvidence,
        evidenceCount: s.evidences.length,
      });
      await prisma.aiSuggestion.create({
        data: { issueId: issue.id, suggestionType: s.genAiSuggestion, prompt: `type=${s.genAiSuggestion}`, output, accepted: false },
      });
      await prisma.auditLog.create({
        data: {
          entityType: "Issue",
          entityId: issue.id,
          actionType: "AiSuggestion",
          summary: `AI 輔助產生草稿：${s.genAiSuggestion}（Seed Data）`,
          actorUserId: adminUser.id,
        },
      });
    }

    console.log(`  已建立 ${issue.issueKey}（${light}）：${issue.title}`);
  }

  // 工單編號根因修正：以上 Issue 一律以固定 issueKey 直接寫入（不經過 allocateNextIssueKey），
  // Migration 套用當下（Fresh DB）Issue 表尚無資料，IssueKeySequence 只會是「已知歷史高水位」
  // 或 0，與這裡剛灌入的固定編號脫節。灌入完成後在此同步一次，把每個 issueType 的計數器補到
  // 「這批 seed 資料的最大編號」與「已知歷史高水位」兩者的較大值，之後第一次呼叫
  // createIssueForActor 才不會撞號。synchronizeIssueKeySequencesFromExistingIssues 只會把
  // lastValue 往上調，即使本函式重跑（seed 重跑）也不會把既有計數器歸零或往回調。
  console.log("同步工單編號計數器（IssueKeySequence）...");
  await synchronizeIssueKeySequencesFromExistingIssues(prisma);

  console.log("Seed Data 建立完成！");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
