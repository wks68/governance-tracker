"use server";

import { revalidatePath } from "next/cache";
import {
  createIssueRelationBetweenIssues,
  removeIssueRelation,
} from "@/lib/issueRelationService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

export async function addGovernanceRelationAction(
  formData: FormData,
): Promise<ActionResult> {
  const issueId = String(formData.get("issueId") ?? "").trim();
  const relatedIssueId = String(formData.get("relatedIssueId") ?? "").trim();
  try {
    const relation = await createIssueRelationBetweenIssues(issueId, relatedIssueId);
    revalidatePath("/issues");
    revalidatePath(`/issues/${relation.sourceIssueId}`, "layout");
    revalidatePath(`/issues/${relation.targetIssueId}`, "layout");
    return actionOk("已新增治理紀錄關聯");
  } catch (error) {
    return toActionResult(error, "新增關聯失敗，請稍後再試；若持續發生，請聯絡管理員。");
  }
}

export async function removeGovernanceRelationAction(
  formData: FormData,
): Promise<ActionResult> {
  const relationId = String(formData.get("relationId") ?? "").trim();
  const removalReason = String(formData.get("removalReason") ?? "").trim();
  if (!removalReason) {
    return {
      ok: false,
      code: "REMOVAL_REASON_REQUIRED",
      message: "請填寫解除原因。",
    };
  }

  try {
    const relation = await removeIssueRelation({ relationId, removalReason });
    revalidatePath("/issues");
    revalidatePath(`/issues/${relation.sourceIssueId}`, "layout");
    revalidatePath(`/issues/${relation.targetIssueId}`, "layout");
    return actionOk("已解除治理紀錄關聯");
  } catch (error) {
    return toActionResult(error, "解除關聯失敗，請稍後再試；若持續發生，請聯絡管理員。");
  }
}
