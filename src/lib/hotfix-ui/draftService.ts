// Hotfix 九階段 UI：stage1「Hotfix建立工單」草稿編輯服務層。責任角色固定是原始填單人
// （reporterUserId），且僅能在 currentStage=draft 時編輯——工單本身已由既有
// createIssueAction／createIssueForActor 建立並自動啟動流程引擎，本檔案只負責「draft
// 階段內」的欄位編輯與必填檢查，不重建一套新的建立工單流程。

import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionStateError, WorkflowExecutionValidationError } from "../workflow-execution/types";
import { HOTFIX_PRIORITY_FIELD_KEY, HOTFIX_PRIORITIES } from "./priority";
import { assertCreationTeamAndApplicant } from "../team-applicant/issueCreationScope";
import { ENVIRONMENTS, RISK_LEVELS, isValidSystemName } from "../constants";

export interface HotfixDraftFields {
  title: string;
  description: string;
  systemName: string;
  environment: string;
  riskLevel: string;
  dueDate: string; // yyyy-mm-dd or ""
  hotfixPriority: string;
  teamId: string;
  applicantId: string;
}

const REQUIRED_KEYS: (keyof HotfixDraftFields)[] = [
  "title",
  "description",
  "systemName",
  "environment",
  "riskLevel",
  "dueDate",
  "hotfixPriority",
  "teamId",
  "applicantId",
];

export function missingDraftFields(fields: HotfixDraftFields): string[] {
  const labels: Record<keyof HotfixDraftFields, string> = {
    title: "標題",
    description: "問題現象",
    systemName: "系統名稱",
    environment: "環境",
    riskLevel: "風險等級",
    dueDate: "預計完成日",
    hotfixPriority: "Hotfix 工單優先級",
    teamId: "團隊名稱",
    applicantId: "申請人",
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
  if (!(await canActorEditHotfixDraft(issueId, actorId))) {
    throw new WorkflowExecutionAccessDeniedError("僅實際建立者或申請人可編輯此階段");
  }
  return issue;
}

// actor 與 applicant 必須分開保存。Issue.reporterUserId 是申請人；真正按下建立／暫存的
// actor 保存在同一 transaction 寫入的 IssueCreated AuditLog.actorUserId。主管或 Admin
// 代建草稿後，實際建立者仍可回到第 1 關繼續編輯，申請人本人也保有草稿責任。
export async function canActorEditHotfixDraft(issueId: string, actorId: string): Promise<boolean> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { reporterUserId: true } });
  if (!issue) return false;
  if (issue.reporterUserId === actorId) return true;
  const creationAudit = await prisma.auditLog.findFirst({
    where: { entityType: "Issue", entityId: issueId, actionType: "IssueCreated" },
    orderBy: { createdAt: "asc" },
    select: { actorUserId: true },
  });
  return creationAudit?.actorUserId === actorId;
}

export async function saveHotfixDraft(input: { issueId: string; actorId: string; fields: Partial<HotfixDraftFields> }): Promise<void> {
  const issue = await requireDraftOwnership(input.issueId, input.actorId);

  if (input.fields.systemName !== undefined && input.fields.systemName !== "" && !isValidSystemName(input.fields.systemName)) {
    throw new WorkflowExecutionValidationError(["systemName 不在合法值域"]);
  }
  if (input.fields.environment !== undefined && input.fields.environment !== "" && !ENVIRONMENTS.includes(input.fields.environment)) {
    throw new WorkflowExecutionValidationError(["environment 不在合法值域"]);
  }
  if (input.fields.riskLevel !== undefined && input.fields.riskLevel !== "" && !RISK_LEVELS.includes(input.fields.riskLevel)) {
    throw new WorkflowExecutionValidationError(["riskLevel 不在合法值域"]);
  }
  if (input.fields.hotfixPriority !== undefined && input.fields.hotfixPriority !== "" && !HOTFIX_PRIORITIES.some((p) => p.value === input.fields.hotfixPriority)) {
    throw new WorkflowExecutionValidationError(["hotfixPriority 不在合法值域"]);
  }
  if (input.fields.dueDate !== undefined && input.fields.dueDate !== "" && Number.isNaN(new Date(input.fields.dueDate).getTime())) {
    throw new WorkflowExecutionValidationError(["dueDate 不是有效日期"]);
  }

  // 團隊／申請人：切換團隊時必須重新選擇該團隊的申請人，一律伺服器端重新驗證（不信任前端
  // 下拉選單結果）。暫存階段只更新欄位，不建立／不觸碰 ApprovalRecord，不推進關卡。
  const hasTeamOrApplicant = input.fields.teamId !== undefined || input.fields.applicantId !== undefined;
  if (hasTeamOrApplicant && (!input.fields.teamId || !input.fields.applicantId)) {
    throw new WorkflowExecutionValidationError(["團隊名稱與申請人必須同時選擇"]);
  }

  await prisma.$transaction(async (tx) => {
    const applicant =
      input.fields.teamId && input.fields.applicantId
        ? await assertCreationTeamAndApplicant(input.actorId, input.fields.teamId, input.fields.applicantId, tx)
        : null;
    await tx.issue.update({
      where: { id: input.issueId },
      data: {
        ...(input.fields.title !== undefined ? { title: input.fields.title } : {}),
        ...(input.fields.description !== undefined ? { description: input.fields.description } : {}),
        ...(input.fields.systemName !== undefined ? { systemName: input.fields.systemName } : {}),
        ...(input.fields.environment !== undefined ? { environment: input.fields.environment } : {}),
        ...(input.fields.riskLevel !== undefined ? { riskLevel: input.fields.riskLevel } : {}),
        ...(input.fields.dueDate !== undefined ? { dueDate: input.fields.dueDate ? new Date(input.fields.dueDate) : null } : {}),
        ...(input.fields.teamId !== undefined ? { assignedTeamId: input.fields.teamId } : {}),
        ...(applicant ? { reporterUserId: applicant.id, reporter: applicant.name } : {}),
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
