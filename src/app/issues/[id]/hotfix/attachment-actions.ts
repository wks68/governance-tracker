"use server";

// Hotfix 九階段 UI：附件（選填）上傳／刪除 Server Action。只做：取得 actor → 轉呼叫
// attachmentService → revalidate。授權判斷一律留在服務層。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { uploadHotfixAttachment, uploadHotfixRichTextImage, deleteHotfixAttachment } from "@/lib/hotfix-ui/attachmentService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

export async function uploadHotfixAttachmentAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return toActionResult(new Error("請選擇要上傳的檔案"));
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadHotfixAttachment({
      issueId,
      actorId: actor.id,
      actorName: actor.name,
      fileName: file.name,
      mimeType: file.type,
      bytes,
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已上傳附件");
  } catch (err) {
    return toActionResult(err);
  }
}

export interface RichTextImageUploadData { evidenceId: string; url: string; fileName: string; mimeType: string }

export async function uploadHotfixRichTextImageAction(formData: FormData): Promise<ActionResult<RichTextImageUploadData>> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) return toActionResult(new Error("請選擇要上傳的圖片"));
  try {
    const evidence = await uploadHotfixRichTextImage({
      issueId,
      actorId: actor.id,
      actorName: actor.name,
      fileName: file.name,
      mimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("圖片上傳完成", { evidenceId: evidence.id, url: evidence.url, fileName: evidence.title, mimeType: evidence.type });
  } catch (err) {
    return toActionResult(err);
  }
}

export async function deleteHotfixAttachmentAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const evidenceId = String(formData.get("evidenceId") ?? "");
  try {
    await deleteHotfixAttachment({ issueId, evidenceId, actorId: actor.id });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已刪除附件");
  } catch (err) {
    return toActionResult(err);
  }
}
