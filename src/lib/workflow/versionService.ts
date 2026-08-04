// M2-A 新增：WorkflowVersion 生命週期（Draft／Clone／Archive）。
//
// 發布（DRAFT → PUBLISHED）屬 publishService.ts 職責，本檔案不重複實作。
// PUBLISHED／ARCHIVED 版本及其 Stage／Transition／Requirement 不得 hard delete；
// 本檔案完全不提供刪除版本的函式。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requireWorkflowCapability } from "./access";
import { assertReasonCodeProvided, throwIfInvalid, getWorkflowVersionOrThrow } from "./validation";
import { WorkflowNotFoundError, WorkflowValidationError } from "./types";
import type { CreateDraftVersionInput, CloneVersionToDraftInput, ArchiveVersionInput } from "./types";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// createDraftVersion：建立全新（空白）DRAFT 版本，versionNo = 目前最大值 + 1
// ---------------------------------------------------------------------------

async function createDraftVersionTx(tx: Tx, input: CreateDraftVersionInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const definition = await tx.workflowDefinition.findUnique({ where: { id: input.workflowDefinitionId } });
  if (!definition) throw new WorkflowNotFoundError(`找不到 WorkflowDefinition：${input.workflowDefinitionId}`);

  const latest = await tx.workflowVersion.findFirst({
    where: { workflowDefinitionId: input.workflowDefinitionId },
    orderBy: { versionNo: "desc" },
  });
  const nextVersionNo = (latest?.versionNo ?? 0) + 1;

  const version = await tx.workflowVersion.create({
    data: {
      workflowDefinitionId: input.workflowDefinitionId,
      versionNo: nextVersionNo,
      status: "DRAFT",
      createdByUserId: input.actorId,
    },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowVersion",
      entityId: version.id,
      actionType: "WorkflowVersionCreated",
      summary: `建立 Workflow 定義「${definition.name}」的草稿版本 v${nextVersionNo}`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return version;
}

export async function createDraftVersion(input: CreateDraftVersionInput) {
  return prisma.$transaction((tx) => createDraftVersionTx(tx, input));
}

// ---------------------------------------------------------------------------
// cloneVersionToDraft：深拷貝來源版本的 Stage／Transition／Requirement 到新版號
// ---------------------------------------------------------------------------

async function cloneVersionToDraftTx(tx: Tx, input: CloneVersionToDraftInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.manageDraft", tx);

  const source = await getWorkflowVersionOrThrow(tx, input.sourceVersionId);
  const definition = await tx.workflowDefinition.findUniqueOrThrow({ where: { id: source.workflowDefinitionId } });

  const latest = await tx.workflowVersion.findFirst({
    where: { workflowDefinitionId: source.workflowDefinitionId },
    orderBy: { versionNo: "desc" },
  });
  const nextVersionNo = (latest?.versionNo ?? 0) + 1;

  const newVersion = await tx.workflowVersion.create({
    data: {
      workflowDefinitionId: source.workflowDefinitionId,
      versionNo: nextVersionNo,
      status: "DRAFT",
      clonedFromVersionId: source.id,
      createdByUserId: input.actorId,
    },
  });

  const sourceStages = await tx.workflowStage.findMany({ where: { workflowVersionId: source.id } });
  const stageIdMap = new Map<string, string>(); // 舊 stageId -> 新 stageId

  for (const s of sourceStages) {
    const newStage = await tx.workflowStage.create({
      data: {
        workflowVersionId: newVersion.id,
        stageKey: s.stageKey,
        label: s.label,
        stageType: s.stageType,
        sortOrder: s.sortOrder,
        isStart: s.isStart,
        isEnd: s.isEnd,
        terminalOutcome: s.terminalOutcome,
        assignedTeamId: s.assignedTeamId,
        requiredExecutionRole: s.requiredExecutionRole,
        requiredMembershipRole: s.requiredMembershipRole,
        approvalType: s.approvalType,
        requireReason: s.requireReason,
      },
    });
    stageIdMap.set(s.id, newStage.id);
  }

  const sourceRequirements = await tx.workflowStageRequirement.findMany({
    where: { workflowStage: { workflowVersionId: source.id } },
  });
  for (const r of sourceRequirements) {
    const newStageId = stageIdMap.get(r.workflowStageId);
    if (!newStageId) continue; // 防禦性：不應發生，來源 Stage 皆已複製
    await tx.workflowStageRequirement.create({
      data: {
        workflowStageId: newStageId,
        requirementType: r.requirementType,
        targetKey: r.targetKey,
        isActive: r.isActive,
      },
    });
  }

  const sourceTransitions = await tx.workflowTransition.findMany({ where: { workflowVersionId: source.id } });
  for (const t of sourceTransitions) {
    const newFromStageId = stageIdMap.get(t.fromStageId);
    const newToStageId = stageIdMap.get(t.toStageId);
    if (!newFromStageId || !newToStageId) continue; // 防禦性：不應發生
    await tx.workflowTransition.create({
      data: {
        workflowVersionId: newVersion.id,
        fromStageId: newFromStageId,
        toStageId: newToStageId,
        transitionType: t.transitionType,
        actionKey: t.actionKey,
        label: t.label,
        requireReason: t.requireReason,
      },
    });
  }

  await writeAuditLog(
    {
      entityType: "WorkflowVersion",
      entityId: newVersion.id,
      actionType: "WorkflowVersionCloned",
      summary: `複製 Workflow 定義「${definition.name}」v${source.versionNo} 為新草稿 v${nextVersionNo}`,
      actorUserId: input.actorId,
      fromValue: source.id,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return newVersion;
}

export async function cloneVersionToDraft(input: CloneVersionToDraftInput) {
  return prisma.$transaction((tx) => cloneVersionToDraftTx(tx, input));
}

// ---------------------------------------------------------------------------
// archiveVersion：DRAFT 或 PUBLISHED → ARCHIVED（單向，不提供取消封存，既知限制）
// ---------------------------------------------------------------------------

async function archiveVersionTx(tx: Tx, input: ArchiveVersionInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues, WorkflowValidationError);

  await requireWorkflowCapability(input.actorId, "workflow.archive", tx);

  const version = await getWorkflowVersionOrThrow(tx, input.versionId);
  if (version.status === "ARCHIVED") {
    return version; // no-op：已封存，不重複寫入、不重複 AuditLog
  }

  const archived = await tx.workflowVersion.update({
    where: { id: version.id },
    data: { status: "ARCHIVED", archivedAt: new Date(), archivedByUserId: input.actorId },
  });

  await writeAuditLog(
    {
      entityType: "WorkflowVersion",
      entityId: archived.id,
      actionType: "WorkflowVersionArchived",
      summary: `封存 Workflow 版本 v${archived.versionNo}（原狀態：${version.status}）`,
      actorUserId: input.actorId,
      fromValue: version.status,
      toValue: "ARCHIVED",
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return archived;
}

export async function archiveVersion(input: ArchiveVersionInput) {
  return prisma.$transaction((tx) => archiveVersionTx(tx, input));
}
