"use server";

// RD/QA/OP 接單流程新增：TRIAGE 關卡「接單」與 CLAIM 關卡「指派／重新指派執行人」的
// Server Action。比照既有 execution-actions.ts／approval-actions.ts 慣例：只做
// FormData 解析＋呼叫服務層＋revalidatePath，不直接操作 Prisma。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { claimIssueForTeam, assignIssueExecutor, reassignIssueExecutor } from "@/lib/workflowExecutionService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

export async function claimIssueForTeamAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "CLAIM_ISSUE");

  try {
    await claimIssueForTeam({ issueId, teamId, actorId: actor.id, reasonCode });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("接單成功");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function assignIssueExecutorAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const executorUserId = String(formData.get("executorUserId") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "ASSIGN_EXECUTOR");

  try {
    await assignIssueExecutor({ issueId, executorUserId, actorId: actor.id, reasonCode });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已指派執行人");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function reassignIssueExecutorAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const executorUserId = String(formData.get("executorUserId") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "").trim();

  if (!reasonCode) {
    return toActionResult(new Error("重新指派必須填寫原因"));
  }

  try {
    await reassignIssueExecutor({ issueId, executorUserId, actorId: actor.id, reasonCode });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已重新指派執行人");
  } catch (err) {
    return toActionResult(err);
  }
}
