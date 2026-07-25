"use server";

// M1.5-B 新增：核准治理設定 Server Actions。
//
// 這些 action 只做：requireCurrentUser() 拿 actorId → 解析 FormData → 呼叫服務層
// （actorId 傳入）→ revalidatePath。不寫 AuditLog、不直接查 Prisma、不做任何規則判斷——
// 全部規則檢查（權限、重疊、循環、原始資格等）都在服務層的 transaction 內完成，
// 這裡的錯誤處理只是把服務層拋出的錯誤原樣往上丟，不吞、不轉換。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "./auth";
import {
  createSupervisorAssignment,
  endSupervisorAssignment,
  cancelScheduledSupervisorAssignment,
  replaceSupervisorAssignment,
} from "./supervisorAssignmentService";
import { assignTeamLead, removeTeamLead } from "./teamLeadService";
import { createApprovalDelegation, revokeApprovalDelegation } from "./approvalDelegationService";
import { isApprovalType } from "./constants";

const SETTINGS_PATH = "/settings/approval-governance";

function parseRequiredDate(value: FormDataEntryValue | null, fieldName: string): Date {
  const str = String(value || "");
  const date = new Date(str);
  if (!str || Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} 格式不正確`);
  }
  return date;
}

function parseOptionalDate(value: FormDataEntryValue | null): Date | null {
  const str = String(value || "").trim();
  if (!str) return null;
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) throw new Error("日期格式不正確");
  return date;
}

// ---------------------------------------------------------------------------
// 主管
// ---------------------------------------------------------------------------

export async function createSupervisorAssignmentAction(formData: FormData) {
  const actor = await requireCurrentUser();
  const isPrimaryRaw = formData.get("isPrimary");
  const isPrimary = isPrimaryRaw === null ? true : isPrimaryRaw === "true" || isPrimaryRaw === "on";
  await createSupervisorAssignment({
    userId: String(formData.get("userId") || ""),
    supervisorUserId: String(formData.get("supervisorUserId") || ""),
    validFrom: parseRequiredDate(formData.get("validFrom"), "validFrom"),
    validUntil: parseOptionalDate(formData.get("validUntil")),
    isPrimary,
    actorId: actor.id,
    reasonCode: String(formData.get("reasonCode") || ""),
  });
  revalidatePath(SETTINGS_PATH);
}

export async function endSupervisorAssignmentAction(formData: FormData) {
  const actor = await requireCurrentUser();
  await endSupervisorAssignment({
    assignmentId: String(formData.get("assignmentId") || ""),
    endAt: parseRequiredDate(formData.get("endAt"), "endAt"),
    actorId: actor.id,
    reasonCode: String(formData.get("reasonCode") || ""),
  });
  revalidatePath(SETTINGS_PATH);
}

export async function cancelScheduledSupervisorAssignmentAction(formData: FormData) {
  const actor = await requireCurrentUser();
  await cancelScheduledSupervisorAssignment({
    assignmentId: String(formData.get("assignmentId") || ""),
    actorId: actor.id,
    reasonCode: String(formData.get("reasonCode") || ""),
  });
  revalidatePath(SETTINGS_PATH);
}

export async function replaceSupervisorAssignmentAction(formData: FormData) {
  const actor = await requireCurrentUser();
  await replaceSupervisorAssignment({
    oldAssignmentId: String(formData.get("oldAssignmentId") || ""),
    newSupervisorUserId: String(formData.get("newSupervisorUserId") || ""),
    effectiveAt: parseRequiredDate(formData.get("effectiveAt"), "effectiveAt"),
    actorId: actor.id,
    reasonCode: String(formData.get("reasonCode") || ""),
  });
  revalidatePath(SETTINGS_PATH);
}

// ---------------------------------------------------------------------------
// Team LEAD
// ---------------------------------------------------------------------------

export async function assignTeamLeadAction(formData: FormData) {
  const actor = await requireCurrentUser();
  await assignTeamLead({
    teamId: String(formData.get("teamId") || ""),
    userId: String(formData.get("userId") || ""),
    actorId: actor.id,
    reasonCode: String(formData.get("reasonCode") || ""),
  });
  revalidatePath(SETTINGS_PATH);
}

export async function removeTeamLeadAction(formData: FormData) {
  const actor = await requireCurrentUser();
  await removeTeamLead({
    teamId: String(formData.get("teamId") || ""),
    userId: String(formData.get("userId") || ""),
    actorId: actor.id,
    reasonCode: String(formData.get("reasonCode") || ""),
  });
  revalidatePath(SETTINGS_PATH);
}

// ---------------------------------------------------------------------------
// 核准代理
// ---------------------------------------------------------------------------

export async function createApprovalDelegationAction(formData: FormData) {
  const actor = await requireCurrentUser();
  const approvalType = String(formData.get("approvalType") || "");
  if (!isApprovalType(approvalType)) throw new Error("approvalType 不在合法值域");
  const teamIdRaw = String(formData.get("teamId") || "").trim();
  const reasonCodeRaw = String(formData.get("reasonCode") || "").trim();
  await createApprovalDelegation({
    delegatorUserId: String(formData.get("delegatorUserId") || ""),
    delegateUserId: String(formData.get("delegateUserId") || ""),
    approvalType,
    teamId: teamIdRaw ? teamIdRaw : null,
    validFrom: parseRequiredDate(formData.get("validFrom"), "validFrom"),
    validUntil: parseRequiredDate(formData.get("validUntil"), "validUntil"),
    reason: String(formData.get("reason") || ""),
    actorId: actor.id,
    reasonCode: reasonCodeRaw ? reasonCodeRaw : null,
  });
  revalidatePath(SETTINGS_PATH);
}

export async function revokeApprovalDelegationAction(formData: FormData) {
  const actor = await requireCurrentUser();
  await revokeApprovalDelegation({
    delegationId: String(formData.get("delegationId") || ""),
    actorId: actor.id,
    revocationReason: String(formData.get("revocationReason") || ""),
  });
  revalidatePath(SETTINGS_PATH);
}
