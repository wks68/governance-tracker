// M2-B 新增：Issue 啟動 Workflow（綁定 WorkflowVersion，一經啟動即固定，不隨新版本發布改變）。
//
// 兩個進入點，共用同一個內部核心 startWorkflowForIssueTx：
// 1. startWorkflowForIssueSystemTx：供 createIssueAction 在「建立 Issue」的同一 transaction
//    內，於偵測到該 issueType 已有可選用的 Published 版本時自動呼叫（見 Plan 第八節第 4 點
//    「新 Issue 選用 Published WorkflowVersion：逐 issueType opt-in」）。呼叫端即是系統本身
//    （建單當下的 actor 已經通過 createIssueAction 的 requireCurrentUser／issue.edit 驗證），
//    不再重複要求額外能力。
// 2. startIssueWorkflow：供管理者對「既有舊 Issue」明確選擇並啟動流程（Plan 第十節：不得
//    批次自動綁定既有 Issue，必須管理者明確操作＋清楚 AuditLog）。要求 "admin.full" 能力——
//    這是刻意選擇既有最高管理能力，而非新增一個只為這一個操作存在的細粒度 Capability。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requireExecutionCapability } from "./access";
import { assertReasonCodeProvided, throwIfInvalid, getIssueOrThrow } from "./validation";
import { insertStageHistoryRow } from "./historyService";
import { createRequiredApprovalRecordIfNeeded } from "./requirementService";
import { WorkflowExecutionStateError, WorkflowExecutionNotFoundError } from "./types";
import type { StartIssueWorkflowInput } from "./types";

type Tx = Prisma.TransactionClient;

export async function startWorkflowForIssueTx(tx: Tx, input: StartIssueWorkflowInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  const issue = await getIssueOrThrow(tx, input.issueId);
  if (issue.workflowVersionId !== null) {
    throw new WorkflowExecutionStateError("Issue 已綁定 Workflow 版本，不得重複啟動或更換版本");
  }

  const version = await tx.workflowVersion.findUnique({
    where: { id: input.workflowVersionId },
    include: { workflowDefinition: true, stages: true },
  });
  if (!version) throw new WorkflowExecutionNotFoundError(`找不到 WorkflowVersion：${input.workflowVersionId}`);
  if (version.status !== "PUBLISHED") {
    throw new WorkflowExecutionStateError(`版本狀態為「${version.status}」，只有 PUBLISHED 版本可供 Issue 啟動`);
  }
  if (!version.workflowDefinition.isActive) {
    throw new WorkflowExecutionStateError("所屬 WorkflowDefinition 已停用（isActive=false），不得供 Issue 啟動");
  }
  if (version.workflowDefinition.issueType !== issue.issueType) {
    throw new WorkflowExecutionStateError(
      `此 WorkflowVersion 對應 issueType「${version.workflowDefinition.issueType}」，與 Issue 的 issueType「${issue.issueType}」不符`,
    );
  }

  const startStage = version.stages.find((s) => s.isStart);
  if (!startStage) {
    // 理論上不可能發生：發布前驗證（第 1 項）已強制 isStart 恰好 1 個，這裡是防禦性重查。
    throw new WorkflowExecutionStateError("此版本沒有唯一的起始關卡，資料異常，請聯絡系統管理員");
  }

  const now = new Date();
  const assignedTeamIdBefore = issue.assignedTeamId;
  const assignedTeamIdAfter = startStage.assignedTeamId ?? issue.assignedTeamId;

  const updated = await tx.issue.update({
    where: { id: issue.id },
    data: {
      workflowVersionId: version.id,
      currentWorkflowStageId: startStage.id,
      workflowStatus: startStage.stageKey,
      assignedTeamId: assignedTeamIdAfter,
      stageEnteredAt: now,
    },
  });

  await insertStageHistoryRow(tx, {
    issueId: issue.id,
    fromStageId: null,
    toStageId: startStage.id,
    transitionId: null,
    transitionType: "ENTERED",
    actorUserId: input.actorId,
    reasonCode: input.reasonCode,
    assignedTeamIdBefore,
    assignedTeamIdAfter,
    terminalOutcome: startStage.isEnd ? startStage.terminalOutcome : null,
    executedAt: now,
  });

  await createRequiredApprovalRecordIfNeeded(tx, issue.id, startStage, input.actorId);

  await writeAuditLog(
    {
      entityType: "Issue",
      entityId: issue.id,
      actionType: "IssueWorkflowStarted",
      summary: `啟動 Workflow「${version.workflowDefinition.name}」v${version.versionNo}，起始關卡：${startStage.label}`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
      toValue: startStage.stageKey,
    },
    tx,
  );

  return updated;
}

// 供 createIssueAction 於建立 Issue 的同一 transaction 內呼叫，不另行重新驗證 Capability
// （建單當下已通過 createIssueAction 自己的授權檢查）。
export async function startWorkflowForIssueSystemTx(tx: Tx, input: StartIssueWorkflowInput) {
  return startWorkflowForIssueTx(tx, input);
}

export async function startIssueWorkflow(input: StartIssueWorkflowInput) {
  return prisma.$transaction(async (tx) => {
    await requireExecutionCapability(input.actorId, "admin.full", tx);
    return startWorkflowForIssueTx(tx, input);
  });
}
