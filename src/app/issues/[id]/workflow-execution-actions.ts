"use server";

// M2-B 新增：Issue Workflow 執行 Server Action。
//
// 只做：取得 actor → 解析 FormData → 呼叫 workflowExecutionService → revalidate。所有規則
// （Capability、關卡資格、Requirement、Approval、Risk 檢核、reasonCode 必填…）一律留在
// 服務層，這裡只把服務層拋出的領域錯誤轉成 ActionResult，不吞、不改寫錯誤語意，
// 也不自行判斷「這個 Transition 合不合法」——一律交給服務層現場重新解析。
// 本檔案不直接使用 Prisma（比照 src/app/admin/workflows/actions.ts 既有慣例）。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import {
  executeIssueTransition,
  returnIssueToStage,
  cancelIssueWorkflow,
  completeIssueWorkflow,
  setIssueAssignedTeamAtTriage,
  startIssueWorkflow,
  submitStageFieldValue,
} from "@/lib/workflowExecutionService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function optionalText(formData: FormData, key: string): string | null {
  const v = text(formData, key);
  return v ? v : null;
}

function revalidateIssue(issueId: string) {
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/governance");
  revalidatePath("/issues");
}

export async function executeIssueTransitionAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = text(formData, "issueId");
  try {
    await executeIssueTransition({
      issueId,
      transitionId: text(formData, "transitionId"),
      actorId: actor.id,
      reasonCode: optionalText(formData, "reasonCode"),
    });
    revalidateIssue(issueId);
    return actionOk("已執行");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function returnIssueToStageAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = text(formData, "issueId");
  try {
    await returnIssueToStage({
      issueId,
      transitionId: text(formData, "transitionId"),
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateIssue(issueId);
    return actionOk("已退回");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function cancelIssueWorkflowAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = text(formData, "issueId");
  try {
    await cancelIssueWorkflow({
      issueId,
      transitionId: text(formData, "transitionId"),
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateIssue(issueId);
    return actionOk("已取消此工單流程");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function completeIssueWorkflowAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = text(formData, "issueId");
  try {
    await completeIssueWorkflow({
      issueId,
      transitionId: text(formData, "transitionId"),
      actorId: actor.id,
      reasonCode: optionalText(formData, "reasonCode"),
    });
    revalidateIssue(issueId);
    return actionOk("已結案");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function setIssueAssignedTeamAtTriageAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = text(formData, "issueId");
  try {
    await setIssueAssignedTeamAtTriage({
      issueId,
      teamId: text(formData, "teamId"),
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateIssue(issueId);
    return actionOk("已指派處理團隊");
  } catch (err) {
    return toActionResult(err);
  }
}

export async function submitStageFieldValueAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = text(formData, "issueId");
  try {
    await submitStageFieldValue({
      issueId,
      fieldKey: text(formData, "fieldKey"),
      fieldValue: String(formData.get("fieldValue") ?? ""),
      actorId: actor.id,
    });
    revalidateIssue(issueId);
    return actionOk("已填寫");
  } catch (err) {
    return toActionResult(err);
  }
}

// 供管理者對「既有舊 Issue」明確選擇並啟動流程（Plan 第十節：不得批次自動綁定既有 Issue，
// 必須管理者明確操作＋清楚 AuditLog）。
export async function startIssueWorkflowAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = text(formData, "issueId");
  try {
    await startIssueWorkflow({
      issueId,
      workflowVersionId: text(formData, "workflowVersionId"),
      actorId: actor.id,
      reasonCode: text(formData, "reasonCode"),
    });
    revalidateIssue(issueId);
    return actionOk("已啟動 Workflow");
  } catch (err) {
    return toActionResult(err);
  }
}
