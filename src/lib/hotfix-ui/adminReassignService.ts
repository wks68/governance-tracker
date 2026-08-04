// 建立工單／團隊整合修正新增：Admin 於 Hotfix 正式送簽後（stage2 以後）調整團隊／申請人。
//
// 規則（見規格第十三節）：
// 1. 僅 Admin（active UserRole 的 admin.full 能力）可執行，一般申請人送簽後不得再自行變更
//    團隊／申請人（第 1 關／草稿階段的變更走 draftService.saveHotfixDraft，不經過本檔案）。
// 2. 必須填寫變更原因，寫入 AuditLog。
// 3. 重新驗證新團隊與新申請人（沿用 teamApplicantService 同一套驗證，不接受前端宣稱）。
// 4. 若存在 active pending ApprovalRecord（僅 BUSINESS_APPROVAL 這一關會在改派後仍是
//    pending——RD/QA/OP 主管簽核關卡的核准資格看的是「處理團隊」而非申請人，理論上不會因
//    改派申請人而需要重建；為避免臆測，這裡只處理確實因「申請人」變動而失去正確性的
//    BUSINESS_APPROVAL 這一種）：作廢舊 pending（cancelApprovalRecord），以新申請人重新解析
//    主管並建立新 pending（resubmitApprovalRecord 形成 revision 鏈），不得留下舊申請人的主管
//    仍可簽核的紀錄。
// 5. 全部在同一 transaction 內完成，任何一步失敗全部 rollback。

import { prisma } from "../prisma";
import { requireCapability } from "../permissions";
import { writeAuditLog } from "../audit";
import { assertActorCanUseTeam, assertValidApplicantForTeam } from "../team-applicant/teamApplicantService";
import { cancelApprovalRecord, resubmitApprovalRecord } from "../approvalService";
import { WorkflowExecutionStateError, WorkflowExecutionAccessDeniedError } from "../workflow-execution/types";

export async function reassignHotfixTeamApplicant(input: {
  issueId: string;
  actorId: string;
  newTeamId: string;
  newApplicantId: string;
  reasonCode: string;
}): Promise<void> {
  try {
    await requireCapability({ id: input.actorId }, "admin.full");
  } catch {
    throw new WorkflowExecutionAccessDeniedError("僅系統管理員（Admin）可調整已送簽 Hotfix 工單的團隊／申請人");
  }

  const reasonCode = input.reasonCode.trim();
  if (!reasonCode) throw new WorkflowExecutionStateError("調整團隊／申請人必須填寫原因");

  const issue = await prisma.issue.findUnique({ where: { id: input.issueId } });
  if (!issue || issue.issueType !== "Hotfix" || !issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("此工單目前無法調整團隊／申請人");
  }
  const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: issue.currentWorkflowStageId } });
  if (stage.stageKey === "draft" || stage.stageKey === "closed") {
    throw new WorkflowExecutionStateError("此階段請直接於工單頁面編輯，不需使用 Admin 改派功能");
  }

  await assertActorCanUseTeam(input.actorId, input.newTeamId);
  const applicant = await assertValidApplicantForTeam(input.newTeamId, input.newApplicantId);

  const oldTeamName = issue.assignedTeamId ? (await prisma.team.findUnique({ where: { id: issue.assignedTeamId } }))?.name : null;
  const newTeamName = (await prisma.team.findUnique({ where: { id: input.newTeamId } }))?.name ?? input.newTeamId;

  await prisma.$transaction(async (tx) => {
    const activePendingBusinessApproval = await tx.approvalRecord.findFirst({
      where: { issueId: input.issueId, approvalType: "BUSINESS_APPROVAL", recordStatus: "ACTIVE", decision: "PENDING" },
    });

    await tx.issue.update({
      where: { id: input.issueId },
      data: { assignedTeamId: input.newTeamId, reporterUserId: applicant.id, reporter: applicant.name },
    });

    if (activePendingBusinessApproval) {
      await cancelApprovalRecord(activePendingBusinessApproval.id, "ADMIN_REASSIGNED_APPLICANT", reasonCode, tx);
      await resubmitApprovalRecord(
        {
          issueId: input.issueId,
          approvalType: "BUSINESS_APPROVAL",
          relatedStageKey: activePendingBusinessApproval.relatedStageKey,
          requestedByUserId: applicant.id,
          previousApprovalRecordId: activePendingBusinessApproval.id,
        },
        tx,
      );
    }

    await writeAuditLog(
      {
        entityType: "Issue",
        entityId: input.issueId,
        actionType: "IssueApplicantTeamReassigned",
        summary: `Admin 調整團隊／申請人：團隊「${oldTeamName ?? "（未指派）"}」→「${newTeamName}」，申請人「${issue.reporter || "（空白）"}」→「${applicant.name}」，原因：${reasonCode}`,
        actorUserId: input.actorId,
        reasonCode,
      },
      tx,
    );
  });
}
