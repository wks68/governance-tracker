// M2-A 新增：WorkflowStage 與 WorkflowStageRequirement 管理。
//
// 圖形層級的驗證（可達性／唯一 FORWARD／唯一 isStart 等）留給 validation.ts 的
// validateWorkflowVersionForPublish 在發布前把關，本檔案的寫入函式只檢查「這筆資料本身
// 形式是否合法」與「版本是否仍為 DRAFT」，不在此重複實作圖形驗證。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requireWorkflowCapability } from "./access";
import { assertReasonCodeProvided, throwIfInvalid, getWorkflowVersionOrThrow } from "./validation";
import { assertDraftVersion } from "./publishService";
import { isStageType, isTerminalOutcome, isWorkflowStageRequirementType, WorkflowNotFoundError, WorkflowStateError, WorkflowValidationError } from "./types";
import type {
  AddWorkflowStageInput,
  UpdateWorkflowStageInput,
  RemoveWorkflowStageInput,
  AddWorkflowStageRequirementInput,
  RemoveWorkflowStageRequirementInput,
} from "./types";

type Tx = Prisma.TransactionClient;

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}
function isForeignKeyConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2003";
}

function assertStageFormFields(input: {
  stageType?: string;
  isEnd?: boolean;
  terminalOutcome?: string | null;
}, issues: string[]) {
  if (input.stageType !== undefined && !isStageType(input.stageType)) {
    issues.push(`stageType 不在合法值域內：${input.stageType}`);
  }
  if (input.terminalOutcome != null && !isTerminalOutcome(input.terminalOutcome)) {
    issues.push(`terminalOutcome 不在合法值域內：${input.terminalOutcome}`);
  }
  if (input.isEnd === false && input.terminalOutcome != null) {
    issues.push("非結束關卡（isEnd=false）不得設定 terminalOutcome");
  }
}

// ---------------------------------------------------------------------------
// addWorkflowStage
// ---------------------------------------------------------------------------

