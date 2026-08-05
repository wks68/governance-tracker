// RCA 條件式管理階層確認（第七階段）：唯一允許判斷「此筆 RCA 是否需要 DMS 副部長／部長
// 確認」的地方，比照任務規格第十六節：
//   - 正式事件等級只有 高／中／低（沒有第四級「重大」）。
//   - 低／中：一般不升級至副部長／部長，直接視為本關卡通過。
//   - 高：一律升級至 DMS 副部長（MANAGEMENT_VP）確認。
//   - 進一步升級至 DMS 部長（MANAGEMENT_DIRECTOR）僅在資安推動小組於完整性審查時，
//     依任務規格第十六節條件（跨單位廣泛營運影響／對外或客戶可見／法遵或個資通報義務／
//     高稽核關注／高風險例外／經指定須經部長／符合程序4.7.3其他條件）判定為「是」時才需要
//     （見 rcaDirectorEscalationRequired IssueFieldValue，由
//     rcaAssignmentService.decideRcaSecurityIntegrityReview 寫入）。
//   - 副部長確認 → 部長核准為序列關係（副部長先決議，部長才開始），駁回需附原因。
//
// 本關卡（pendingManagementConfirmation）在 buildRcaWorkflowV1.ts 中是單一 REVIEW 型別
// WorkflowStage，不使用「進入 APPROVAL 關卡自動建立 ApprovalRecord」的通用機制（因為是否
// 建立、建立幾筆都是條件式的）；改由本檔案在進入本關卡後，第一次被查詢／操作時，動態建立
// 所需的 RCA_VP_CONFIRMATION（必要時再加 RCA_DIRECTOR_APPROVAL）ApprovalRecord，
// 或在完全不需要時直接視為「本關卡已無待處理項目」，由呼叫端（RCA 詳情頁載入或送出動作）
// 自動前進到下一關（改善措施執行）。

import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { createPendingApprovalRecord } from "../approvalService";
import { writeAuditLog } from "../audit";
import { executeIssueTransition } from "../workflow-execution/transitionService";
import { WorkflowExecutionStateError } from "../workflow-execution/types";

type Tx = Prisma.TransactionClient;

async function readField(client: Tx | typeof prisma, issueId: string, fieldKey: string): Promise<string | null> {
  const row = await client.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId, fieldKey } } });
  return row?.fieldValue || null;
}

export interface RcaManagementConfirmationRequirement {
  required: boolean;
  vpRequired: boolean;
  directorRequired: boolean;
  advancedAutomatically: boolean;
}

export interface EvaluateRcaManagementConfirmationRequirementInput {
  issueId: string;
  stageId: string;
  actorId: string;
  reasonCode: string;
}

export async function evaluateRcaManagementConfirmationRequirement(
  input: EvaluateRcaManagementConfirmationRequirementInput,
): Promise<RcaManagementConfirmationRequirement> {
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: input.issueId } });
  const severity = (await readField(prisma, issue.id, "rcaSourceIncidentSeverity")) ?? issue.riskLevel ?? null;
  const vpRequired = severity === "高";

  if (!vpRequired) {
    return advanceWithoutManagementConfirmation(input);
  }

  const existingVp = await prisma.approvalRecord.findFirst({
    where: { issueId: issue.id, approvalType: "RCA_VP_CONFIRMATION", relatedStageKey: "pendingManagementConfirmation" },
  });
  if (!existingVp) {
    await createPendingApprovalRecord({
      issueId: issue.id,
      approvalType: "RCA_VP_CONFIRMATION",
      relatedStageKey: "pendingManagementConfirmation",
      requestedByUserId: input.actorId,
    });
    await writeAuditLog({
      entityType: "Issue",
      entityId: issue.id,
      actionType: "ApprovalRequested",
      summary: "建立 DMS 副部長確認核准紀錄（正式事件等級為高）",
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    });
  }

  const directorRequired = (await readField(prisma, issue.id, "rcaDirectorEscalationRequired")) === "是";
  const vpDecided = await prisma.approvalRecord.findFirst({
    where: { issueId: issue.id, approvalType: "RCA_VP_CONFIRMATION", relatedStageKey: "pendingManagementConfirmation", decision: "APPROVED" },
  });
  if (directorRequired && vpDecided) {
    const existingDirector = await prisma.approvalRecord.findFirst({
      where: { issueId: issue.id, approvalType: "RCA_DIRECTOR_APPROVAL", relatedStageKey: "pendingManagementConfirmation" },
    });
    if (!existingDirector) {
      await createPendingApprovalRecord({
        issueId: issue.id,
        approvalType: "RCA_DIRECTOR_APPROVAL",
        relatedStageKey: "pendingManagementConfirmation",
        requestedByUserId: input.actorId,
      });
      await writeAuditLog({
        entityType: "Issue",
        entityId: issue.id,
        actionType: "ApprovalRequested",
        summary: "建立 DMS 部長核准紀錄（符合升級部長之額外條件）",
        actorUserId: input.actorId,
        reasonCode: input.reasonCode,
      });
    }
  }

  return { required: true, vpRequired: true, directorRequired, advancedAutomatically: false };
}

async function advanceWithoutManagementConfirmation(
  input: EvaluateRcaManagementConfirmationRequirementInput,
): Promise<RcaManagementConfirmationRequirement> {
  const transition = await prisma.workflowTransition.findFirst({ where: { fromStageId: input.stageId, transitionType: "FORWARD" } });
  if (!transition) throw new WorkflowExecutionStateError("此關卡沒有可用的 FORWARD Transition，資料異常");
  await executeIssueTransition({
    issueId: input.issueId,
    transitionId: transition.id,
    actorId: input.actorId,
    reasonCode: input.reasonCode || "RCA_MANAGEMENT_CONFIRMATION_NOT_REQUIRED",
  });
  return { required: false, vpRequired: false, directorRequired: false, advancedAutomatically: true };
}
