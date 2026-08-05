"use server";

// Incident／RCA 共用附件 Server Action，統一包裝 issue-attachments/service.ts。
// 比照既有 hotfix-ui 附件 Action 慣例（requireCurrentUser 取得合法 actor、toActionResult
// 統一錯誤回應、revalidatePath 更新畫面），但服務層改呼叫本檔案共用版本。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "../auth";
import { uploadIssueAttachment, deleteIssueAttachment } from "./service";
import { actionOk, toActionResult, type ActionResult } from "../actionResult";

export async function uploadIssueAttachmentAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "").trim();
  const actionItemId = String(formData.get("actionItemId") ?? "").trim() || undefined;
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, code: "NO_FILE", message: "請選擇檔案" };
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadIssueAttachment({
      issueId,
      actorId: actor.id,
      actorName: actor.name,
      fileName: file.name,
      mimeType: file.type,
      bytes,
      actionItemId,
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已上傳附件");
  } catch (err) {
    return toActionResult(err, "上傳失敗，請稍後再試");
  }
}

export async function deleteIssueAttachmentAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "").trim();
  const evidenceId = String(formData.get("evidenceId") ?? "").trim();
  try {
    await deleteIssueAttachment({ issueId, evidenceId, actorId: actor.id });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已移除附件");
  } catch (err) {
    return toActionResult(err, "移除失敗，請稍後再試");
  }
}
