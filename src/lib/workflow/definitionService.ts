// M2-A 新增：WorkflowDefinition 生命週期（Create／Update／Activate／Deactivate）。
//
// isActive 控制是否可供新 Issue 選用；停用不影響已綁定既有 Version 的 Issue 繼續執行
// （M2-A 尚未實作執行引擎，此規則由 M2-B 的 Issue 綁定服務遵循）。不提供 hard delete。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requireWorkflowCapability } from "./access";
import { assertReasonCodeProvided, throwIfInvalid } from "./validation";
import { WorkflowNotFoundError, WorkflowValidationError } from "./types";
import type { CreateWorkflowDefinitionInput, UpdateWorkflowDefinitionInput, SetWorkflowDefinitionActiveInput } from "./types";

type Tx = Prisma.TransactionClient;

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

async function createWorkflowDefinitionTx(tx: Tx, input: CreateWorkflowDefinitionInput) {
  const issues: string[] = [];
  if (!input.key?.trim()) issues.push("key 不得為空");
  if (!input.name?.trim()) issues.push("name 不得為空");
  if (!input.issueType?.trim()) issues.push("issueType 不得為空");
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const definition = await tx.workflowDefinition.create({
    data: {
      key: input.key.trim(),
      name: input.name.trim(),
      description: input.description ?? "",
      issueType: input.issueType.trim(),
      isActive: true,
      createdByUserId: input.actorId,
    },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowDefinition",
      entityId: definition.id,
      actionType: "WorkflowDefinitionCreated",
      summary: `建立 Workflow 定義「${definition.name}」（${definition.issueType}）`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return definition;
}

export async function createWorkflowDefinition(input: CreateWorkflowDefinitionInput) {
  try {
    return await prisma.$transaction((tx) => createWorkflowDefinitionTx(tx, input));
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new WorkflowValidationError([`key 已被使用：${input.key}`]);
    }
    throw err;
  }
}

async function updateWorkflowDefinitionTx(tx: Tx, input: UpdateWorkflowDefinitionInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  if (input.name !== undefined && !input.name.trim()) issues.push("name 不得為空白字串");
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const target = await tx.workflowDefinition.findUnique({ where: { id: input.definitionId } });
  if (!target) throw new WorkflowNotFoundError(`找不到 WorkflowDefinition：${input.definitionId}`);

  const nextName = input.name !== undefined ? input.name.trim() : target.name;
  const nextDescription = input.description !== undefined ? input.description : target.description;
  if (nextName === target.name && nextDescription === target.description) {
    return target; // no-op：不寫 AuditLog
  }

  const updated = await tx.workflowDefinition.update({
    where: { id: target.id },
    data: { name: nextName, description: nextDescription },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowDefinition",
      entityId: updated.id,
      actionType: "WorkflowDefinitionUpdated",
      summary: `更新 Workflow 定義「${target.name}」的基本資料`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function updateWorkflowDefinition(input: UpdateWorkflowDefinitionInput) {
  return prisma.$transaction((tx) => updateWorkflowDefinitionTx(tx, input));
}

async function setWorkflowDefinitionActiveTx(tx: Tx, input: SetWorkflowDefinitionActiveInput, nextIsActive: boolean) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const target = await tx.workflowDefinition.findUnique({ where: { id: input.definitionId } });
  if (!target) throw new WorkflowNotFoundError(`找不到 WorkflowDefinition：${input.definitionId}`);

  if (target.isActive === nextIsActive) {
    return target; // no-op：不寫 AuditLog
  }

  const updated = await tx.workflowDefinition.update({ where: { id: target.id }, data: { isActive: nextIsActive } });

  await writeAuditLog(
    {
      entityType: "WorkflowDefinition",
      entityId: updated.id,
      actionType: nextIsActive ? "WorkflowDefinitionActivated" : "WorkflowDefinitionDeactivated",
      summary: `${nextIsActive ? "重新啟用" : "停用"} Workflow 定義「${target.name}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

// 停用後不得供新 Issue 選用；已綁定既有 Version 的 Issue 仍可繼續執行（M2-B 範圍）。
export async function deactivateWorkflowDefinition(input: SetWorkflowDefinitionActiveInput) {
  return prisma.$transaction((tx) => setWorkflowDefinitionActiveTx(tx, input, false));
}

export async function activateWorkflowDefinition(input: SetWorkflowDefinitionActiveInput) {
  return prisma.$transaction((tx) => setWorkflowDefinitionActiveTx(tx, input, true));
}
