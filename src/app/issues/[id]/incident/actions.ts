"use server";

// Incident 事件通報流程：詳情頁各關卡操作的 Server Action，統一包裝
// src/lib/workflow-execution/incidentAssignmentService.ts／incidentClosureService.ts 的服務層
// 函式，比照既有 Hotfix approval-actions.ts／execution-actions.ts 慣例（requireCurrentUser
// 取得合法 actor、toActionResult 統一錯誤回應、revalidatePath 更新畫面）。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { claimIssueForTeam } from "@/lib/workflowExecutionService";
import {
  requestIncidentSupplement,
  classifyIncident,
  assignIncidentTechnicalUnit,
  techLeadClaimAndAssignExecutor,
  techLeadReturnForReassignment,
  submitIncidentHandling,
  confirmIncidentRecovery,
  confirmIncidentRcaDecision,
} from "@/lib/workflow-execution/incidentAssignmentService";
import { confirmIncidentClosure } from "@/lib/incident-ui/incidentClosureService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function claimIncidentIntakeAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const teamId = str(formData, "teamId");
  try {
    await claimIssueForTeam({ issueId, teamId, actorId: actor.id, reasonCode: "INCIDENT_INTAKE_CLAIM" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已承接此事件");
  } catch (err) {
    return toActionResult(err, "承接失敗，請稍後再試");
  }
}

export async function requestIncidentSupplementAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const reason = str(formData, "reason");
  try {
    await requestIncidentSupplement({ issueId, actorId: actor.id, reasonCode: reason || "請補充資料" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已退回補件");
  } catch (err) {
    return toActionResult(err, "退回補件失敗，請稍後再試");
  }
}

export async function classifyIncidentAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await classifyIncident({
      issueId,
      actorId: actor.id,
      formalSeverity: str(formData, "formalSeverity"),
      adjustReason: str(formData, "adjustReason"),
      reasonCode: "INCIDENT_CLASSIFIED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已完成影響確認與分級");
  } catch (err) {
    return toActionResult(err, "分級失敗，請稍後再試");
  }
}

export async function assignIncidentUnitAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await assignIncidentTechnicalUnit({
      issueId,
      actorId: actor.id,
      technicalTeamId: str(formData, "technicalTeamId"),
      reasonCode: "INCIDENT_UNIT_ASSIGNED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已指派處理單位");
  } catch (err) {
    return toActionResult(err, "指派處理單位失敗，請稍後再試");
  }
}

export async function techLeadClaimAndAssignAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await techLeadClaimAndAssignExecutor({
      issueId,
      actorId: actor.id,
      executorUserId: str(formData, "executorUserId"),
      reasonCode: "INCIDENT_TECH_LEAD_CLAIM",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已接單並指派實際處理人員");
  } catch (err) {
    return toActionResult(err, "接單指派失敗，請稍後再試");
  }
}

export async function techLeadReturnAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const reason = str(formData, "reason");
  try {
    await techLeadReturnForReassignment({ issueId, actorId: actor.id, reasonCode: reason || "目前無法承接" });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已退回重新指派");
  } catch (err) {
    return toActionResult(err, "退回失敗，請稍後再試");
  }
}

export async function submitIncidentHandlingAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await submitIncidentHandling({
      issueId,
      actorId: actor.id,
      initialHandling: str(formData, "initialHandling"),
      recoveryMeasures: str(formData, "recoveryMeasures"),
      recoveryTime: str(formData, "recoveryTime"),
      recoveryResult: str(formData, "recoveryResult"),
      evidence: str(formData, "evidence"),
      reasonCode: "INCIDENT_HANDLING_SUBMITTED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已送出初步處置與服務恢復");
  } catch (err) {
    return toActionResult(err, "送出失敗，請稍後再試");
  }
}

export async function confirmIncidentRecoveryAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const confirmResult = str(formData, "confirmResult");
  const reason = str(formData, "reason");
  try {
    await confirmIncidentRecovery({
      issueId,
      actorId: actor.id,
      confirmResult,
      reasonCode: confirmResult === "尚未恢復" ? reason || "恢復結果未通過" : "INCIDENT_RECOVERY_CONFIRMED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已確認恢復結果");
  } catch (err) {
    return toActionResult(err, "確認失敗，請稍後再試");
  }
}

export async function confirmIncidentRcaDecisionAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  try {
    await confirmIncidentRcaDecision({
      issueId,
      actorId: actor.id,
      needRca: str(formData, "needRca") === "是",
      reason: str(formData, "reason"),
      reasonCode: "INCIDENT_RCA_DECISION_CONFIRMED",
    });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已完成 RCA 啟動判定");
  } catch (err) {
    return toActionResult(err, "判定失敗，請稍後再試");
  }
}

export async function confirmIncidentClosureAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = str(formData, "issueId");
  const approvalRecordId = str(formData, "approvalRecordId");
  try {
    await confirmIncidentClosure({ issueId, approvalRecordId, actorId: actor.id });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已確認事件結案");
  } catch (err) {
    return toActionResult(err, "確認結案失敗，請稍後再試");
  }
}
