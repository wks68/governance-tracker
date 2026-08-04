"use server";

// Hotfix 九階段 UI：stage9「結案」的「確認結案」／「退回處理」Server Action。
// 責任角色固定是原始填單人，不會退回申請人主管——一律依現有 Workflow 定義的合法 Transition
// （reporterClaim／reporterClose／reporterRejectConfirm）執行，不自行發明新的轉移目標。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { requireClosureOwnership } from "@/lib/hotfix-ui/closureService";
import { getIssueWorkflowRuntime, getAvailableIssueTransitions, executeIssueTransition, completeIssueWorkflow, returnIssueToStage } from "@/lib/workflowExecutionService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function closureActionError(err: unknown, fallback: string): ActionResult {
  const result = toActionResult(err, fallback);
  if (
    !result.ok &&
    /Transition|stageKey|Prisma|尚無任何留言|comment required|WorkflowExecution|資料表|stack/i.test(result.message)
  ) {
    return { ok: false, code: "CLOSURE_ACTION_FAILED", message: fallback };
  }
  return result;
}

// pendingReporterConfirmation 階段尚未「認領」，reporterClaim（FORWARD，不需原因）本身不是
// 使用者要操作的動作語意，只是既有 Workflow 定義裡結案前必經的一個技術性關卡，這裡在
// 「確認結案」／「退回處理」送出時於伺服端自動先執行，使用者只看得到一個按鈕。
async function ensureClaimedForClosure(issueId: string, actorId: string): Promise<void> {
  const runtime = await getIssueWorkflowRuntime(issueId, actorId);
  if (!runtime.onVersionedWorkflow) return;
  if (runtime.currentStage.stageKey !== "pendingReporterConfirmation") return;
  const transitions = await getAvailableIssueTransitions(issueId, actorId);
  const claim = transitions.find((t) => t.transition.transitionType === "FORWARD");
  if (claim) {
    await executeIssueTransition({ issueId, transitionId: claim.transition.id, actorId, reasonCode: "REPORTER_CLAIM_FOR_CLOSURE" });
  }
}

export async function confirmHotfixClosureAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  try {
    await requireClosureOwnership(issueId, actor.id);
    await ensureClaimedForClosure(issueId, actor.id);

    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const target = transitions.find((t) => t.transition.transitionType === "FORWARD" && t.transition.toStage.terminalOutcome === "COMPLETED");
    if (!target) {
      return toActionResult(new Error("找不到可結案的下一步，請重新整理頁面"));
    }
    await completeIssueWorkflow({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: "REPORTER_CONFIRMED_CLOSE" });

    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已確認結案");
  } catch (err) {
    return closureActionError(err, "目前無法確認結案，請重新整理後再試。");
  }
}

export async function rejectHotfixClosureAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { ok: false, code: "RETURN_REASON_REQUIRED", message: "請填寫退回原因。" };
  }
  if (reason.length > 500) {
    return toActionResult(new Error("原因說明不得超過 500 字"));
  }

  try {
    await requireClosureOwnership(issueId, actor.id);
    await ensureClaimedForClosure(issueId, actor.id);

    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const target = transitions.find((t) => t.transition.transitionType === "RETURN");
    if (!target) {
      return toActionResult(new Error("目前沒有可退回的合法轉移，請聯絡系統管理者"));
    }
    await returnIssueToStage({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: reason });

    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已退回處理");
  } catch (err) {
    return closureActionError(err, "目前無法退回處理，請重新整理後再試。");
  }
}
