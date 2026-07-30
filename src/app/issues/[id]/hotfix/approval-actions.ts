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
import {
  decideApprovalRecord,
  ApprovalAuthorityMismatchError,
  ApprovalStateError,
  NoEligibleApproverError,
} from "@/lib/approvalService";
import {
  getAvailableIssueTransitions,
  executeIssueTransition,
  returnIssueToStage,
  returnPostDeploymentForCorrection,
  getIssueWorkflowRuntime,
  WorkflowExecutionBlockedError,
  WorkflowExecutionStateError,
} from "@/lib/workflowExecutionService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";
import { writeAuditLog } from "@/lib/audit";

export async function decideHotfixApprovalAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const approvalRecordId = String(formData.get("approvalRecordId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reasonText = String(formData.get("decisionReasonCode") ?? "").trim();

  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return { ok: false, code: "INVALID_DECISION", message: "請選擇同意或駁回。" };
  }
  if (decision === "REJECTED" && !reasonText) {
    return { ok: false, code: "REASON_REQUIRED", message: "駁回必須填寫原因。" };
  }
  if (reasonText.length > 500) {
    return { ok: false, code: "REASON_TOO_LONG", message: "原因說明不得超過 500 字。" };
  }

  try {
    const runtimeBefore = await getIssueWorkflowRuntime(issueId, actor.id);
    const stageKey = runtimeBefore.onVersionedWorkflow ? runtimeBefore.currentStage.stageKey : "";
    await decideApprovalRecord({
      approvalRecordId,
      actorUserId: actor.id,
      decision,
      decisionReasonCode: decision === "REJECTED" ? "SUPERVISOR_REJECTED" : null,
      decisionComment: reasonText || null,
    });
    await writeAuditLog({
      entityType: "Issue",
      entityId: issueId,
      actionType: decision === "APPROVED" ? "ApprovalApproved" : "ApprovalRejected",
      summary:
        stageKey === "opCompleted"
          ? `維運主管${decision === "APPROVED" ? "同意上版後確認" : "駁回正式環境部署紀錄"}`
          : `主管已${decision === "APPROVED" ? "同意" : "駁回"}核准`,
      actorUserId: actor.id,
      reasonCode: decision === "REJECTED" ? reasonText : undefined,
    });

    const kind = decision === "APPROVED" ? "FORWARD" : "RETURN";
    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const target = transitions.find((t) => t.transition.transitionType === kind);
    if (target) {
      if (kind === "FORWARD") {
        await executeIssueTransition({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: "SUPERVISOR_APPROVED" });
      } else {
        await returnIssueToStage({ issueId, transitionId: target.transition.id, actorId: actor.id, reasonCode: reasonText });
      }
    } else if (stageKey === "opCompleted" && decision === "REJECTED") {
      await returnPostDeploymentForCorrection({ issueId, actorId: actor.id, reasonCode: reasonText });
    } else {
      return { ok: false, code: "NO_MATCHING_TRANSITION", message: "簽核意見已記錄，請重新整理頁面確認目前狀態。" };
    }
  } catch (err) {
    if (err instanceof NoEligibleApproverError) return toActionResult(err);
    if (err instanceof ApprovalAuthorityMismatchError) {
      return { ok: false, code: "NOT_ELIGIBLE_APPROVER", message: "您不是目前承接團隊合法主管或核准代理人，無法完成核准。" };
    }
    if (err instanceof ApprovalStateError) {
      return { ok: false, code: "APPROVAL_NOT_PENDING", message: "此核准已完成或目前不可操作，請重新整理頁面。" };
    }
    if (err instanceof WorkflowExecutionBlockedError || err instanceof WorkflowExecutionStateError) {
      return { ok: false, code: "WORKFLOW_NOT_READY", message: "目前狀態不可執行此簽核操作，請重新整理頁面。" };
    }
    return toActionResult(err, "簽核失敗，請稍後再試；若持續發生，請聯絡管理員。");
  }

  revalidatePath(`/issues/${issueId}`, "layout");
  return actionOk(decision === "APPROVED" ? "已同意" : "已駁回");
}
