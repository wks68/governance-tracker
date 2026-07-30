// Hotfix 九階段 UI：RD／QA／OP 執行頁（stage3／5／7）專屬欄位定義與白名單寫入服務。
//
// 本輪不得新增 Schema／Migration：一律沿用既有 IssueFieldValue（issueId+fieldKey 動態鍵值
// 表，見 prisma/schema.prisma）儲存，欄位鍵集合由本檔案硬編碼白名單管控（不是
// WorkflowStageRequirement 資料列），避免這個寫入入口被當成任意鍵值的後門——比照既有
// src/lib/workflow-execution/requirementService.ts submitStageFieldValue 同樣的「白名單、
// 現場重新授權」精神，額外收緊：必須是目前關卡本身的責任角色（RD/QA/OP 執行人）才能寫入，
// 不是只要有 issue.edit 能力即可。

import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { evaluateActorEligibilityForStage, assertActorIsCurrentExecutor } from "../workflowExecutionService";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionStateError, WorkflowExecutionValidationError } from "../workflow-execution/types";
import { ENVIRONMENTS } from "../constants";

export interface ExecutionFieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "datetime-local";
  required: boolean;
  options?: readonly string[];
}

export const OP_OPERATION_TYPE_OPTIONS = [
  "停止", "啟動", "重新啟動", "重新載入設定", "滾動重啟", "重新部署／替換", "切換節點",
  "主備切換", "暫停服務", "恢復服務", "重建服務／元件", "節點下線／上線", "擴容／縮容", "其他",
] as const;

export const OP_COMPONENT_TYPE_OPTIONS = [
  "Apache／Nginx／IIS", "Tomcat／JBoss／WebLogic", "Kubernetes Pod／Deployment／Service／Node",
  "Docker／Container", "應用程式服務", "API 服務", "背景服務", "批次／排程服務", "資料庫",
  "Redis／Cache", "Solr／Elasticsearch", "Message Queue", "Load Balancer", "Reverse Proxy",
  "API Gateway", "檔案／物件儲存", "監控服務／Agent", "DNS／網路／Firewall", "其他",
] as const;

export const OP_IMPACT_OPTIONS = [
  "無明顯影響", "需停機", "服務短暫中斷", "影響功能", "影響資料", "影響效能", "影響權限", "其他",
] as const;

export const OP_MONITORING_METHOD_OPTIONS = [
  "使用既有 Grafana 監控", "本次新增 Grafana 監控", "使用其他監控方式", "不適用",
] as const;

export const RD_FIX_FIELDS: readonly ExecutionFieldDef[] = [
  { key: "rdFixVersion", label: "修正版本／Branch／Commit", type: "text", required: true },
  { key: "rdFixDescription", label: "修正內容說明", type: "textarea", required: true },
  { key: "rdSelfTestResult", label: "自測結果", type: "textarea", required: true },
  { key: "rdImpactScope", label: "影響範圍確認（系統／模組／使用者影響與嚴重程度）", type: "textarea", required: true },
];

export const QA_VERIFY_FIELDS: readonly ExecutionFieldDef[] = [
  { key: "qaTestScope", label: "測試範圍", type: "textarea", required: true },
  { key: "qaTestEnvironment", label: "測試環境", type: "text", required: true },
  { key: "qaTestResult", label: "驗證結果", type: "select", required: true, options: ["驗證通過", "驗證不通過"] },
  { key: "qaDefectNotes", label: "缺陷觀察紀錄", type: "textarea", required: false },
  { key: "qaRecommendation", label: "QA 建議", type: "textarea", required: false },
];

