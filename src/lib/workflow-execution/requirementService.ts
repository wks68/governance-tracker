// M2-B 新增：Stage Requirement 評估與 APPROVAL 關卡自動送核。
//
// evaluateWorkflowStageRequirements 與 M1 既有 src/lib/gateRules.ts 並行實作，不重用、
// 不包裝（見 Plan 第七節既有研究結論）：gateRules.ts 是「針對每個 (issueType, targetStatus)
// 組合寫死 if/else」的舊模型，本檔案改吃 WorkflowStageRequirement 資料表，兩套邏輯完全分流，
// 舊模型 Issue（workflowVersionId=null）永遠只走 gateRules.ts，新模型 Issue 永遠只走本檔案。

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { createPendingApprovalRecord, resubmitApprovalRecord } from "../approvalService";
import { isApprovalType } from "../constants";
import { getRiskCheckTemplate } from "../riskCheckTemplates";
import { hasExecutionCapability } from "./access";
import { getIssueOrThrow } from "./validation";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionStateError, WorkflowExecutionValidationError } from "./types";
import type { BlockedReason, StageRequirementStatus } from "./types";

type Tx = Prisma.TransactionClient;
type Client = PrismaClient | Tx;

// ---------------------------------------------------------------------------
// WorkflowStageRequirement 評估（REQUIRE_FIELD／REQUIRE_EVIDENCE／REQUIRE_COMMENT）
// ---------------------------------------------------------------------------

export async function evaluateWorkflowStageRequirements(client: Client, issueId: string, workflowStageId: string): Promise<StageRequirementStatus[]> {
  const stage = await client.workflowStage.findUniqueOrThrow({
    where: { id: workflowStageId },
    select: { stageKey: true },
  });
  const requirements = await client.workflowStageRequirement.findMany({
    where: { workflowStageId, isActive: true },
  });
  if (requirements.length === 0) return [];

  const results: StageRequirementStatus[] = [];
  for (const req of requirements) {
    let satisfied = false;
    let message = "";
    if (req.requirementType === "REQUIRE_FIELD") {
      const field = await client.issueFieldValue.findUnique({
        where: { issueId_fieldKey: { issueId, fieldKey: req.targetKey } },
      });
      satisfied = !!field && field.fieldValue.trim() !== "";
      message = satisfied ? `欄位「${req.targetKey}」已填寫` : `欄位「${req.targetKey}」尚未填寫`;
    } else if (req.requirementType === "REQUIRE_EVIDENCE") {
      // OP 的正式紀錄由結構化表單、核准紀錄、History 與 AuditLog 組成；附件永遠選填。
      // 已發布的舊 Preview workflow 仍可能帶有這筆 legacy requirement，因此執行期也要
      // 明確忽略，避免未重建 Preview DB 時再次出現「尚缺佐證資料」。
      if (stage.stageKey === "opPreparing") {
        results.push({
          requirementId: req.id,
          requirementType: req.requirementType,
          targetKey: req.targetKey,
          satisfied: true,
          message: "附件為選填",
        });
        continue;
      }
      // targetKey="ANY" 是慣例值，代表「不限類型，任一筆佐證即可」——
      // WorkflowStageRequirement.targetKey 依 M2-A 既有驗證規則不得為空字串
      // （見 src/lib/workflow/stageService.ts），因此不能直接用空字串表達「無限制」。
      const isAny = req.targetKey === "ANY";
      const count = await client.evidence.count({
        where: { issueId, ...(isAny ? {} : { type: req.targetKey }) },
      });
      satisfied = count > 0;
      message = satisfied
        ? `已有${isAny ? "" : `「${req.targetKey}」類型的`}佐證資料`
        : `尚缺${isAny ? "" : `「${req.targetKey}」類型的`}佐證資料`;
    } else if (req.requirementType === "REQUIRE_COMMENT") {
      const count = await client.comment.count({ where: { issueId } });
      satisfied = count > 0;
      message = satisfied ? "已有留言" : "尚無任何留言";
    } else {
      // deny-by-default：不在白名單內的 requirementType 視為永遠不滿足（發布前驗證應已擋下，
      // 這裡是執行期防禦性重查）。
      satisfied = false;
      message = `requirementType「${req.requirementType}」不在白名單內`;
    }
    results.push({ requirementId: req.id, requirementType: req.requirementType, targetKey: req.targetKey, satisfied, message });
  }
  return results;
}

export function requirementBlockedReasons(statuses: readonly StageRequirementStatus[]): BlockedReason[] {
  return statuses
    .filter((s) => !s.satisfied)
    .map((s) => ({ code: "STAGE_REQUIREMENT_NOT_MET" as const, message: s.message }));
}

