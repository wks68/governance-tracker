// M2-A 新增：WorkflowTransition 管理。
//
// 每個非結束關卡最多一個 FORWARD、每個關卡最多一個 CANCEL 由 DB partial unique index
// （WorkflowTransition_one_forward_per_stage／WorkflowTransition_one_cancel_per_stage）
// 強制把關，本檔案捕捉該 constraint 錯誤轉為友善訊息，不在應用層重新實作同一規則。
// 圖形層級的可達性／RETURN 祖先關係等驗證留給 validation.ts 在發布前把關。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requireWorkflowCapability } from "./access";
import { assertReasonCodeProvided, throwIfInvalid } from "./validation";
import { assertDraftVersion } from "./publishService";
import { isTransitionType, WorkflowNotFoundError, WorkflowValidationError } from "./types";
import type { AddWorkflowTransitionInput, UpdateWorkflowTransitionInput, RemoveWorkflowTransitionInput } from "./types";

type Tx = Prisma.TransactionClient;

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

async function addWorkflowTransitionTx(tx: Tx, input: AddWorkflowTransitionInput) {
  const issues: string[] = [];
  if (!isTransitionType(input.transitionType)) issues.push(`transitionType 不在合法值域內：${input.transitionType}`);
  if (!input.actionKey?.trim()) issues.push("actionKey 不得為空");
  if (!input.label?.trim()) issues.push("label 不得為空");
  if (input.transitionType === "RETURN" && input.fromStageId === input.toStageId) {
    issues.push("RETURN 不得指向自己");
  }
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);
  await assertDraftVersion(tx, input.workflowVersionId);

  const [fromStage, toStage] = await Promise.all([
    tx.workflowStage.findUnique({ where: { id: input.fromStageId } }),
    tx.workflowStage.findUnique({ where: { id: input.toStageId } }),
  ]);
  if (!fromStage || fromStage.workflowVersionId !== input.workflowVersionId) {
    throw new WorkflowValidationError([`fromStageId 不屬於本版本：${input.fromStageId}`]);
  }
  if (!toStage || toStage.workflowVersionId !== input.workflowVersionId) {
    throw new WorkflowValidationError([`toStageId 不屬於本版本：${input.toStageId}`]);
  }

  const transition = await tx.workflowTransition.create({
    data: {
      workflowVersionId: input.workflowVersionId,
      fromStageId: input.fromStageId,
      toStageId: input.toStageId,
      transitionType: input.transitionType,
      actionKey: input.actionKey.trim(),
      label: input.label.trim(),
      requireReason: input.requireReason ?? false,
    },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowTransition",
      entityId: transition.id,
      actionType: "WorkflowTransitionCreated",
      summary: `新增 Transition「${transition.label}」（${fromStage.stageKey} → ${toStage.stageKey}，${transition.transitionType}）`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return transition;
}

export async function addWorkflowTransition(input: AddWorkflowTransitionInput) {
  try {
    return await prisma.$transaction((tx) => addWorkflowTransitionTx(tx, input));
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new WorkflowValidationError([
        "此關卡已有相同 actionKey 的 Transition，或已有一個 FORWARD／CANCEL Transition（每個關卡最多各一個）",
      ]);
    }
    throw err;
  }
}

async function updateWorkflowTransitionTx(tx: Tx, input: UpdateWorkflowTransitionInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  if (input.label !== undefined && !input.label.trim()) issues.push("label 不得為空白字串");
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const target = await tx.workflowTransition.findUnique({ where: { id: input.transitionId } });
  if (!target) throw new WorkflowNotFoundError(`找不到 WorkflowTransition：${input.transitionId}`);

  await assertDraftVersion(tx, target.workflowVersionId);

  const updated = await tx.workflowTransition.update({
    where: { id: target.id },
    data: {
      label: input.label !== undefined ? input.label.trim() : undefined,
      requireReason: input.requireReason,
    },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowTransition",
      entityId: updated.id,
      actionType: "WorkflowTransitionUpdated",
      summary: `更新 Transition「${target.label}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function updateWorkflowTransition(input: UpdateWorkflowTransitionInput) {
  return prisma.$transaction((tx) => updateWorkflowTransitionTx(tx, input));
}

async function removeWorkflowTransitionTx(tx: Tx, input: RemoveWorkflowTransitionInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const target = await tx.workflowTransition.findUnique({ where: { id: input.transitionId } });
  if (!target) throw new WorkflowNotFoundError(`找不到 WorkflowTransition：${input.transitionId}`);

  await assertDraftVersion(tx, target.workflowVersionId);

  await tx.workflowTransition.delete({ where: { id: target.id } });

  await writeAuditLog(
    {
      entityType: "WorkflowTransition",
      entityId: target.id,
      actionType: "WorkflowTransitionRemoved",
      summary: `移除 Transition「${target.label}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return target;
}

export async function removeWorkflowTransition(input: RemoveWorkflowTransitionInput) {
  return prisma.$transaction((tx) => removeWorkflowTransitionTx(tx, input));
}