export const OP_DEPLOY_FIELDS: readonly ExecutionFieldDef[] = [
  { key: "opDeployEnvironment", label: "部署環境", type: "select", required: true, options: ENVIRONMENTS },
  { key: "opDeployPlannedAt", label: "預計部署時間", type: "datetime-local", required: true },
  { key: "opImpactDurationMode", label: "預計影響時間", type: "select", required: true, options: ["無", "約"] },
  { key: "opImpactDurationMinutes", label: "預計影響分鐘數", type: "text", required: false },
  { key: "opAnnouncementRequired", label: "是否需公告", type: "select", required: true, options: ["否", "是"] },
  { key: "opAnnouncementAudience", label: "公告對象", type: "text", required: false },
  { key: "opAnnouncementPlannedAt", label: "預計公告時間", type: "datetime-local", required: false },
  { key: "opAnnouncementSummary", label: "公告內容摘要", type: "textarea", required: false },
  { key: "opServiceOperationRequired", label: "是否需操作服務／元件", type: "select", required: true, options: ["否", "是"] },
  { key: "opOperationTypes", label: "操作類型", type: "text", required: false },
  { key: "opOperationOther", label: "其他操作說明", type: "text", required: false },
  { key: "opComponentTypes", label: "服務／元件類型", type: "text", required: false },
  { key: "opComponentOther", label: "其他服務或元件說明", type: "text", required: false },
  { key: "opOperationTargets", label: "實際操作標的", type: "text", required: false },
  { key: "opOperationPlannedAt", label: "預計操作時間", type: "datetime-local", required: false },
  { key: "opOperationImpactMinutes", label: "操作造成的預計影響時間（分鐘）", type: "text", required: false },
  { key: "opOperationImpactScope", label: "操作影響範圍", type: "textarea", required: false },
  { key: "opExpectedImpacts", label: "預計影響", type: "text", required: true },
  { key: "opImpactOther", label: "其他影響說明", type: "text", required: false },
  { key: "opNoImpactJustification", label: "無明顯影響判定說明", type: "textarea", required: false },
  { key: "opDeploySteps", label: "上版步驟摘要", type: "textarea", required: true },
  { key: "opRollbackTrigger", label: "Rollback 觸發條件", type: "textarea", required: true },
  { key: "opRollbackPlan", label: "Rollback 方式", type: "textarea", required: true },
  { key: "opRollbackUnavailableMode", label: "無法立即 Rollback 時之處置", type: "select", required: true, options: ["不適用", "臨時處置說明"] },
  { key: "opRollbackUnavailableDetail", label: "臨時處置說明", type: "textarea", required: false },
  { key: "opMonitoringMethod", label: "監控方式", type: "select", required: true, options: OP_MONITORING_METHOD_OPTIONS },
  { key: "opMonitoringAccess", label: "監控連結或查詢方式", type: "text", required: false },
  { key: "opMonitoringPageConfirmed", label: "已確認監控頁面或查詢方式可正常使用", type: "select", required: false },
  { key: "opMonitoringMetricsConfirmed", label: "已確認部署後需觀察的服務／指標", type: "select", required: false },
  { key: "opMonitoringRecipientsConfirmed", label: "已確認異常告警或通知接收對象", type: "select", required: false },
  { key: "opMonitoringNotApplicableReason", label: "監控不適用原因", type: "textarea", required: false },
];

// OP 主管核准通過後（opDeploying）記錄「正式的上版結果」——刻意不放在 stage7 opPreparing
// 頁（尚未上版就不該有結果），也不是主管簽核頁欄位（主管簽核只有同意／駁回），而是核准
// 通過、實際執行部署後才產生的資料，結案頁（stage9）唯讀顯示。
export const OP_RESULT_FIELDS: readonly ExecutionFieldDef[] = [
  { key: "opActualStartedAt", label: "實際開始時間", type: "datetime-local", required: true },
  { key: "opActualCompletedAt", label: "實際完成時間", type: "datetime-local", required: true },
  { key: "opDeployResult", label: "部署結果", type: "select", required: true, options: ["完成", "未完成"] },
  { key: "opIncidentStatus", label: "異常與處置", type: "select", required: true, options: ["無", "有"] },
  { key: "opIncidentDetail", label: "異常與處置說明", type: "textarea", required: false },
  { key: "opRollbackActivated", label: "是否啟動 Rollback", type: "select", required: true, options: ["否", "是"] },
  { key: "opRollbackResult", label: "Rollback 結果", type: "textarea", required: false },
  { key: "opPostMonitoringResult", label: "部署後監控結果", type: "select", required: true, options: ["正常", "異常"] },
  { key: "opPostMonitoringDetail", label: "部署後監控異常說明", type: "textarea", required: false },
];

const FIELDS_BY_STAGE_KEY: Record<string, readonly ExecutionFieldDef[]> = {
  rdInProgress: RD_FIX_FIELDS,
  qaInProgress: QA_VERIFY_FIELDS,
  opPreparing: OP_DEPLOY_FIELDS,
  opDeploying: OP_RESULT_FIELDS,
};

export function executionFieldsForStageKey(stageKey: string): readonly ExecutionFieldDef[] {
  return FIELDS_BY_STAGE_KEY[stageKey] ?? [];
}

export async function loadExecutionFieldValues(issueId: string, stageKey: string): Promise<Record<string, string>> {
  const defs = executionFieldsForStageKey(stageKey);
  if (defs.length === 0) return {};
  const rows = await prisma.issueFieldValue.findMany({ where: { issueId, fieldKey: { in: defs.map((d) => d.key) } } });
  const map: Record<string, string> = {};
  for (const row of rows) map[row.fieldKey] = row.fieldValue;
  return map;
}

