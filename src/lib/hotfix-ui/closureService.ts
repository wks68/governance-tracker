// Hotfix 九階段 UI：stage9「結案」服務層。責任角色固定是原始填單人（reporterUserId），
// 不得透過 User.role 或團隊成員身分判斷，也不會退回申請人主管——與 draftService.ts 的
// reporter-only 判斷同一原則，各自獨立一份（stage1／stage9 的合法關卡不同，不合併共用）。

import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { WorkflowExecutionAccessDeniedError, WorkflowExecutionStateError } from "../workflow-execution/types";

export const CLOSURE_SUMMARY_FIELD_KEY = "closureSummary";
export const CLOSURE_FOLLOWUP_FIELD_KEY = "closureFollowUpNotes";

const CLOSABLE_STAGE_KEYS = new Set(["pendingReporterConfirmation", "reporterConfirming"]);

async function requireClosureOwnership(issueId: string, actorId: string) {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || issue.issueType !== "Hotfix" || !issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("此工單目前無法操作結案");
  }
  const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: issue.currentWorkflowStageId } });
  if (!CLOSABLE_STAGE_KEYS.has(stage.stageKey)) {
    throw new WorkflowExecutionStateError("此工單目前不在待結案階段");
  }
  if (issue.reporterUserId !== actorId) {
    throw new WorkflowExecutionAccessDeniedError("僅原始填單人可確認結案或退回處理");
  }
  return { issue, stage };
}

export async function saveClosureSummary(input: { issueId: string; actorId: string; summary: string; followUpNotes: string }): Promise<void> {
  await requireClosureOwnership(input.issueId, input.actorId);
  await prisma.$transaction(async (tx) => {
    await tx.issueFieldValue.upsert({
      where: { issueId_fieldKey: { issueId: input.issueId, fieldKey: CLOSURE_SUMMARY_FIELD_KEY } },
      create: { issueId: input.issueId, fieldKey: CLOSURE_SUMMARY_FIELD_KEY, fieldLabel: "結案摘要", fieldValue: input.summary },
      update: { fieldValue: input.summary },
    });
    if (input.followUpNotes) {
      await tx.issueFieldValue.upsert({
        where: { issueId_fieldKey: { issueId: input.issueId, fieldKey: CLOSURE_FOLLOWUP_FIELD_KEY } },
        create: { issueId: input.issueId, fieldKey: CLOSURE_FOLLOWUP_FIELD_KEY, fieldLabel: "後續觀察追蹤結果", fieldValue: input.followUpNotes },
        update: { fieldValue: input.followUpNotes },
      });
    }
  });
  await writeAuditLog({
    entityType: "Issue",
    entityId: input.issueId,
    actionType: "FieldChange",
    summary: "填寫結案摘要／後續觀察追蹤結果",
    actorUserId: input.actorId,
  });
}

export async function loadClosureSummary(issueId: string): Promise<{ summary: string; followUpNotes: string }> {
  const rows = await prisma.issueFieldValue.findMany({ where: { issueId, fieldKey: { in: [CLOSURE_SUMMARY_FIELD_KEY, CLOSURE_FOLLOWUP_FIELD_KEY] } } });
  const map = new Map(rows.map((r) => [r.fieldKey, r.fieldValue]));
  return { summary: map.get(CLOSURE_SUMMARY_FIELD_KEY) ?? "", followUpNotes: map.get(CLOSURE_FOLLOWUP_FIELD_KEY) ?? "" };
}

// 結案頁「上版人員／QA 驗證人員」唯讀顯示：依既有 IssueWorkflowStageHistory 找出實際
// 執行對應 Transition 的 actor，純唯讀查詢，不涉及授權判斷。
export async function findStageTransitionActorName(issueId: string, actionKey: string): Promise<string> {
  const row = await prisma.issueWorkflowStageHistory.findFirst({
    where: { issueId, transition: { actionKey } },
    orderBy: { executedAt: "desc" },
  });
  if (!row) return "（未知）";
  const user = await prisma.user.findUnique({ where: { id: row.actorUserId } });
  return user?.name ?? "（未知）";
}

export { requireClosureOwnership };
