"use server";

import { requireCurrentUser } from "@/lib/auth";
import { createIncidentForActor, type CreateIncidentInput } from "@/lib/incident-ui/incidentCreation";
import { toActionResult, type ActionResult } from "@/lib/actionResult";

// 快速通報介面第三步「確認並送出」直接呼叫本 Action（不再是原生 <form action> FormData
// 版本——結構化欄位含陣列與布林值，改由 Client 端組好完整物件呼叫，仍是同一份
// createIncidentForActor 服務層，不建立第二套建立邏輯）。回傳新建 issueId 而不在此處
// redirect，讓呼叫端可以先把暫存附件上傳完成，再導向詳情頁。
export async function createIncidentAction(input: CreateIncidentInput): Promise<ActionResult<{ issueId: string }>> {
  const actor = await requireCurrentUser();
  try {
    const created = await createIncidentForActor(actor, input);
    return { ok: true, message: "已建立事件通報", data: { issueId: created.id } };
  } catch (err) {
    return toActionResult(err, "建立事件通報失敗，請稍後再試");
  }
}
