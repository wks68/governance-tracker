"use server";

// Hotfix 九階段 UI：stage3（RD修正與自測）／stage5（QA驗證）／stage7（OP上版）執行頁共用
// 的「暫存」／「送主管簽核」Server Action。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import {
  saveExecutionFieldValues,
  loadExecutionFieldValues,
  missingRequiredFields,
  executionFieldsForStageKey,
  validateExecutionSubmission,
} from "@/lib/hotfix-ui/executionFields";
import {
  getIssueWorkflowRuntime,
  getAvailableIssueTransitions,
  executeIssueTransition,
  WorkflowExecutionBlockedError,
  WorkflowExecutionStateError,
  WorkflowExecutionAccessDeniedError,
} from "@/lib/workflowExecutionService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function readFieldValues(formData: FormData, stageKey: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const def of executionFieldsForStageKey(stageKey)) {
    const v = formData.get(def.key);
    if (v !== null) values[def.key] = String(v);
  }
  return values;
}

export async function saveHotfixExecutionFieldsAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const stageKey = String(formData.get("stageKey") ?? "");
  try {
    await saveExecutionFieldValues({ issueId, actorId: actor.id, values: readFieldValues(formData, stageKey) });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已暫存");
  } catch (err) {
    if (err instanceof WorkflowExecutionBlockedError || err instanceof WorkflowExecutionStateError || err instanceof WorkflowExecutionAccessDeniedError) {
      return { ok: false, code: "WORKFLOW_NOT_EDITABLE", message: "目前狀態不可編輯此表單，請重新整理頁面。" };
    }
    return toActionResult(err, "暫存失敗，請稍後再試；若持續發生，請聯絡管理員。");
  }
}

export async function submitHotfixExecutionAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const stageKey = String(formData.get("stageKey") ?? "");
  const submittedValues = readFieldValues(formData, stageKey);

  try {
    await saveExecutionFieldValues({ issueId, actorId: actor.id, values: submittedValues });

    const merged = { ...(await loadExecutionFieldValues(issueId, stageKey)), ...submittedValues };
    const missing = missingRequiredFields(stageKey, merged);
    if (missing.length > 0) {
      return { ok: false, code: "REQUIRED_FIELDS", message: `請先填寫必填欄位：${missing.map((f) => f.label).join("、")}` };
    }
    const validationMessages = validateExecutionSubmission(stageKey, merged);
    if (validationMessages.length > 0) {
      return { ok: false, code: "INVALID_EXECUTION_FIELDS", message: validationMessages.join("；") };
    }

    const runtime = await getIssueWorkflowRuntime(issueId, actor.id);
    if (!runtime.onVersionedWorkflow || runtime.currentStage.stageKey !== stageKey) {
      return { ok: false, code: "WORKFLOW_CHANGED", message: "工單目前關卡已變動，請重新整理頁面。" };
    }

    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const target = transitions.find((t) => t.transition.transitionType === "FORWARD");
    if (!target) {
      return { ok: false, code: "NO_FORWARD_TRANSITION", message: "目前狀態不可送出，請重新整理頁面。" };
    }
    await executeIssueTransition({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: "SUBMIT_FOR_APPROVAL" });

    revalidatePath(`/issues/${issueId}`, "layout");
    if (stageKey === "opPreparing") return actionOk("上版計畫已提交，等待維運主管核准");
    if (stageKey === "opDeploying") return actionOk("正式環境部署已完成，等待維運主管確認");
    return actionOk("已送主管簽核");
  } catch (err) {
    if (err instanceof WorkflowExecutionBlockedError || err instanceof WorkflowExecutionStateError || err instanceof WorkflowExecutionAccessDeniedError) {
      return { ok: false, code: "WORKFLOW_NOT_READY", message: "目前狀態或必填內容尚未符合送出條件，請重新整理並確認表單內容。" };
    }
    return toActionResult(err, "送出失敗，請稍後再試；若持續發生，請聯絡管理員。");
  }
}
