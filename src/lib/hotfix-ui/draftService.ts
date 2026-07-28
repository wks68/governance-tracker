// Hotfix 九階段 UI：stage1「Hotfix建立工單」草稿編輯服務層。責任角色固定是原始填單人
// （reporterUserId），且僅能在 currentStage=draft 時編輯——工單本身已由既有
// createIssueAction／createIssueForActor 建立並自動啟動流程引擎，本檔案只負責「draft
// 階段內」的欄位編輯與必填檢查，不重建一套新的建立工單流程。

import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionStateError, WorkflowExecutionValidationError } from "../workflow-execution/types";
import { HOTFIX_PRIORITY_FIELD_KEY, HOTFIX_PRIORITIES } from "./priority";

export interface HotfixDraftFields {
  title: string;
  description: string;
  systemName: string;
  environment: string;
  riskLevel: string;
  dueDate: string; // yyyy-mm-dd or ""
  hotfixPriority: string;
}

const REQUIRED_KEYS: (keyof HotfixDraftFields)[] = ["title", "description", "systemName", "environment", "riskLevel", "dueDate", "hotfixPriority"];

export function missingDraftFields(fields: HotfixDraftFields): string[] {
  const labels: Record<keyof HotfixDraftFields, string> = {
    title: "標題",
    description: "問題現象",
    systemName: "系統名稱",
    environment: "環境",
    riskLevel: "風險等級",
    dueDate: "預計完成日",
    hotfixPriority: "Hotfix 工單優先級",
  };
  return REQUIRED_KEYS.filter((k) => !fields[k]?.trim()).map((k) => labels[k]);
}

async function requireDraftOwnership(issueId: string, actorId: string) {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || issue.issueType !== "Hotfix" || !issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("此工單目前無法編輯");
  }
  const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: issue.currentWorkflowStageId } });
  if (stage.stageKey !== "draft") {
    throw new WorkflowExecutionStateError("此工單已離開建立工單階段，無法再編輯此頁面");
  }
  if (issue.reporterUserId !== actorId) {
    throw new WorkflowExecutionAccessDeniedError("僅原始填單人可編輯此階段");
  }
  return issue;
}

export async function saveHotfixDraft(input: { issueId: string; actorId: string; fields: Partial<HotfixDraftFields> }): Promise<void> {
  const issue = await requireDraftOwnership(input.issueId, input.actorId);

  if (input.fields.hotfixPriority !== undefined && input.fields.hotfixPriority !== "" && !HOTFIX_PRIORITIES.some((p) => p.value === input.fields.hotfixPriority)) {
    throw new WorkflowExecutionValidationError(["hotfixPriority 不在合法值域"]);
  }

  await prisma.$transaction(async (tx) => {
    await tx.issue.update({
      where: { id: input.issueId },
      data: {
        ...(input.fields.title !== undefined ? { title: input.fields.title } : {}),
        ...(input.fields.description !== undefined ? { description: input.fields.description } : {}),
        ...(input.fields.systemName !== undefined ? { systemName: input.fields.systemName } : {}),
        ...(input.fields.environment !== undefined ? { environment: input.fields.environment } : {}),
        ...(input.fields.riskLevel !== undefined ? { riskLevel: input.fields.riskLevel } : {}),
        ...(input.fields.dueDate !== undefined ? { dueDate: input.fields.dueDate ? new Date(input.fields.dueDate) : null } : {}),
      },
    });
    if (input.fields.hotfixPriority !== undefined && input.fields.hotfixPriority !== "") {
      await tx.issueFieldValue.upsert({
        where: { issueId_fieldKey: { issueId: input.issueId, fieldKey: HOTFIX_PRIORITY_FIELD_KEY } },
        create: { issueId: input.issueId, fieldKey: HOTFIX_PRIORITY_FIELD_KEY, fieldLabel: "Hotfix 工單優先級", fieldValue: input.fields.hotfixPriority },
        update: { fieldValue: input.fields.hotfixPriority },
      });
    }
  });

  await writeAuditLog({
    entityType: "Issue",
    entityId: input.issueId,
    actionType: "FieldChange",
    summary: `編輯 Hotfix 建立工單階段欄位（原標題：「${issue.title}」）`,
    actorUserId: input.actorId,
  });
}