// 暫存：允許部分填寫，不檢查必填。送主管簽核前才檢查必填（見呼叫端 transition-actions.ts）。
export async function saveExecutionFieldValues(input: { issueId: string; actorId: string; values: Record<string, string> }): Promise<void> {
  const issue = await prisma.issue.findUnique({ where: { id: input.issueId } });
  if (!issue || issue.issueType !== "Hotfix" || !issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("此工單目前無法填寫關卡欄位");
  }
  const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: issue.currentWorkflowStageId } });
  const defs = executionFieldsForStageKey(stage.stageKey);
  if (defs.length === 0) {
    throw new WorkflowExecutionValidationError([`關卡「${stage.stageKey}」沒有可填寫的欄位`]);
  }

  const eligibility = await evaluateActorEligibilityForStage(
    prisma,
    input.actorId,
    { assignedTeamId: issue.assignedTeamId },
    { requiredExecutionRole: stage.requiredExecutionRole, requiredMembershipRole: stage.requiredMembershipRole, stageKey: stage.stageKey },
  );
  if (!eligibility.eligible) {
    throw new WorkflowExecutionAccessDeniedError(`不具備在關卡「${stage.stageKey}」填寫欄位的資格：${eligibility.reasons.join("; ")}`);
  }
  // RD/QA/OP 接單流程新增：團隊成員身分只是必要條件，真正的責任人是承接團隊 Lead 指派的
  // 執行人本人——其他團隊成員即使身分合格，仍不得填寫。
  await assertActorIsCurrentExecutor(prisma, input.issueId, input.actorId, stage.stageKey);

  const allowedKeys = new Set(defs.map((d) => d.key));
  const entries = Object.entries(input.values).filter(([k]) => allowedKeys.has(k));
  if (entries.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const [fieldKey, fieldValue] of entries) {
      const def = defs.find((d) => d.key === fieldKey)!;
      await tx.issueFieldValue.upsert({
        where: { issueId_fieldKey: { issueId: input.issueId, fieldKey } },
        create: { issueId: input.issueId, fieldKey, fieldLabel: def.label, fieldValue },
        update: { fieldValue },
      });
    }
  });

  await writeAuditLog({
    entityType: "Issue",
    entityId: input.issueId,
    actionType: "FieldChange",
    summary: `填寫「${stage.stageKey}」關卡欄位：${entries.map(([k]) => k).join("、")}`,
    actorUserId: input.actorId,
  });
}

// 送主管簽核前的必填檢查（不信任前端 required 屬性，伺服端重新檢查一次）。
export function missingRequiredFields(stageKey: string, values: Record<string, string>): ExecutionFieldDef[] {
  return executionFieldsForStageKey(stageKey).filter((d) => d.required && !values[d.key]?.trim());
}

