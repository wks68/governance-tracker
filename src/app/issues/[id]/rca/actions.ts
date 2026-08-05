"use server";

// RCA 流程：詳情頁各關卡操作的 Server Action，統一包裝
// src/lib/workflow-execution/rcaAssignmentService.ts／rcaActionItemService.ts 的服務層函式，
// 比照 src/app/issues/[id]/incident/actions.ts 既有慣例。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import {
  rcaTeamClaim,
  assignRcaOwner,
  submitRcaAnalysis,
  decideRcaTechnicalReview,
  decideRcaSecurityIntegrityReview,
  decideRcaManagementConfirmation,
  submitImprovementProgress,
  submitRcaEvidence,
  decideRcaVerification,
  confirmRcaClosure,
} from "@/lib/workflow-execution/rcaAssignmentService";
import { createRcaActionItem, updateRcaActionItemProgress, verifyRcaActionItem } from "@/lib/workflow-execution/rcaActionItemService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strList(formData: FormData, key: string): string[] {
  return formData.getAll(key).map((v) => String(v).trim()).filter(Boolean);
}

export async function rcaTeamClaimAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await rcaTeamClaim({ issueId, actorId: actor.id, reasonCode: "RCA_TEAM_CLAIM" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已承接此 RCA");
  } catch (err) {
    return toActionResult(err, "承接失敗，請稍後再試");
  }
}

export async function assignRcaOwnerAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await assignRcaOwner({ issueId, actorId: actor.id, ownerUserId: str(formData, "ownerUserId"), reasonCode: "RCA_OWNER_ASSIGNED" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已指派 RCA 主責人");
  } catch (err) {
    return toActionResult(err, "指派失敗，請稍後再試");
  }
}

export async function submitRcaAnalysisAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await submitRcaAnalysis({
      issueId,
      actorId: actor.id,
      directCause: str(formData, "directCause"),
      rootCause: str(formData, "rootCause"),
      controlFailurePoint: str(formData, "controlFailurePoint"),
      causeType: str(formData, "causeType"),
      analysisMethods: strList(formData, "analysisMethods"),
      rcaConclusion: str(formData, "rcaConclusion"),
      actualImpact: str(formData, "actualImpact"),
      verificationMethod: str(formData, "verificationMethod"),
      reasonCode: "RCA_ANALYSIS_SUBMITTED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已送出根因分析與改善計畫");
  } catch (err) {
    return toActionResult(err, "送出失敗，請稍後再試");
  }
}

export async function createRcaActionItemAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await createRcaActionItem({
      rcaIssueId: issueId,
      actorId: actor.id,
      type: str(formData, "type"),
      description: str(formData, "description"),
      ownerTeamId: str(formData, "ownerTeamId"),
      ownerUserId: str(formData, "ownerUserId"),
      plannedCompletionDate: str(formData, "plannedCompletionDate"),
      verificationMethod: str(formData, "verificationMethod"),
      reasonCode: "RCA_ACTION_ITEM_CREATED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已新增改善措施");
  } catch (err) {
    return toActionResult(err, "新增失敗，請稍後再試");
  }
}

export async function updateRcaActionItemProgressAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await updateRcaActionItemProgress({
      actionItemId: str(formData, "actionItemId"),
      actorId: actor.id,
      status: str(formData, "status"),
      actualCompletionDate: str(formData, "actualCompletionDate"),
      evidenceSummary: str(formData, "evidenceSummary"),
      extensionReason: str(formData, "extensionReason"),
      reasonCode: "RCA_ACTION_ITEM_UPDATED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已更新改善措施進度");
  } catch (err) {
    return toActionResult(err, "更新失敗，請稍後再試");
  }
}

export async function verifyRcaActionItemAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await verifyRcaActionItem({
      actionItemId: str(formData, "actionItemId"),
      actorId: actor.id,
      verificationStatus: str(formData, "verificationStatus"),
      verificationNote: str(formData, "verificationNote"),
      reasonCode: "RCA_ACTION_ITEM_VERIFIED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已填寫驗證結果");
  } catch (err) {
    return toActionResult(err, "驗證失敗，請稍後再試");
  }
}

export async function decideRcaTechnicalReviewAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const approved = str(formData, "decision") === "approve";
  const reason = str(formData, "reason");
  try {
    await decideRcaTechnicalReview({ issueId, actorId: actor.id, approved, comment: str(formData, "comment"), reasonCode: approved ? "RCA_TECHNICAL_REVIEW_APPROVED" : reason || "技術審查退回" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk(approved ? "技術審查已通過" : "已退回補正");
  } catch (err) {
    return toActionResult(err, "審查失敗，請稍後再試");
  }
}

export async function decideRcaSecurityIntegrityReviewAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const approved = str(formData, "decision") === "approve";
  const reason = str(formData, "reason");
  try {
    await decideRcaSecurityIntegrityReview({
      issueId,
      actorId: actor.id,
      approved,
      comment: str(formData, "comment"),
      requiresDirectorEscalation: str(formData, "requiresDirectorEscalation") === "是",
      reasonCode: approved ? "RCA_SECURITY_INTEGRITY_APPROVED" : reason || "完整性審查退回",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk(approved ? "完整性審查已通過" : "已退回補正");
  } catch (err) {
    return toActionResult(err, "審查失敗，請稍後再試");
  }
}

export async function decideRcaManagementConfirmationAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const approved = str(formData, "decision") === "approve";
  const reason = str(formData, "reason");
  const approvalType = str(formData, "approvalType");
  if (approvalType !== "RCA_VP_CONFIRMATION" && approvalType !== "RCA_DIRECTOR_APPROVAL") {
    return { ok: false, code: "INVALID_APPROVAL_TYPE", message: "無效的核准類型" };
  }
  try {
    await decideRcaManagementConfirmation({ issueId, actorId: actor.id, approvalType, approved, comment: str(formData, "comment"), reasonCode: approved ? "RCA_MANAGEMENT_CONFIRMED" : reason || "管理階層駁回" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk(approved ? "已完成確認" : "已駁回");
  } catch (err) {
    return toActionResult(err, "確認失敗，請稍後再試");
  }
}

export async function submitImprovementProgressAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await submitImprovementProgress({ issueId, actorId: actor.id, reasonCode: "RCA_IMPROVEMENT_SUBMITTED" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已送出改善措施執行進度");
  } catch (err) {
    return toActionResult(err, "送出失敗，請稍後再試");
  }
}

export async function submitRcaEvidenceAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await submitRcaEvidence({ issueId, actorId: actor.id, evidenceSummary: str(formData, "evidenceSummary"), reasonCode: "RCA_EVIDENCE_SUBMITTED" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已提交改善佐證");
  } catch (err) {
    return toActionResult(err, "提交失敗，請稍後再試");
  }
}

export async function decideRcaVerificationAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const approved = str(formData, "decision") === "approve";
  const reason = str(formData, "reason");
  try {
    await decideRcaVerification({ issueId, actorId: actor.id, approved, comment: str(formData, "comment"), reasonCode: approved ? "RCA_VERIFICATION_APPROVED" : reason || "驗證不通過" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk(approved ? "驗證與資安確認已通過" : "已退回改善責任人");
  } catch (err) {
    return toActionResult(err, "確認失敗，請稍後再試");
  }
}

export async function confirmRcaClosureAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await confirmRcaClosure({ issueId, actorId: actor.id, comment: str(formData, "comment"), reasonCode: "RCA_CLOSURE_CONFIRMED" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已確認 RCA 結案");
  } catch (err) {
    return toActionResult(err, "確認結案失敗，請稍後再試");
  }
}
