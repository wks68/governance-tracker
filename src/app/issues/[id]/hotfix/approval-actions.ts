"use server";

// Hotfix 九階段 UI：4 個獨立主管簽核頁共用的「決策＋離開關卡」合併 Server Action。
//
// 舊版 UI（HotfixApprovalPanel＋HotfixActionPanels）把「核准／駁回 ApprovalRecord」與
// 「離開 APPROVAL 關卡的 Transition」拆成兩次各自獨立的操作，使用者要點兩次。新版每頁
// 「同意」／「駁回」只需一次點擊，因此這裡把兩步驟串在同一個 Server Action 內依序呼叫
// 既有服務層（decideApprovalRecord → executeIssueTransition／returnIssueToStage）。
// 兩者仍各自是獨立的服務層 transaction（不合併成單一 DB transaction）：decideApprovalRecord
// 本身已經是「核准治理層」的完整信任邊界與寫入單位，executeIssueTransition／
// returnIssueToStage 則是「執行引擎」的完整信任邊界與寫入單位，如同舊版兩個獨立按鈕呼叫
// 的兩個既有服務——若第二步失敗，ApprovalRecord 的決策已經留下正確稽核記錄，Issue 目前
// 關卡不變，之後仍可用同一個 approvalRecordId 對應的合法 Transition 重試離開關卡，不會
// 產生半套資料（decideApprovalRecord／executeIssueTransition 各自的 transaction 保證各自
// 要嘛全部成功要嘛全部回滾）。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { decideApprovalRecord } from "@/lib/approvalService";
import { getAvailableIssueTransitions, executeIssueTransition, returnIssueToStage } from "@/lib/workflowExecutionService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

export async function decideHotfixApprovalAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const approvalRecordId = String(formData.get("approvalRecordId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reasonText = String(formData.get("decisionReasonCode") ?? "").trim();

  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return toActionResult(new Error("decision 必須是 APPROVED 或 REJECTED"));
  }
  if (decision === "REJECTED" && !reasonText) {
    return toActionResult(new Error("駁回必須填寫原因"));
  }
  if (reasonText.length > 500) {
    return toActionResult(new Error("原因說明不得超過 500 字"));
  }

  try {
    await decideApprovalRecord({
      approvalRecordId,
      actorUserId: actor.id,
      decision,
      decisionReasonCode: decision === "REJECTED" ? "SUPERVISOR_REJECTED" : null,
      decisionComment: reasonText || null,
    });
  } catch (err) {
    return toActionResult(err);
  }

  try {
    const kind = decision === "APPROVED" ? "FORWARD" : "RETURN";
    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const target = transitions.find((t) => t.transition.transitionType === kind);
    if (!target) {
      return toActionResult(new Error(`「${decision === "APPROVED" ? "同意" : "駁回"}」已記錄，但找不到對應的關卡轉移，請重新整理頁面確認狀態`));
    }
    if (kind === "FORWARD") {
      await executeIssueTransition({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: "SUPERVISOR_APPROVED" });
    } else {
      await returnIssueToStage({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: reasonText });
    }
  } catch (err) {
    return toActionResult(err, "簽核意見已記錄，但關卡轉移失敗，請重新整理頁面確認狀態");
  }

  revalidatePath(`/issues/${issueId}`, "layout");
  return actionOk(decision === "APPROVED" ? "已同意" : "已駁回");
}
