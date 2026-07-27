// 治理儀表板 MVP 新增：共用型別定義。
//
// 本模組（src/lib/governance-dashboard/*）只讀取既有 M2-A／M2-B／M1.5-A 執行引擎與
// 核准治理層資料（Issue.workflowVersionId／currentWorkflowStageId／WorkflowStage／
// IssueWorkflowStageHistory／ApprovalRecord／StageRiskCheck／Issue.assignedTeamId），
// 不建立任何新資料表、不寫入資料，一律唯讀。
//
// 「新版 Workflow 案件」＝ Issue.workflowVersionId 不為 null（沿用 src/lib/workflow/
// compatibility.ts 的 isIssueOnVersionedWorkflow 判斷）；否則視為「舊制案件」，獨立統計，
// 不得混入 Stage 分布或假裝已有 Workflow runtime。

export type GovernanceLifecycleStatus =
  | "LEGACY" // 舊制案件：workflowVersionId 為 null
  | "NOT_STARTED" // 新版 Workflow 案件但尚未有 currentWorkflowStageId（理論上不應出現，防禦性保留）
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

// YES／UNKNOWN／UNANSWERED 對應 StageRiskCheck.answer 的 YES／UNKNOWN／null（已建立但尚未填答）；
// NONE 代表這筆 Issue 完全沒有 StageRiskCheck 紀錄（尚無風險紀錄，見 Plan 第七節空狀態要求）。
export type GovernanceRiskStatus = "YES" | "UNKNOWN" | "UNANSWERED" | "NONE";

export interface GovernanceStageRef {
  id: string;
  stageKey: string;
  label: string;
  stageType: string;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
}

export interface GovernanceReturnEvent {
  toStageId: string;
  toStageLabel: string;
  fromStageId: string | null;
  fromStageLabel: string | null;
  executedAt: Date;
}

export interface GovernanceWorkflowDefinitionRef {
  id: string;
  key: string;
  name: string;
  issueType: string;
}

// 服務層唯讀查詢結果的正規化列（供 metrics.ts／filters.ts 共用），所有欄位皆由正式來源
// 現場推導，不讀取 workflowStatus、不使用 summary 字串判斷流程。
export interface GovernanceIssueRow {
  id: string;
  issueKey: string;
  title: string;
  issueType: string;
  createdAt: Date;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  workflowDefinition: GovernanceWorkflowDefinitionRef | null;
  lifecycleStatus: GovernanceLifecycleStatus;
  currentStage: GovernanceStageRef | null;
  // 目前關卡停留天數：只有 lifecycleStatus === "IN_PROGRESS" 且能由
  // IssueWorkflowStageHistory 找到目前開放列（exitedAt === null）時才有值；
  // 其餘（含舊制案件）一律 null，不得以 Issue.stageEnteredAt 等相容欄位替代推算。
  dwellDays: number | null;
  returnEvents: GovernanceReturnEvent[];
  returnCount: number;
  pendingApproval: boolean;
  riskStatus: GovernanceRiskStatus;
}

export const STALE_DAYS_OPTIONS = [1, 3, 7, 14] as const;
export type StaleDaysOption = (typeof STALE_DAYS_OPTIONS)[number];
export function isStaleDaysOption(value: number): value is StaleDaysOption {
  return (STALE_DAYS_OPTIONS as readonly number[]).includes(value);
}

export const DEFAULT_STALE_DAYS_THRESHOLD: StaleDaysOption = 7;

export type GovernanceRiskFilter = Exclude<GovernanceRiskStatus, "NONE">;
export function isGovernanceRiskFilter(value: string): value is GovernanceRiskFilter {
  return value === "YES" || value === "UNKNOWN" || value === "UNANSWERED";
}

export type GovernanceLifecycleFilter = "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export function isGovernanceLifecycleFilter(value: string): value is GovernanceLifecycleFilter {
  return value === "IN_PROGRESS" || value === "COMPLETED" || value === "CANCELLED";
}