async function addWorkflowStageTx(tx: Tx, input: AddWorkflowStageInput) {
  const issues: string[] = [];
  if (!input.stageKey?.trim()) issues.push("stageKey 不得為空");
  if (!input.label?.trim()) issues.push("label 不得為空");
  assertStageFormFields(input, issues);
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);
  await assertDraftVersion(tx, input.workflowVersionId);

  if (input.assignedTeamId) {
    const team = await tx.team.findUnique({ where: { id: input.assignedTeamId } });
    if (!team) throw new WorkflowValidationError([`assignedTeamId 對應的 Team 不存在：${input.assignedTeamId}`]);
  }

  const stage = await tx.workflowStage.create({
    data: {
      workflowVersionId: input.workflowVersionId,
      stageKey: input.stageKey.trim(),
      label: input.label.trim(),
      stageType: input.stageType,
      sortOrder: input.sortOrder,
      isStart: input.isStart ?? false,
      isEnd: input.isEnd ?? false,
      terminalOutcome: input.terminalOutcome ?? null,
      assignedTeamId: input.assignedTeamId ?? null,
      requiredExecutionRole: input.requiredExecutionRole ?? null,
      requiredMembershipRole: input.requiredMembershipRole ?? null,
      approvalType: input.approvalType ?? null,
      requireReason: input.requireReason ?? false,
    },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowStage",
      entityId: stage.id,
      actionType: "WorkflowStageCreated",
      summary: `新增關卡「${stage.label}」（${stage.stageKey}）`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return stage;
}

export async function addWorkflowStage(input: AddWorkflowStageInput) {
  try {
    return await prisma.$transaction((tx) => addWorkflowStageTx(tx, input));
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new WorkflowValidationError([`stageKey 在此版本內已被使用：${input.stageKey}`]);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateWorkflowStage
// ---------------------------------------------------------------------------

async function updateWorkflowStageTx(tx: Tx, input: UpdateWorkflowStageInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  if (input.label !== undefined && !input.label.trim()) issues.push("label 不得為空白字串");
  assertStageFormFields(input, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const target = await tx.workflowStage.findUnique({ where: { id: input.stageId } });
  if (!target) throw new WorkflowNotFoundError(`找不到 WorkflowStage：${input.stageId}`);

  await assertDraftVersion(tx, target.workflowVersionId);

  if (input.assignedTeamId) {
    const team = await tx.team.findUnique({ where: { id: input.assignedTeamId } });
    if (!team) throw new WorkflowValidationError([`assignedTeamId 對應的 Team 不存在：${input.assignedTeamId}`]);
  }

  const nextIsEnd = input.isEnd !== undefined ? input.isEnd : target.isEnd;
  const nextTerminalOutcome = input.terminalOutcome !== undefined ? input.terminalOutcome : target.terminalOutcome;
  if (!nextIsEnd && nextTerminalOutcome != null) {
    throw new WorkflowValidationError(["非結束關卡（isEnd=false）不得設定 terminalOutcome"]);
  }

  const updated = await tx.workflowStage.update({
    where: { id: target.id },
    data: {
      label: input.label !== undefined ? input.label.trim() : undefined,
      stageType: input.stageType,
      sortOrder: input.sortOrder,
      isStart: input.isStart,
      isEnd: input.isEnd,
      terminalOutcome: input.terminalOutcome !== undefined ? input.terminalOutcome : undefined,
      assignedTeamId: input.assignedTeamId !== undefined ? input.assignedTeamId : undefined,
      requiredExecutionRole: input.requiredExecutionRole !== undefined ? input.requiredExecutionRole : undefined,
      requiredMembershipRole: input.requiredMembershipRole !== undefined ? input.requiredMembershipRole : undefined,
      approvalType: input.approvalType !== undefined ? input.approvalType : undefined,
      requireReason: input.requireReason,
    },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowStage",
      entityId: updated.id,
      actionType: "WorkflowStageUpdated",
      summary: `更新關卡「${target.label}」（${target.stageKey}）`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function updateWorkflowStage(input: UpdateWorkflowStageInput) {
  return prisma.$transaction((tx) => updateWorkflowStageTx(tx, input));
}

// ---------------------------------------------------------------------------
// removeWorkflowStage：DRAFT 關卡可移除，但仍須 AuditLog；被 Transition 引用時 FK 擋下
// ---------------------------------------------------------------------------

async function removeWorkflowStageTx(tx: Tx, input: RemoveWorkflowStageInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const target = await tx.workflowStage.findUnique({ where: { id: input.stageId } });
  if (!target) throw new WorkflowNotFoundError(`找不到 WorkflowStage：${input.stageId}`);

  await assertDraftVersion(tx, target.workflowVersionId);

  const referencingTransitionCount = await tx.workflowTransition.count({
    where: { OR: [{ fromStageId: target.id }, { toStageId: target.id }] },
  });
  if (referencingTransitionCount > 0) {
    throw new WorkflowStateError(`關卡「${target.label}」仍被 ${referencingTransitionCount} 筆 Transition 引用，請先移除相關 Transition`);
  }

  await tx.workflowStageRequirement.deleteMany({ where: { workflowStageId: target.id } });
  await tx.workflowStage.delete({ where: { id: target.id } });

  await writeAuditLog(
    {
      entityType: "WorkflowStage",
      entityId: target.id,
      actionType: "WorkflowStageRemoved",
      summary: `移除關卡「${target.label}」（${target.stageKey}）`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return target;
}

export async function removeWorkflowStage(input: RemoveWorkflowStageInput) {
  try {
    return await prisma.$transaction((tx) => removeWorkflowStageTx(tx, input));
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      throw new WorkflowStateError("此關卡仍被其他資料引用，無法移除");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// WorkflowStageRequirement CRUD（依模組化架構，Requirement 隨 Stage 一併管理，
// 不另開 requirementService.ts）
// ---------------------------------------------------------------------------

async function addWorkflowStageRequirementTx(tx: Tx, input: AddWorkflowStageRequirementInput) {
  const issues: string[] = [];
  if (!isWorkflowStageRequirementType(input.requirementType)) {
    issues.push(`requirementType 不在白名單內：${input.requirementType}`);
  }
  if (!input.targetKey?.trim()) issues.push("targetKey 不得為空");
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const stage = await tx.workflowStage.findUnique({ where: { id: input.workflowStageId } });
  if (!stage) throw new WorkflowNotFoundError(`找不到 WorkflowStage：${input.workflowStageId}`);
  await assertDraftVersion(tx, stage.workflowVersionId);

  const requirement = await tx.workflowStageRequirement.create({
    data: {
      workflowStageId: input.workflowStageId,
      requirementType: input.requirementType,
      targetKey: input.targetKey.trim(),
      isActive: true,
    },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowStageRequirement",
      entityId: requirement.id,
      actionType: "WorkflowRequirementCreated",
      summary: `為關卡「${stage.label}」新增需求（${input.requirementType}：${requirement.targetKey}）`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return requirement;
}

export async function addWorkflowStageRequirement(input: AddWorkflowStageRequirementInput) {
  return prisma.$transaction((tx) => addWorkflowStageRequirementTx(tx, input));
}

async function removeWorkflowStageRequirementTx(tx: Tx, input: RemoveWorkflowStageRequirementInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const requirement = await tx.workflowStageRequirement.findUnique({ where: { id: input.requirementId } });
  if (!requirement) throw new WorkflowNotFoundError(`找不到 WorkflowStageRequirement：${input.requirementId}`);

  const stage = await tx.workflowStage.findUniqueOrThrow({ where: { id: requirement.workflowStageId } });
  await assertDraftVersion(tx, stage.workflowVersionId);

  await tx.workflowStageRequirement.delete({ where: { id: requirement.id } });

  await writeAuditLog(
    {
      entityType: "WorkflowStageRequirement",
      entityId: requirement.id,
      actionType: "WorkflowRequirementRemoved",
      summary: `移除關卡「${stage.label}」的需求（${requirement.requirementType}：${requirement.targetKey}）`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return requirement;
}

export async function removeWorkflowStageRequirement(input: RemoveWorkflowStageRequirementInput) {
  return prisma.$transaction((tx) => removeWorkflowStageRequirementTx(tx, input));
}