// ---------------------------------------------------------------------------
// REQUIRE_FIELD 資料填寫入口：新模型 Issue 目前關卡的欄位鍵（targetKey）是由
// WorkflowStageRequirement 動態定義的，與舊模型 src/lib/workflow.ts 的靜態
// FieldTemplate（依 issueType+workflowStatus 查表）完全是兩套不相干的鍵空間——
// 既有 updateDynamicFieldsAction 內部會重新以 issue.workflowStatus 現場查詢舊模型
// 樣板（不信任呼叫端傳入的欄位清單），對新模型的 stageKey 查不到任何對應樣板，
// 等同無法用來寫入新模型的欄位需求，因此需要這個新的、只服務於「目前關卡已宣告的
// REQUIRE_FIELD 需求」的最小寫入入口，不重建一整套動態欄位系統。
//
// 授權比照既有 addCommentAction／addEvidenceAction（僅要求已登入使用者，不額外要求
// issue.edit 之外的能力，因為這與「執行 Transition」是不同層級的動作——填寫佐證資料
// 本身不移動 Issue 的關卡）；額外限制：fieldKey 必須是目前關卡實際宣告的 REQUIRE_FIELD
// targetKey 之一，不接受任意鍵值，避免此入口被當成繞過既有動態欄位系統的任意寫入後門。
export async function submitStageFieldValue(input: { issueId: string; fieldKey: string; fieldValue: string; actorId: string }) {
  const canEdit = await hasExecutionCapability(input.actorId, "issue.edit");
  if (!canEdit) throw new WorkflowExecutionAccessDeniedError('僅具備 "issue.edit" 能力者可填寫關卡欄位');

  const issue = await getIssueOrThrow(prisma, input.issueId);
  if (!issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow，無法填寫關卡欄位");
  }

  const requirement = await prisma.workflowStageRequirement.findFirst({
    where: { workflowStageId: issue.currentWorkflowStageId, requirementType: "REQUIRE_FIELD", targetKey: input.fieldKey, isActive: true },
  });
  if (!requirement) {
    throw new WorkflowExecutionValidationError([`目前關卡沒有宣告 REQUIRE_FIELD 需求「${input.fieldKey}」，拒絕寫入`]);
  }

  const existing = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: issue.id, fieldKey: input.fieldKey } } });
  const oldValue = existing?.fieldValue ?? "";

  const updated = await prisma.issueFieldValue.upsert({
    where: { issueId_fieldKey: { issueId: issue.id, fieldKey: input.fieldKey } },
    create: { issueId: issue.id, fieldKey: input.fieldKey, fieldLabel: input.fieldKey, fieldValue: input.fieldValue },
    update: { fieldValue: input.fieldValue },
  });

  if (oldValue !== input.fieldValue) {
    await writeAuditLog({
      entityType: "Issue",
      entityId: issue.id,
      actionType: "FieldChange",
      summary: `填寫關卡欄位「${input.fieldKey}」：「${oldValue || "（空白）"}」→「${input.fieldValue || "（空白）"}」`,
      actorUserId: input.actorId,
    });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// 風險檢核填答（Hotfix 操作畫面收斂新增）：approvalService.assertRiskChecksReadyForSubmission
// 這個既有前置條件（送核前 StageRiskCheck 必須全數填答，UNKNOWN 必須已 resolve）先前
// 完全沒有對應的填答入口——只有 verify script 用 prisma.stageRiskCheck.create 直接寫入。
// 這裡比照 submitStageFieldValue 同樣的最小、受限寫入模式補上這個缺口：不重寫任何
// Transition／Approval 判斷邏輯本身，只是讓「填答風險檢核」這件事透過服務層有一個
// 安全、會重新授權、且限定寫入範圍的入口。
//
// stageKey 必須是「這個 Issue 目前關卡本身」或「目前關卡某條 Transition 的目標關卡」
// 之一，且該 stageKey 必須確實有風險檢核模板——不接受任意 stageKey，避免這個入口被
// 當成任意寫入 StageRiskCheck 的後門。
export async function submitStageRiskCheckAnswer(input: {
  issueId: string;
  stageKey: string;
  checkKey: string;
  answer: "YES" | "NO" | "UNKNOWN";
  detail?: string;
  resolveUnknown?: boolean;
  actorId: string;
}) {
  const canEdit = await hasExecutionCapability(input.actorId, "issue.edit");
  if (!canEdit) throw new WorkflowExecutionAccessDeniedError('僅具備 "issue.edit" 能力者可填寫風險檢核');

  const issue = await getIssueOrThrow(prisma, input.issueId);
  if (!issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow，無法填寫風險檢核");
  }

  const currentStage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: issue.currentWorkflowStageId } });
  const isCurrentStage = currentStage.stageKey === input.stageKey;
  const isReachableTarget = await prisma.workflowTransition.findFirst({
    where: { fromStageId: issue.currentWorkflowStageId, toStage: { stageKey: input.stageKey } },
  });
  if (!isCurrentStage && !isReachableTarget) {
    throw new WorkflowExecutionValidationError([`stageKey「${input.stageKey}」不是目前關卡，也不是目前關卡可前往的關卡，拒絕寫入`]);
  }

  const template = getRiskCheckTemplate(input.stageKey);
  if (!template || !template.some((t) => t.checkKey === input.checkKey)) {
    throw new WorkflowExecutionValidationError([`stageKey「${input.stageKey}」沒有 checkKey「${input.checkKey}」的風險檢核模板`]);
  }

  if (input.answer === "UNKNOWN" && input.resolveUnknown && !input.detail?.trim()) {
    throw new WorkflowExecutionValidationError(["標記已釐清（resolve）時必須填寫說明"]);
  }

  const existingRows = await prisma.stageRiskCheck.findMany({ where: { issueId: issue.id, stageKey: input.stageKey } });
  const currentRound = existingRows.length > 0 ? Math.max(...existingRows.map((r) => r.assessmentRound)) : 1;
  const existing = existingRows.find((r) => r.assessmentRound === currentRound && r.checkKey === input.checkKey);

  const resolvedAt = input.answer === "UNKNOWN" ? (input.resolveUnknown ? new Date() : null) : null;
  const data = {
    answer: input.answer,
    detail: input.detail ?? "",
    answeredByUserId: input.actorId,
    answeredAt: new Date(),
    resolvedAt,
  };

  const result = existing
    ? await prisma.stageRiskCheck.update({ where: { id: existing.id }, data })
    : await prisma.stageRiskCheck.create({ data: { issueId: issue.id, stageKey: input.stageKey, assessmentRound: currentRound, checkKey: input.checkKey, ...data } });

  await writeAuditLog({
    entityType: "Issue",
    entityId: issue.id,
    actionType: "FieldChange",
    summary: `填寫風險檢核「${input.stageKey}」／「${input.checkKey}」：${input.answer}${resolvedAt ? "（已釐清）" : ""}`,
    actorUserId: input.actorId,
  });

  return result;
}

