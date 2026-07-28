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

export interface ExecutionFieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "datetime-local";
  required: boolean;
  options?: readonly string[];
}

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
  { key: "opDeployEnvironment", label: "上版環境", type: "text", required: true },
  { key: "opDeployPlannedAt", label: "預計上版時間", type: "datetime-local", required: true },
  { key: "opDeploySteps", label: "上版步驟摘要", type: "textarea", required: true },
  { key: "opRollbackPlan", label: "回復方案", type: "textarea", required: true },
  { key: "opMonitoringChecklist", label: "監控檢查項", type: "textarea", required: true },
];

// OP 主管核准通過後（opDeploying）記錄「正式的上版結果」——刻意不放在 stage7 opPreparing
// 頁（尚未上版就不該有結果），也不是主管簽核頁欄位（主管簽核只有同意／駁回），而是核准
// 通過、實際執行部署後才產生的資料，結案頁（stage9）唯讀顯示。
export const OP_RESULT_FIELDS: readonly ExecutionFieldDef[] = [
  { key: "opDeployResult", label: "上版結果", type: "select", required: true, options: ["成功", "失敗"] },
  { key: "opProdConfirmResult", label: "正式環境確認結果", type: "select", required: true, options: ["確認無誤", "仍有問題"] },
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
