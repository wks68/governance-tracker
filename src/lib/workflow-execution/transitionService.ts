// M2-B 新增：Transition 執行引擎核心（FORWARD／RETURN／CANCEL 共用同一組信任邊界）。
//
// 信任邊界（Plan 第六節）：executeIssueTransition／returnIssueToStage／cancelIssueWorkflow
// 永遠在 transaction 內重新 tx.issue.findUnique 取得 currentWorkflowStageId，檢查傳入
// transitionId 所屬 WorkflowTransition.fromStageId === issue.currentWorkflowStageId 且
// transitionType 與呼叫的函式相符——呼叫端無法指定任意 currentStage，也無法指定不允許的
// transition。這個檢查同時是「重複送出拒絕」與「舊畫面覆蓋新狀態」的唯一防線：Issue 一旦
// 已經因為前一次呼叫離開了某關卡，同一個 transitionId 的 fromStageId 就不會再等於目前所在
// 關卡，第二次送出自然被拒絕——不需要額外的樂觀鎖版本欄位。
//
// getAvailableIssueTransitions／validateIssueTransition 是唯讀預覽，供 UI 顯示與提前提示，
// 其結果不具授權效力：execute 系列函式一律重新執行完整檢查，不信任、不快取任何預覽結果。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import type { ActionType } from "../audit";
import { evaluateActorEligibilityForStage, requireActorEligibleForStage } from "./access";
import { getIssueOrThrow, getTransitionOrThrow } from "./validation";
import { closeOpenHistoryRow, insertStageHistoryRow } from "./historyService";
import { evaluateWorkflowStageRequirements, requirementBlockedReasons, checkApprovalGateForLeaving, createRequiredApprovalRecordIfNeeded } from "./requirementService";
import { WorkflowExecutionStateError, WorkflowExecutionBlockedError } from "./types";
import type { BlockedReason, ExecuteTransitionInput } from "./types";

type Tx = Prisma.TransactionClient;
type ExecKind = "FORWARD" | "RETURN" | "CANCEL";

const HISTORY_TYPE_BY_KIND: Record<ExecKind, "FORWARDED" | "RETURNED" | "CANCELLED"> = {
  FORWARD: "FORWARDED",
  RETURN: "RETURNED",
  CANCEL: "CANCELLED",
};

async function collectBlockedReasons(
  tx: Tx,
  issueId: string,
  transition: Awaited<ReturnType<typeof getTransitionOrThrow>>,
  kind: ExecKind,
  reasonCode: string | null | undefined,
): Promise<BlockedReason[]> {
  const blocked: BlockedReason[] = [];

  const reasonRequired = kind !== "FORWARD" || transition.requireReason;
  if (reasonRequired && !reasonCode?.trim()) {
    blocked.push({ code: "REASON_CODE_REQUIRED", message: "此 Transition 必須填寫 reasonCode" });
  }

  if (kind === "FORWARD") {
    const reqStatuses = await evaluateWorkflowStageRequirements(tx, issueId, transition.fromStageId);
    blocked.push(...requirementBlockedReasons(reqStatuses));
    if (transition.fromStage.stageType === "TRIAGE") {
      const issue = await tx.issue.findUniqueOrThrow({ where: { id: issueId } });
      if (!issue.assignedTeamId) {
        blocked.push({ code: "TRIAGE_TEAM_NOT_ASSIGNED", message: "TRIAGE 關卡尚未指派處理團隊，不得前進" });
      }
    }
  }

  if (kind === "FORWARD" || kind === "RETURN") {
    blocked.push(...(await checkApprovalGateForLeaving(tx, issueId, transition.fromStage, kind)));
  }

  return blocked;
}

