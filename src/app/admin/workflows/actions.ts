"use server";

// M2-A3 新增：Workflow 管理 Server Action。
//
// 只做：取得 actor → 解析 FormData → 呼叫 workflowService → revalidate。所有規則
// （Capability、reasonCode 必填、DRAFT 限定、發布前驗證…）一律留在服務層，這裡只把
// 服務層拋出的領域錯誤轉成 ActionResult，不吞、不改寫錯誤語意。本檔案不直接使用 Prisma。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import {
  createWorkflowDefinition,
  updateWorkflowDefinition,
  activateWorkflowDefinition,
  deactivateWorkflowDefinition,
  createDraftVersion,
  cloneVersionToDraft,
  archiveVersion,
  addWorkflowStage,
  updateWorkflowStage,
  removeWorkflowStage,
  addWorkflowStageRequirement,
  removeWorkflowStageRequirement,
  addWorkflowTransition,
  updateWorkflowTransition,
  removeWorkflowTransition,
  validateWorkflowVersion,
  publishWorkflowVersion,
  type WorkflowValidationResult,
} from "@/lib/workflowService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function revalidateWorkflowPaths(definitionId?: string, versionId?: string) {
  revalidatePath("/admin/workflows");
  if (definitionId) revalidatePath(`/admin/workflows/${definitionId}`);
  if (definitionId && versionId) revalidatePath(`/admin/workflows/${definitionId}/versions/${versionId}`);
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function optionalText(formData: FormData, key: string): string | null {
  const v = text(formData, key);
  return v ? v : null;
}
function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export async function createWorkflowDefinitionAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireCurrentUser();
  try {
    const definition = await createWorkflowDefinition({
      key: text(formData, "key"),
      name: text(formData, "name"),
      description: text(formData, "description"),
      issueType: text(formData, "issueType"),
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateWorkflowPaths(definition.id);
    return actionOk("已建立 Workflow 定義", { id: definition.id });
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateWorkflowDefinitionAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  try {
    await updateWorkflowDefinition({
      definitionId,
      name: optionalText(formData, "name") ?? undefined,
      description: formData.has("description") ? text(formData, "description") : undefined,
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateWorkflowPaths(definitionId);
    return actionOk("已更新");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function setWorkflowDefinitionActiveAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const nextActive = checkbox(formData, "nextActive");
  try {
    if (nextActive) {
      await activateWorkflowDefinition({ definitionId, actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    } else {
      await deactivateWorkflowDefinition({ definitionId, actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    }
    revalidateWorkflowPaths(definitionId);
    return actionOk(nextActive ? "已重新啟用" : "已停用");
  } catch (err) {
    return toActionResult(err);
  }
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export async function createDraftVersionAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  try {
    const version = await createDraftVersion({ workflowDefinitionId: definitionId, actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    revalidateWorkflowPaths(definitionId);
    return actionOk("已建立草稿版本", { id: version.id });
  } catch (err) {
    return toActionResult(err);
  }
}

export async function cloneVersionToDraftAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const sourceVersionId = text(formData, "sourceVersionId");
  try {
    const version = await cloneVersionToDraft({ sourceVersionId, actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    revalidateWorkflowPaths(definitionId);
    return actionOk("已複製為新草稿", { id: version.id });
  } catch (err) {
    return toActionResult(err);
  }
}

export async function archiveVersionAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  try {
    await archiveVersion({ versionId, actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已封存版本");
  } catch (err) {
    return toActionResult(err);
  }
}

// ---------------------------------------------------------------------------
// Stage／Requirement
// ---------------------------------------------------------------------------

export async function addWorkflowStageAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  try {
    const stage = await addWorkflowStage({
      workflowVersionId: versionId,
      stageKey: text(formData, "stageKey"),
      label: text(formData, "label"),
      stageType: text(formData, "stageType"),
      sortOrder: Number(formData.get("sortOrder") ?? 0),
      isStart: checkbox(formData, "isStart"),
      isEnd: checkbox(formData, "isEnd"),
      terminalOutcome: optionalText(formData, "terminalOutcome"),
      assignedTeamId: optionalText(formData, "assignedTeamId"),
      approvalType: optionalText(formData, "approvalType"),
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已新增關卡", { id: stage.id });
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateWorkflowStageAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  const stageId = text(formData, "stageId");
  try {
    await updateWorkflowStage({
      stageId,
      label: optionalText(formData, "label") ?? undefined,
      stageType: optionalText(formData, "stageType") ?? undefined,
      sortOrder: formData.has("sortOrder") ? Number(formData.get("sortOrder")) : undefined,
      isStart: formData.has("isStart") ? checkbox(formData, "isStart") : undefined,
      isEnd: formData.has("isEnd") ? checkbox(formData, "isEnd") : undefined,
      terminalOutcome: formData.has("terminalOutcome") ? optionalText(formData, "terminalOutcome") : undefined,
      assignedTeamId: formData.has("assignedTeamId") ? optionalText(formData, "assignedTeamId") : undefined,
      approvalType: formData.has("approvalType") ? optionalText(formData, "approvalType") : undefined,
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已更新關卡");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function removeWorkflowStageAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  const stageId = text(formData, "stageId");
  try {
    await removeWorkflowStage({ stageId, actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已移除關卡");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function addWorkflowStageRequirementAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  try {
    const req = await addWorkflowStageRequirement({
      workflowStageId: text(formData, "stageId"),
      requirementType: text(formData, "requirementType"),
      targetKey: text(formData, "targetKey"),
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已新增需求", { id: req.id });
  } catch (err) {
    return toActionResult(err);
  }
}

export async function removeWorkflowStageRequirementAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  try {
    await removeWorkflowStageRequirement({ requirementId: text(formData, "requirementId"), actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已移除需求");
  } catch (err) {
    return toActionResult(err);
  }
}

// ---------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------

export async function addWorkflowTransitionAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  try {
    const transition = await addWorkflowTransition({
      workflowVersionId: versionId,
      fromStageId: text(formData, "fromStageId"),
      toStageId: text(formData, "toStageId"),
      transitionType: text(formData, "transitionType"),
      actionKey: text(formData, "actionKey"),
      label: text(formData, "label"),
      requireReason: checkbox(formData, "requireReason"),
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已新增 Transition", { id: transition.id });
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateWorkflowTransitionAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  try {
    await updateWorkflowTransition({
      transitionId: text(formData, "transitionId"),
      label: optionalText(formData, "label") ?? undefined,
      requireReason: formData.has("requireReason") ? checkbox(formData, "requireReason") : undefined,
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已更新 Transition");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function removeWorkflowTransitionAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  try {
    await removeWorkflowTransition({ transitionId: text(formData, "transitionId"), actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已移除 Transition");
  } catch (err) {
    return toActionResult(err);
  }
}

// ---------------------------------------------------------------------------
// 驗證／發布
// ---------------------------------------------------------------------------

export async function validateWorkflowVersionAction(formData: FormData): Promise<ActionResult<WorkflowValidationResult>> {
  const actor = await requireCurrentUser();
  const versionId = text(formData, "versionId");
  try {
    const result = await validateWorkflowVersion({ versionId, actorId: actor.id });
    return actionOk(result.valid ? "驗證通過，可以發布" : `驗證發現 ${result.issues.length} 項問題`, result);
  } catch (err) {
    return toActionResult(err);
  }
}

export async function publishWorkflowVersionAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const definitionId = text(formData, "definitionId");
  const versionId = text(formData, "versionId");
  try {
    await publishWorkflowVersion({ versionId, actorId: actor.id, reasonCode: text(formData, "reasonCode") });
    revalidateWorkflowPaths(definitionId, versionId);
    return actionOk("已發布此版本");
  } catch (err) {
    return toActionResult(err, "發布前驗證未通過，請重新檢查驗證結果");
  }
}
