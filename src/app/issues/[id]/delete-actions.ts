"use server";

// 建立工單／團隊整合修正新增：工單刪除 Server Action（申請人自行刪除／Admin 永久刪除），
// 通用於所有工單類型，不限 Hotfix——Hotfix 九階段 UI 與一般工單詳情頁共用同一組 Action。

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { deleteOwnDraftIssue, adminPermanentDeleteIssue } from "@/lib/issue-management/issueDeletionService";
import { toActionResult, type ActionResult } from "@/lib/actionResult";

export async function deleteOwnDraftIssueAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  try {
    await deleteOwnDraftIssue({ issueId, actorId: actor.id });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath("/issues");
  revalidatePath("/governance");
  redirect("/issues");
}

export async function adminPermanentDeleteIssueAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const confirmIssueKey = String(formData.get("confirmIssueKey") ?? "");
  try {
    await adminPermanentDeleteIssue({ issueId, actorId: actor.id, reason, confirmIssueKey });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath("/issues");
  revalidatePath("/governance");
  redirect("/issues");
}
