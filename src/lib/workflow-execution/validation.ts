// M2-B 新增：純輸入驗證與現場查詢輔助（find-or-throw）。
//
// 重要設計決策：RETURN Transition 的目標是否為來源關卡在 FORWARD 主路徑上的祖先，
// 已由 M2-A 發布前驗證（src/lib/workflow/validation.ts 第 7 項）於「發布當下」強制
// 檢查過，而 PUBLISHED 版本的 Stage／Transition 不可變（見 assertDraftVersion）。因此
// 執行引擎在執行期不需要、也不應該重新計算一次主路徑祖先關係——只要 transition 屬於
// 該 Issue 目前綁定的 PUBLISHED 版本，其圖形合法性即為已證事實，執行期只需驗證「這條
// transition 的 fromStageId 是否等於 Issue 目前所在關卡」（見 transitionService）。

import type { Prisma, PrismaClient } from "@prisma/client";
import { WorkflowExecutionNotFoundError, WorkflowExecutionValidationError } from "./types";

type Client = PrismaClient | Prisma.TransactionClient;

export function assertReasonCodeProvided(reasonCode: string | undefined | null, issues: string[]): void {
  if (!reasonCode?.trim()) issues.push("reasonCode 不得為空");
}

export function throwIfInvalid(issues: string[]): void {
  if (issues.length > 0) throw new WorkflowExecutionValidationError(issues);
}

export async function getIssueOrThrow(client: Client, issueId: string) {
  const issue = await client.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new WorkflowExecutionNotFoundError(`找不到 Issue：${issueId}`);
  return issue;
}

export async function getTransitionOrThrow(client: Client, transitionId: string) {
  const transition = await client.workflowTransition.findUnique({
    where: { id: transitionId },
    include: { fromStage: true, toStage: true },
  });
  if (!transition) throw new WorkflowExecutionNotFoundError(`找不到 WorkflowTransition：${transitionId}`);
  return transition;
}

export async function getStageOrThrow(client: Client, stageId: string) {
  const stage = await client.workflowStage.findUnique({ where: { id: stageId } });
  if (!stage) throw new WorkflowExecutionNotFoundError(`找不到 WorkflowStage：${stageId}`);
  return stage;
}
