// M2-A 新增：發布與不可變控制。
//
// assertDraftVersion 是全模組唯一的「這個版本還能不能被修改」判斷入口——stageService／
// transitionService 的所有寫入函式都必須在自己的 transaction 內呼叫本函式，不得各自
// 重新實作一次狀態檢查。已發布／已封存版本一律 fail closed（拋出 WorkflowStateError），
// 不靠 UI disabled 保護。

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requireWorkflowCapability, hasWorkflowCapability } from "./access";
import { assertReasonCodeProvided, throwIfInvalid, validateWorkflowVersionForPublish, getWorkflowVersionOrThrow } from "./validation";
import { WorkflowStateError, WorkflowValidationError, WorkflowPublishValidationError } from "./types";
import type { ValidateWorkflowVersionInput, PublishWorkflowVersionInput, WorkflowValidationResult } from "./types";

type Tx = Prisma.TransactionClient;
type Client = PrismaClient | Tx;

// 全模組共用：非 DRAFT 版本一律拒絕修改。呼叫端必須在自己的 transaction 內傳入 tx，
// 現場重新查詢（不信任呼叫端快照），確保「檢查當下即是寫入當下」。
export async function assertDraftVersion(client: Client, workflowVersionId: string): Promise<void> {
  const version = await getWorkflowVersionOrThrow(client, workflowVersionId);
  if (version.status !== "DRAFT") {
    throw new WorkflowStateError(`版本狀態為「${version.status}」，只有 DRAFT 版本可以修改 Stage／Transition／Requirement`);
  }
}

// ---------------------------------------------------------------------------
// validateWorkflowVersion：發布前驗證（唯讀，供 UI「驗證」按鈕使用，本身不阻擋、不修改狀態）
// ---------------------------------------------------------------------------

async function validateWorkflowVersionTx(tx: Tx, input: ValidateWorkflowVersionInput): Promise<WorkflowValidationResult> {
  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);
  await getWorkflowVersionOrThrow(tx, input.versionId);

  const result = await validateWorkflowVersionForPublish(tx, input.versionId);

  await writeAuditLog(
    {
      entityType: "WorkflowVersion",
      entityId: input.versionId,
      actionType: "WorkflowVersionValidated",
      summary: `驗證 Workflow 版本，結果：${result.valid ? "通過" : `${result.issues.length} 項問題`}`,
      actorUserId: input.actorId,
    },
    tx,
  );

  return result;
}

export async function validateWorkflowVersion(input: ValidateWorkflowVersionInput): Promise<WorkflowValidationResult> {
  return prisma.$transaction((tx) => validateWorkflowVersionTx(tx, input));
}

// ---------------------------------------------------------------------------
// publishWorkflowVersion：DRAFT → PUBLISHED，transaction 內重新驗證，未通過 fail closed
// ---------------------------------------------------------------------------

async function publishWorkflowVersionTx(tx: Tx, input: PublishWorkflowVersionInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.publish", tx);

  const version = await getWorkflowVersionOrThrow(tx, input.versionId);
  if (version.status !== "DRAFT") {
    throw new WorkflowStateError(`版本狀態為「${version.status}」，只有 DRAFT 版本可以發布`);
  }

  const definition = await tx.workflowDefinition.findUniqueOrThrow({ where: { id: version.workflowDefinitionId } });
  if (!definition.isActive) {
    throw new WorkflowStateError("所屬 WorkflowDefinition 已停用（isActive=false），發布新版本前必須先重新啟用");
  }

  const result = await validateWorkflowVersionForPublish(tx, input.versionId);
  if (!result.valid) {
    throw new WorkflowPublishValidationError(result.issues);
  }

  const published = await tx.workflowVersion.update({
    where: { id: input.versionId },
    data: { status: "PUBLISHED", publishedAt: new Date(), publishedByUserId: input.actorId },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowVersion",
      entityId: published.id,
      actionType: "WorkflowVersionPublished",
      summary: `發布 Workflow 版本 v${published.versionNo}（${definition.name}）`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return published;
}

export async function publishWorkflowVersion(input: PublishWorkflowVersionInput) {
  return prisma.$transaction((tx) => publishWorkflowVersionTx(tx, input));
}

export async function canManageWorkflowDraft(actorId: string): Promise<boolean> {
  return hasWorkflowCapability(actorId, "workflow.manageDraft");
}
