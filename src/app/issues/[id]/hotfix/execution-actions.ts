"use server";

// Hotfix 九階段 UI：stage3（RD修正與自測）／stage5（QA驗證）／stage7（OP上版）執行頁共用
// 的「暫存」／「送主管簽核」Server Action，以及 stage7 核准通過後的部署執行延續動作
// （確認上版完成／開放結案確認，沿用既有 opDeployComplete／reporterConfirmOpen Transition，
// 只是不再顯示 FORWARD／技術 actionKey 字樣，改用一般人看得懂的按鈕文案）。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { saveExecutionFieldValues, loadExecutionFieldValues, missingRequiredFields, executionFieldsForStageKey } from "@/lib/hotfix-ui/executionFields";
import { getIssueWorkflowRuntime, getAvailableIssueTransitions, executeIssueTransition, assertActorIsCurrentExecutor } from "@/lib/workflowExecutionService";
import { prisma } from "@/lib/prisma";
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
    return toActionResult(err);
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
      return toActionResult(new Error(`請先填寫必填欄位：${missing.map((f) => f.label).join("、")}`));
    }

    const runtime = await getIssueWorkflowRuntime(issueId, actor.id);
    if (!runtime.onVersionedWorkflow || runtime.currentStage.stageKey !== stageKey) {
      return toActionResult(new Error("工單目前關卡已變動，請重新整理頁面"));
    }

    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const target = transitions.find((t) => t.transition.transitionType === "FORWARD");
    if (!target) {
      return toActionResult(new Error("找不到可送出的下一步，請重新整理頁面"));
    }
    await executeIssueTransition({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: "SUBMIT_FOR_APPROVAL" });

    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已送主管簽核");
  } catch (err) {
    return toActionResult(err);
  }
}

// stage7（OP上版）核准通過後：opDeploying → opCompleted → pendingReporterConfirmation 的
// 延續動作，一律無需填寫原因（沿用既有 Transition.requireReason=false 設定），單一按鈕
// 「確認」即可，不暴露 actionKey 或 FORWARD 字樣。
export async function advanceHotfixOpDeploymentAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  try {
    const issue = await prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue?.currentWorkflowStageId) {
      return toActionResult(new Error("此工單目前無法執行此操作"));
    }
    const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: issue.currentWorkflowStageId } });
    // RD/QA/OP 接單流程新增：其他 OP 團隊成員即使身分合格，仍不得代替指派執行人推進此關卡。
    await assertActorIsCurrentExecutor(prisma, issueId, actor.id, stage.stageKey);

    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const target = transitions.find((t) => t.transition.transitionType === "FORWARD");
    if (!target) {
      return toActionResult(new Error("目前沒有可執行的下一步"));
    }
    await executeIssueTransition({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: "OP_DEPLOYMENT_CONTINUE" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已更新上版進度");
  } catch (err) {
    return toActionResult(err);
  }
}