// 篩選條件：一律由 URL search params 解析（見 filters.ts），輸入不合法時使用安全預設，
// 不得直接拼 SQL——本模組全程使用 Prisma／記憶體陣列運算，完全不接觸原始 SQL 字串。
export interface GovernanceDashboardFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  workflowDefinitionId: string | null;
  issueType: string | null;
  // 目前階段篩選：可為單一關卡（點擊「各關卡明細」單一列）或多個關卡（點擊「流程卡點」
  // 巨集階段——例如「OP 上版」底下實際對應好幾個真實 WorkflowStage）。空陣列＝不篩選。
  stageIds: string[];
  teamId: string | null;
  riskStatus: GovernanceRiskFilter | null;
  lifecycleStatus: GovernanceLifecycleFilter | null;
  staleDaysThreshold: StaleDaysOption | null;
  // 下鑽專用旗標：由 KPI／RETURN 監控卡片點擊產生，同樣是 URL search params 的一部分。
  pendingApprovalOnly: boolean;
  returnOnly: boolean;
  repeatedReturnOnly: boolean;
}

export interface GovernanceKpiSummary {
  inProgress: number;
  completed: number;
  cancelled: number;
  pendingApproval: number;
  highRisk: number;
  stale: number;
  staleDaysThreshold: StaleDaysOption;
  totalVisible: number;
}

export interface GovernanceStageDistributionEntry {
  stage: GovernanceStageRef;
  count: number;
}

export interface GovernanceRiskOverview {
  yes: number;
  unknown: number;
  unanswered: number;
  noRecord: number;
}

export interface GovernanceBottleneckEntry {
  issue: GovernanceIssueRow;
}

export interface GovernanceBottleneckSummary {
  thresholdCounts: Record<StaleDaysOption, number>;
  longestDwelling: GovernanceIssueRow[];
}

export interface GovernanceReturnStageAggregate {
  stageId: string;
  stageLabel: string;
  count: number;
}

export interface GovernanceReturnOverview {
  issuesWithReturn: number;
  totalReturns: number;
  repeatedReturnIssues: number;
  topReturnStages: GovernanceReturnStageAggregate[];
}

export interface GovernanceTeamWorkloadEntry {
  teamId: string;
  teamName: string;
  inProgress: number;
  pendingApproval: number;
  stale: number;
  longestDwellDays: number | null;
}

export interface GovernanceFilterOptions {
  workflowDefinitions: GovernanceWorkflowDefinitionRef[];
  issueTypes: string[];
  stages: GovernanceStageRef[];
  teams: { id: string; name: string }[];
}

// 今日治理總覽：首頁最上方最多 6 張主要 KPI（管理者語意，非技術語意）。
export interface GovernanceTodayOverview {
  hotfixInProgress: number;
  pendingApproval: number;
  pendingQaVerification: number;
  pendingOpDeployment: number;
  riskOrException: number;
  stale: number;
  staleDaysThreshold: StaleDaysOption;
}

// 流程卡點：依 stagePhase.ts 的巨集階段分組，取代直接顯示 StageType／WorkflowStage key。
export interface GovernancePhaseDistributionEntry {
  phase: string;
  count: number;
  // 該巨集階段目前實際涵蓋的真實 WorkflowStage id（供下鑽篩選使用，見
  // GovernanceDashboardFilters.stageIds）。
  stageIds: string[];
}

export interface GovernanceDashboardViewModel {
  filters: GovernanceDashboardFilters;
  filterOptions: GovernanceFilterOptions;
  kpi: GovernanceKpiSummary;
  todayOverview: GovernanceTodayOverview;
  stageDistribution: GovernanceStageDistributionEntry[];
  phaseDistribution: GovernancePhaseDistributionEntry[];
  riskOverview: GovernanceRiskOverview;
  bottleneck: GovernanceBottleneckSummary;
  returnOverview: GovernanceReturnOverview;
  teamWorkload: GovernanceTeamWorkloadEntry[];
  actionNeeded: GovernanceIssueRow[];
  // 只涵蓋已啟動新版 Workflow 的案件（workflowVersionId 不為 null）；舊制案件完全不
  // 出現於治理儀表板的任何統計或清單，一律只能在 /issues 一般工單清單／明細頁查閱
  // （見 viewModel.ts 對 governedRows 的篩選）。
  issueList: GovernanceIssueRow[];
  hasAnyVisibleIssue: boolean;
}

export class GovernanceDashboardAccessDeniedError extends Error {
  constructor(message = "僅具備 issue.view 能力者可查看治理儀表板") {
    super(message);
    this.name = "GovernanceDashboardAccessDeniedError";
  }
}
