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

export async function reassignIssueExecutorAction(
  formData: FormData,
): Promise<ActionResult<{ changed: boolean; executorName: string }>> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const executorUserId = String(formData.get("executorUserId") ?? "");

  try {
    const result = await reassignIssueExecutor({ issueId, executorUserId, actorId: actor.id, reasonCode: "REASSIGN_EXECUTOR" });
    revalidatePath(`/issues/${issueId}`, "layout");
    if (!result.changed) {
      return actionOk("已是目前執行人", { changed: false, executorName: result.executorName });
    }
    return actionOk(`已成功重新指派給 ${result.executorName}`, { changed: true, executorName: result.executorName });
  } catch (err) {
    const safeMessages = new Map([
      ["只有目前承接團隊主管可重新指派執行人。", "EXECUTOR_REASSIGNMENT_UNAUTHORIZED"],
      ["所選人員不屬於目前承接團隊，無法指派。", "EXECUTOR_REASSIGNMENT_INVALID_MEMBER"],
      ["此工單目前狀態不可重新指派執行人。", "EXECUTOR_REASSIGNMENT_INVALID_STAGE"],
    ]);
    if (err instanceof Error) {
      const code = safeMessages.get(err.message);
      if (code) return { ok: false, code, message: err.message };
    }
    console.error("[reassignIssueExecutorAction] 未預期錯誤：", err);
    return {
      ok: false,
      code: "EXECUTOR_REASSIGNMENT_FAILED",
      message: "重新指派失敗，請稍後再試；若持續發生，請聯絡管理員。",
    };
  }
}