export function parseMultiValue(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function isPositiveInteger(value: string | undefined): boolean {
  return !!value && /^[1-9]\d*$/.test(value);
}

function requireValue(values: Record<string, string>, key: string, label: string, issues: string[]) {
  if (!values[key]?.trim()) issues.push(`${label}為必填`);
}

export function validateExecutionSubmission(stageKey: string, values: Record<string, string>): string[] {
  const issues = missingRequiredFields(stageKey, values).map((field) => `${field.label}為必填`);
  if (stageKey === "opPreparing") {
    if (!(ENVIRONMENTS as readonly string[]).includes(values.opDeployEnvironment)) issues.push("部署環境不是允許的選項");
    if (!["無", "約"].includes(values.opImpactDurationMode)) issues.push("請選擇預計影響時間");
    if (!["否", "是"].includes(values.opAnnouncementRequired)) issues.push("請選擇是否需公告");
    if (!["否", "是"].includes(values.opServiceOperationRequired)) issues.push("請選擇是否需操作服務／元件");
    if (!["不適用", "臨時處置說明"].includes(values.opRollbackUnavailableMode)) issues.push("請選擇無法立即 Rollback 時之處置");
    if (!(OP_MONITORING_METHOD_OPTIONS as readonly string[]).includes(values.opMonitoringMethod)) issues.push("請選擇監控方式");
    if (Number.isNaN(new Date(values.opDeployPlannedAt ?? "").getTime())) issues.push("預計部署時間格式不正確");
    if (values.opImpactDurationMode === "約" && !isPositiveInteger(values.opImpactDurationMinutes)) {
      issues.push("預計影響分鐘數必須為正整數");
    }
    if (values.opAnnouncementRequired === "是") {
      requireValue(values, "opAnnouncementAudience", "公告對象", issues);
      requireValue(values, "opAnnouncementPlannedAt", "預計公告時間", issues);
      requireValue(values, "opAnnouncementSummary", "公告內容摘要", issues);
    }
    const operations = parseMultiValue(values.opOperationTypes);
    const components = parseMultiValue(values.opComponentTypes);
    if (values.opServiceOperationRequired === "是") {
      if (operations.length === 0) issues.push("操作類型至少選擇一項");
      if (components.length === 0) issues.push("服務／元件類型至少選擇一項");
      if (operations.some((item) => !(OP_OPERATION_TYPE_OPTIONS as readonly string[]).includes(item))) issues.push("操作類型包含不允許的選項");
      if (components.some((item) => !(OP_COMPONENT_TYPE_OPTIONS as readonly string[]).includes(item))) issues.push("服務／元件類型包含不允許的選項");
      if (operations.includes("其他")) requireValue(values, "opOperationOther", "其他操作說明", issues);
      if (components.includes("其他")) requireValue(values, "opComponentOther", "其他服務或元件說明", issues);
      requireValue(values, "opOperationTargets", "實際操作標的", issues);
      requireValue(values, "opOperationPlannedAt", "預計操作時間", issues);
      if (Number.isNaN(new Date(values.opOperationPlannedAt ?? "").getTime())) issues.push("預計操作時間格式不正確");
      if (!isPositiveInteger(values.opOperationImpactMinutes)) issues.push("操作造成的預計影響時間必須為正整數");
      requireValue(values, "opOperationImpactScope", "影響範圍", issues);
    }
    const impacts = parseMultiValue(values.opExpectedImpacts);
    if (impacts.length === 0) issues.push("預計影響至少選擇一項");
    if (impacts.some((item) => !(OP_IMPACT_OPTIONS as readonly string[]).includes(item))) issues.push("預計影響包含不允許的選項");
    if (impacts.includes("無明顯影響") && impacts.length > 1) issues.push("「無明顯影響」不得與其他影響同時選取");
    if (impacts.includes("其他")) requireValue(values, "opImpactOther", "其他影響說明", issues);
    if (values.opServiceOperationRequired === "是" && impacts.length === 1 && impacts[0] === "無明顯影響") {
      requireValue(values, "opNoImpactJustification", "無明顯影響判定說明", issues);
    }
    if (values.opRollbackUnavailableMode === "臨時處置說明") {
      requireValue(values, "opRollbackUnavailableDetail", "臨時處置說明", issues);
    }
    if (values.opMonitoringMethod === "不適用") {
      requireValue(values, "opMonitoringNotApplicableReason", "監控不適用原因", issues);
    } else if (values.opMonitoringMethod) {
      requireValue(values, "opMonitoringAccess", "監控連結或查詢方式", issues);
      if (values.opMonitoringPageConfirmed !== "true") issues.push("請確認監控頁面或查詢方式可正常使用");
      if (values.opMonitoringMetricsConfirmed !== "true") issues.push("請確認部署後需觀察的服務／指標");
      if (values.opMonitoringRecipientsConfirmed !== "true") issues.push("請確認異常告警或通知接收對象");
    }
  }
  if (stageKey === "opDeploying") {
    if (!["完成", "未完成"].includes(values.opDeployResult)) issues.push("請選擇部署結果");
    if (!["無", "有"].includes(values.opIncidentStatus)) issues.push("請選擇異常與處置");
    if (!["否", "是"].includes(values.opRollbackActivated)) issues.push("請選擇是否啟動 Rollback");
    if (!["正常", "異常"].includes(values.opPostMonitoringResult)) issues.push("請選擇部署後監控結果");
    const started = new Date(values.opActualStartedAt ?? "");
    const completed = new Date(values.opActualCompletedAt ?? "");
    if (Number.isNaN(started.getTime())) issues.push("實際開始時間格式不正確");
    if (Number.isNaN(completed.getTime())) issues.push("實際完成時間格式不正確");
    if (!Number.isNaN(started.getTime()) && !Number.isNaN(completed.getTime()) && completed < started) {
      issues.push("實際完成時間不得早於實際開始時間");
    }
    if (values.opDeployResult === "未完成") requireValue(values, "opIncidentDetail", "異常與處置說明", issues);
    if (values.opIncidentStatus === "有") requireValue(values, "opIncidentDetail", "異常與處置說明", issues);
    if (values.opRollbackActivated === "是") requireValue(values, "opRollbackResult", "Rollback 結果", issues);
    if (values.opPostMonitoringResult === "異常") requireValue(values, "opPostMonitoringDetail", "部署後監控異常說明", issues);
  }
  return [...new Set(issues)];
}

export function displayExecutionValue(value: string | undefined): string {
  if (!value) return "—";
  if (value === "true") return "已確認";
  const multi = parseMultiValue(value);
  return multi.length > 0 && value.trim().startsWith("[") ? multi.join("、") : value;
}
