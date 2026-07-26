// M2-B 新增：IssueWorkflowStageHistory 寫入與查詢——全模組唯一允許操作此表的檔案。
//
// 信任邊界（Plan 第六節）：本表只有 INSERT 與「僅離開當下」的 UPDATE exitedAt，沒有刪除
// 或竄改既有列的函式。startService／transitionService 一律呼叫本檔案的函式寫入歷程，
// 不得自行組 tx.issueWorkflowStageHistory.create/update。

import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { hasExecutionCapability } from "./access";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionNotFoundError } from "./types";

type Tx = Prisma.TransactionClient;

// 關閉「目前開放中」的歷程列（exitedAt 仍為 null、toStageId 等於 Issue 目前所在關卡）。
// Issue 剛啟動 Workflow 時尚無開放列可關閉（首次呼叫 insertStageHistoryRow 之前不會有
// 任何列），呼叫端在此情況下不應呼叫本函式；transitionService 每次執行 transition 前
// 一定先有一列 ENTERED／FORWARDED／RETURNED（開放狀態），必為 1 筆。
export async function closeOpenHistoryRow(tx: Tx, issueId: string, currentStageId: string, exitedAt: Date): Promise<void> {
  const open = await tx.issueWorkflowStageHistory.findFirst({
    where: { issueId, toStageId: currentStageId, exitedAt: null },
    orderBy: { executedAt: "desc" },
  });
  if (open) {
    await tx.issueWorkflowStageHistory.update({ where: { id: open.id }, data: { exitedAt } });
  }
}

export interface InsertStageHistoryRowInput {
  issueId: string;
  fromStageId: string | null;
  toStageId: string;
  transitionId: string | null;
  transitionType: "ENTERED" | "FORWARDED" | "RETURNED" | "CANCELLED";
  actorUserId: string;
  reasonCode: string | null;
  assignedTeamIdBefore: string | null;
  assignedTeamIdAfter: string | null;
  terminalOutcome: string | null;
  executedAt: Date;
}

export async function insertStageHistoryRow(tx: Tx, input: InsertStageHistoryRowInput) {
  return tx.issueWorkflowStageHistory.create({ data: input });
}

// ---------------------------------------------------------------------------
// 查詢（唯讀）：一律用全域 prisma，不接受外部 tx——供 UI／facade 直接呼叫，非寫入
// transaction 的一部分。
// ---------------------------------------------------------------------------

export async function getIssueWorkflowHistory(issueId: string, actorId: string) {
  const canView = await hasExecutionCapability(actorId, "issue.view");
  if (!canView) throw new WorkflowExecutionAccessDeniedError("僅具備 issue.view 能力者可查看 Workflow 執行歷程");

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new WorkflowExecutionNotFoundError(`找不到 Issue：${issueId}`);

  return prisma.issueWorkflowStageHistory.findMany({
    where: { issueId },
    orderBy: { executedAt: "asc" },
    include: {
      fromStage: true,
      toStage: true,
      transition: true,
    },
  });
}