async function executeTransitionCore(tx: Tx, input: ExecuteTransitionInput, kind: ExecKind) {
  const issue = await getIssueOrThrow(tx, input.issueId);
  if (!issue.workflowVersionId || !issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow，無法執行任何 Transition");
  }

  const transition = await getTransitionOrThrow(tx, input.transitionId);

  if (transition.workflowVersionId !== issue.workflowVersionId) {
    throw new WorkflowExecutionStateError("此 Transition 不屬於 Issue 目前綁定的 Workflow 版本，拒絕跨版本執行");
  }
  if (transition.fromStageId !== issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError(
      "此 Transition 的來源關卡與 Issue 目前所在關卡不符（可能已被其他操作變更或重複送出，請重新整理頁面）",
    );
  }
  if (transition.transitionType !== kind) {
    throw new WorkflowExecutionStateError(`此 Transition 型別為「${transition.transitionType}」，不是「${kind}」`);
  }

  const version = await tx.workflowVersion.findUniqueOrThrow({ where: { id: issue.workflowVersionId } });
  if (version.status !== "PUBLISHED") {
    throw new WorkflowExecutionStateError(`所屬 Workflow 版本狀態為「${version.status}」，已不可再執行任何 Transition`);
  }

  await requireActorEligibleForStage(tx, input.actorId, issue, transition.fromStage);

  const blocked = await collectBlockedReasons(tx, issue.id, transition, kind, input.reasonCode);
  if (blocked.length > 0) throw new WorkflowExecutionBlockedError(blocked);

  const now = new Date();
  const assignedTeamIdBefore = issue.assignedTeamId;
  // RD/QA/OP 接單流程新增：進入 TRIAGE 關卡代表「這一輪處理團隊尚未認領」，即使
  // Issue.assignedTeamId 先前帶著上一階段（例如草稿建立時的 PM 團隊，或前一個 RD/QA/OP
  // 輪次的處理團隊）的值，也必須在此重置為 null，claimService 的「assignedTeamId 為 null」
  // 併發檢查前提才有意義——否則 assignedTeamId 會一路沿用舊值，永遠無法反映「尚待接單」。
  // 若範本明確設定 toStage.assignedTeamId（目前 Hotfix v1 未使用此欄位），仍優先採用範本值。
  const assignedTeamIdAfter =
    transition.toStage.assignedTeamId ?? (transition.toStage.stageType === "TRIAGE" ? null : issue.assignedTeamId);
  const terminalOutcome = transition.toStage.isEnd ? transition.toStage.terminalOutcome : null;

  await closeOpenHistoryRow(tx, issue.id, issue.currentWorkflowStageId, now);

  const updatedIssue = await tx.issue.update({
    where: { id: issue.id },
    data: {
      currentWorkflowStageId: transition.toStageId,
      workflowStatus: transition.toStage.stageKey,
      assignedTeamId: assignedTeamIdAfter,
      stageEnteredAt: now,
      closedAt: terminalOutcome ? now : issue.closedAt,
    },
  });

  await insertStageHistoryRow(tx, {
    issueId: issue.id,
    fromStageId: transition.fromStageId,
    toStageId: transition.toStageId,
    transitionId: transition.id,
    transitionType: HISTORY_TYPE_BY_KIND[kind],
    actorUserId: input.actorId,
    reasonCode: input.reasonCode ?? null,
    assignedTeamIdBefore,
    assignedTeamIdAfter,
    terminalOutcome,
    executedAt: now,
  });

  if (kind === "FORWARD") {
    await createRequiredApprovalRecordIfNeeded(tx, issue.id, transition.toStage, input.actorId);
  }

  const actionType: ActionType =
    kind === "CANCEL"
      ? "IssueWorkflowCancelled"
      : kind === "RETURN"
        ? "IssueWorkflowReturned"
        : terminalOutcome === "COMPLETED"
          ? "IssueWorkflowStageCompleted"
          : "IssueWorkflowAdvanced";

  await writeAuditLog(
    {
      entityType: "Issue",
      entityId: issue.id,
      actionType,
      summary: `${transition.label}：「${transition.fromStage.label}」→「${transition.toStage.label}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode ?? undefined,
      fromValue: transition.fromStage.stageKey,
      toValue: transition.toStage.stageKey,
    },
    tx,
  );

  return { issue: updatedIssue, transition };
}

// ---------------------------------------------------------------------------
// 公開寫入 API
// ---------------------------------------------------------------------------

export async function executeIssueTransition(input: ExecuteTransitionInput) {
  return prisma.$transaction((tx) => executeTransitionCore(tx, input, "FORWARD"));
}

// RD/QA/OP 接單流程新增：供 claimService／assignmentService 在自己既有的 transaction 內
// （已完成接單／指派資格重新驗證＋寫入）緊接著執行同一個 FORWARD Transition，兩者要嘛
// 全部成功、要嘛全部回滾，不得分成兩個各自獨立的 transaction（否則會出現「已接單但未離開
// TRIAGE 關卡」或「已離開關卡但未記錄承接團隊」的半套狀態）。比照 approvalService.ts
// 既有「可選外部 transaction client」慣例，這裡固定必須傳入呼叫端的 tx（而非可選），
// 因為呼叫端一定是在自己開啟的 transaction 內才會需要這個入口。
export async function executeIssueTransitionInTx(tx: Tx, input: ExecuteTransitionInput) {
  return executeTransitionCore(tx, input, "FORWARD");
}

export async function returnIssueToStage(input: ExecuteTransitionInput) {
  if (!input.reasonCode?.trim()) {
    throw new WorkflowExecutionBlockedError([{ code: "REASON_CODE_REQUIRED", message: "RETURN 必須填寫 reasonCode" }]);
  }
  return prisma.$transaction((tx) => executeTransitionCore(tx, input, "RETURN"));
}

export async function cancelIssueWorkflow(input: ExecuteTransitionInput) {
  if (!input.reasonCode?.trim()) {
    throw new WorkflowExecutionBlockedError([{ code: "REASON_CODE_REQUIRED", message: "CANCEL 必須填寫 reasonCode" }]);
  }
  return prisma.$transaction((tx) => executeTransitionCore(tx, input, "CANCEL"));
}

// 語意糖：明確表達「我要走到 terminalOutcome=COMPLETED 的結束關卡」，內部仍走同一套
// FORWARD 引擎，只是多一層防禦性檢查，避免呼叫端誤用一般 FORWARD Transition id 卻預期
// 走完成語意。
export async function completeIssueWorkflow(input: ExecuteTransitionInput) {
  return prisma.$transaction(async (tx) => {
    const transition = await getTransitionOrThrow(tx, input.transitionId);
    if (transition.transitionType !== "FORWARD" || transition.toStage.terminalOutcome !== "COMPLETED") {
      throw new WorkflowExecutionStateError("此 Transition 不會抵達 terminalOutcome=COMPLETED 的結束關卡，請改用 executeIssueTransition");
    }
    return executeTransitionCore(tx, input, "FORWARD");
  });
}

// ---------------------------------------------------------------------------
// 唯讀預覽 API（不具授權效力，UI 專用；execute 系列一律重新驗證）
// ---------------------------------------------------------------------------

export interface AvailableTransitionPreview {
  transition: Awaited<ReturnType<typeof getTransitionOrThrow>>;
  allowed: boolean;
  blockedReasons: BlockedReason[];
}

export async function getAvailableIssueTransitions(issueId: string, actorId: string): Promise<AvailableTransitionPreview[]> {
  return prisma.$transaction(async (tx) => {
    const issue = await getIssueOrThrow(tx, issueId);
    if (!issue.workflowVersionId || !issue.currentWorkflowStageId) return [];

    const version = await tx.workflowVersion.findUniqueOrThrow({ where: { id: issue.workflowVersionId } });
    const transitions = await tx.workflowTransition.findMany({
      where: { fromStageId: issue.currentWorkflowStageId },
      include: { fromStage: true, toStage: true },
      orderBy: { actionKey: "asc" },
    });

    const result: AvailableTransitionPreview[] = [];
    for (const transition of transitions) {
      const reasons: BlockedReason[] = [];
      if (version.status !== "PUBLISHED") {
        reasons.push({ code: "VERSION_NOT_PUBLISHED", message: "所屬版本已非 PUBLISHED，不可執行" });
      }
      const eligibility = await evaluateActorEligibilityForStage(tx, actorId, issue, transition.fromStage);
      if (!eligibility.eligible) {
        reasons.push({ code: "ACTOR_NOT_ELIGIBLE", message: eligibility.reasons.join("; ") });
      }
      // reasonCode 是否已填寫屬於「送出當下」才有意義的資訊，預覽階段一律先假設會填寫
      // （傳入非空 placeholder 避開 REASON_CODE_REQUIRED），避免 UI 誤以為按鈕永遠不可用。
      reasons.push(...(await collectBlockedReasons(tx, issue.id, transition, transition.transitionType as ExecKind, "PREVIEW_PLACEHOLDER")));
      result.push({ transition, allowed: reasons.length === 0, blockedReasons: reasons });
    }
    return result;
  });
}

export interface ValidateTransitionResult {
  valid: boolean;
  errors: string[];
}

export async function validateIssueTransition(
  issueId: string,
  transitionId: string,
  actorId: string,
  reasonCode?: string | null,
): Promise<ValidateTransitionResult> {
  return prisma.$transaction(async (tx) => {
    const issue = await getIssueOrThrow(tx, issueId);
    if (!issue.workflowVersionId || !issue.currentWorkflowStageId) {
      return { valid: false, errors: ["Issue 尚未啟動 Workflow"] };
    }

    const transition = await getTransitionOrThrow(tx, transitionId);
    const structuralErrors: string[] = [];
    if (transition.workflowVersionId !== issue.workflowVersionId) structuralErrors.push("此 Transition 不屬於 Issue 目前綁定的版本");
    if (transition.fromStageId !== issue.currentWorkflowStageId) structuralErrors.push("此 Transition 的來源關卡與 Issue 目前所在關卡不符");
    if (structuralErrors.length > 0) return { valid: false, errors: structuralErrors };

    const version = await tx.workflowVersion.findUniqueOrThrow({ where: { id: issue.workflowVersionId } });
    const errors: string[] = [];
    if (version.status !== "PUBLISHED") errors.push(`所屬版本狀態為「${version.status}」，已不可執行`);

    const eligibility = await evaluateActorEligibilityForStage(tx, actorId, issue, transition.fromStage);
    if (!eligibility.eligible) errors.push(...eligibility.reasons);

    const blocked = await collectBlockedReasons(tx, issue.id, transition, transition.transitionType as ExecKind, reasonCode);
    errors.push(...blocked.map((b) => b.message));

    return { valid: errors.length === 0, errors };
  });
}