// ---------------------------------------------------------------------------
// APPROVAL 關卡：離開前必須「已核准」（FORWARD）或「已駁回」（RETURN）
// ---------------------------------------------------------------------------

export async function findLatestActiveApprovalRecord(client: Client, issueId: string, approvalType: string, relatedStageKey: string) {
  return client.approvalRecord.findFirst({
    where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" },
    orderBy: { revisionNo: "desc" },
  });
}

export async function checkApprovalGateForLeaving(
  client: Client,
  issueId: string,
  fromStage: { stageType: string; approvalType: string | null; stageKey: string },
  transitionType: "FORWARD" | "RETURN",
): Promise<BlockedReason[]> {
  const approvalType =
    fromStage.stageKey === "opCompleted"
      ? "DEPLOYMENT_APPROVAL"
      : fromStage.stageType === "APPROVAL"
        ? fromStage.approvalType
        : null;
  if (!approvalType) return [];

  const record = await findLatestActiveApprovalRecord(client, issueId, approvalType, fromStage.stageKey);

  if (transitionType === "FORWARD") {
    if (!record || record.decision !== "APPROVED") {
      return [{ code: "APPROVAL_NOT_GRANTED", message: `關卡「${fromStage.stageKey}」尚未取得核准（APPROVED），不得前進` }];
    }
    return [];
  }

  // RETURN：只有在核准已被明確駁回（REJECTED）時才允許退回，避免呼叫端繞過核准直接退回。
  if (!record || record.decision !== "REJECTED") {
    return [{ code: "APPROVAL_NOT_REJECTED", message: `關卡「${fromStage.stageKey}」尚未有核准駁回（REJECTED）紀錄，不得退回` }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// 進入 APPROVAL 關卡：自動建立（或重新送核）對應的 PENDING ApprovalRecord
// ---------------------------------------------------------------------------

// 若目標關卡是 APPROVAL 類型，於同一 transaction 內自動建立待核准紀錄——這是「TRIAGE 可依模板
// 提示，但實際結果必須寫入 Issue」相同精神在 APPROVAL 關卡的體現：送核這件事本身是關卡轉移的
// 自然結果，不需要使用者另外按一次「送出核准」。若該 (issueId, approvalType, relatedStageKey)
// 已存在 REJECTED／CANCELLED 的 ACTIVE 舊紀錄（RETURN 後重新 FORWARD 回到同一關卡），改用
// resubmitApprovalRecord 形成 revision 鏈，不建立互不相關的第二筆獨立紀錄。
export async function createRequiredApprovalRecordIfNeeded(
  tx: Tx,
  issueId: string,
  targetStage: { stageType: string; approvalType: string | null; stageKey: string },
  actorId: string,
): Promise<void> {
  const approvalType =
    targetStage.stageKey === "opCompleted"
      ? "DEPLOYMENT_APPROVAL"
      : targetStage.stageType === "APPROVAL"
        ? targetStage.approvalType
        : null;
  if (!approvalType) return;
  if (!isApprovalType(approvalType)) {
    throw new WorkflowExecutionStateError(`WorkflowStage「${targetStage.stageKey}」為 APPROVAL 類型但 approvalType 不合法，資料異常`);
  }

  // 建立工單／團隊整合修正：BUSINESS_APPROVAL（申請人直屬主管簽核）的核准資格解析必須依
  // 「所選申請人」（Issue.reporterUserId），不得依「實際執行送出動作的 actor」——Admin 代
  // 申請人建立／送出 Hotfix 工單時，第 2 關必須解析申請人本人的主管，不得誤解析成 Admin 的
  // 主管（Admin 通常沒有設定直屬主管，會直接送出「找不到合格核准資格來源」）。其餘
  // approvalType（RD/QA/OP 主管簽核）的核准資格只看處理團隊 LEAD，requestedByUserId 只影響
  // 自我核准檢查與稽核追溯，維持既有語意（= 實際送出當下這一關工作的 actor），不受本次調整
  // 影響。
  let requestedByUserId = actorId;
  if (approvalType === "BUSINESS_APPROVAL") {
    const issue = await tx.issue.findUniqueOrThrow({ where: { id: issueId } });
    if (!issue.reporterUserId) {
      throw new WorkflowExecutionStateError("此工單尚未設定申請人，無法送出主管簽核");
    }
    requestedByUserId = issue.reporterUserId;
  }

  const previous = await tx.approvalRecord.findFirst({
    where: { issueId, approvalType, relatedStageKey: targetStage.stageKey, recordStatus: "ACTIVE" },
    orderBy: { revisionNo: "desc" },
  });

  const created =
    previous && (previous.decision === "REJECTED" || previous.decision === "CANCELLED")
      ? await resubmitApprovalRecord(
          {
            issueId,
            approvalType,
            relatedStageKey: targetStage.stageKey,
            requestedByUserId,
            previousApprovalRecordId: previous.id,
          },
          tx,
        )
      : await createPendingApprovalRecord(
          { issueId, approvalType, relatedStageKey: targetStage.stageKey, requestedByUserId },
          tx,
        );

  // 以既有 IssueFieldValue 保存「這次正式送出」的 append-only 快照。後續補正仍可更新
  // 當前草稿欄位，但已送出的內容會以 ApprovalRecord id 區分，不會覆蓋舊輪次。
  const submittedFields = await tx.issueFieldValue.findMany({
    where: {
      issueId,
      NOT: { fieldKey: { startsWith: "workflowSubmission:" } },
    },
    select: { fieldKey: true, fieldLabel: true, fieldValue: true },
  });
  await tx.issueFieldValue.create({
    data: {
      issueId,
      fieldKey: `workflowSubmission:${targetStage.stageKey}:${created.id}`,
      fieldLabel: "正式提交紀錄",
      fieldValue: JSON.stringify({
        submittedAt: created.requestedAt.toISOString(),
        submittedByUserId: requestedByUserId,
        values: Object.fromEntries(submittedFields.map((field) => [field.fieldKey, field.fieldValue])),
      }),
    },
  });

  await writeAuditLog(
    {
      entityType: "Issue",
      entityId: issueId,
      actionType: "ApprovalRequested",
      summary:
        targetStage.stageKey === "opCompleted"
          ? "正式環境部署紀錄已提交，建立上版後主管確認"
          : `進入關卡「${targetStage.stageKey}」，自動建立待核准紀錄`,
      actorUserId: actorId,
      reasonCode: "WORKFLOW_STAGE_ENTRY",
    },
    tx,
  );

  void created;
}
