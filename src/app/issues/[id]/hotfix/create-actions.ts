"use server";

// Hotfix 九階段 UI：stage1「Hotfix建立工單」的「暫存」／「建立工單」Server Action。
// 「建立工單」不是重新建立 DB 列（Issue 已由既有 createIssueAction 建立並落在 draft
// 階段），而是完成必填檢查後，執行 draft → pendingBusinessApproval 的 submit Transition。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { saveHotfixDraft, missingDraftFields, type HotfixDraftFields } from "@/lib/hotfix-ui/draftService";
import { getIssueWorkflowRuntime, getAvailableIssueTransitions, executeIssueTransition } from "@/lib/workflowExecutionService";
import { prisma } from "@/lib/prisma";
import { HOTFIX_PRIORITY_FIELD_KEY } from "@/lib/hotfix-ui/priority";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function readDraftFields(formData: FormData): Partial<HotfixDraftFields> {
  const fields: Partial<HotfixDraftFields> = {};
  for (const key of ["title", "description", "systemName", "environment", "riskLevel", "dueDate", "hotfixPriority"] as const) {
    const v = formData.get(key);
    if (v !== null) fields[key] = String(v);
  }
  return fields;
}

export async function saveHotfixDraftAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  try {
    await saveHotfixDraft({ issueId, actorId: actor.id, fields: readDraftFields(formData) });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已暫存");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function submitHotfixDraftAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const fields = readDraftFields(formData);
  try {
    await saveHotfixDraft({ issueId, actorId: actor.id, fields });

    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
    const priorityRow = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId, fieldKey: HOTFIX_PRIORITY_FIELD_KEY } } });
    const merged: HotfixDraftFields = {
      title: fields.title ?? issue.title,
      description: fields.description ?? issue.description,
      systemName: fields.systemName ?? issue.systemName,
      environment: fields.environment ?? issue.environment,
      riskLevel: fields.riskLevel ?? issue.riskLevel,
      dueDate: fields.dueDate ?? (issue.dueDate ? issue.dueDate.toISOString().slice(0, 10) : ""),
      hotfixPriority: fields.hotfixPriority ?? priorityRow?.fieldValue ?? "",
    };
    const missing = missingDraftFields(merged);
    if (missing.length > 0) {
      return toActionResult(new Error(`請先填寫必填欄位：${missing.join("、")}`));
    }

    const runtime = await getIssueWorkflowRuntime(issueId, actor.id);
    if (!runtime.onVersionedWorkflow || runtime.currentStage.stageKey !== "draft") {
      return toActionResult(new Error("工單目前關卡已變動，請重新整理頁面"));
    }
    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const target = transitions.find((t) => t.transition.transitionType === "FORWARD");
    if (!target) {
      return toActionResult(new Error("找不到可送出的下一步，請重新整理頁面"));
    }
    await executeIssueTransition({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: "HOTFIX_TICKET_SUBMITTED" });

    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已建立工單，送出待主管簽核");
  } catch (err) {
    return toActionResult(err);
  }
}
