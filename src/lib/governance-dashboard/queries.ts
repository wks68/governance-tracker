// 治理儀表板 MVP 新增：唯讀查詢與正規化。
//
// 一律以 Prisma 查詢＋記憶體運算完成，不拼接原始 SQL 字串。所有欄位皆從 Plan 第三節
// 列出的正式來源現場推導：
//   - 舊制／新版判斷：Issue.workflowVersionId（沿用 src/lib/workflow/compatibility.ts
//     isIssueOnVersionedWorkflow 的同一條件，本檔案不重新定義）。
//   - 目前階段：Issue.currentWorkflowStageId → WorkflowStage。
//   - 完成／取消：WorkflowStage.isEnd／terminalOutcome（正式 terminal outcome 欄位），
//     不看任何顯示文字或 workflowStatus。
//   - 目前階段停留天數：IssueWorkflowStageHistory 中 exitedAt 為 null 的「目前開放列」
//     的 executedAt，不使用 Issue.stageEnteredAt（M1 相容欄位，不在正式來源清單內）。
//   - RETURN 次數／退回階段：IssueWorkflowStageHistory.transitionType === "RETURNED"。
//   - 待核准：ApprovalRecord（decision=PENDING 且 recordStatus=ACTIVE）。
//   - 風險：StageRiskCheck.answer（YES／UNKNOWN／null=尚未回答）。
//   - Team 負載：Issue.assignedTeamId。

import { prisma } from "../prisma";
import { requireGovernanceDashboardAccess } from "./access";
import type { GovernanceIssueRow, GovernanceLifecycleStatus, GovernanceRiskStatus, GovernanceStageRef } from "./types";

async function fetchOpenHistoryRows(issueIds: string[]) {
  if (issueIds.length === 0) return new Map<string, Date>();
  const rows = await prisma.issueWorkflowStageHistory.findMany({
    where: { issueId: { in: issueIds }, exitedAt: null },
    select: { issueId: true, executedAt: true },
  });
  const map = new Map<string, Date>();
  for (const row of rows) {
    // deny-by-default 防禦：理論上每筆 Issue 只會有一筆開放列；若資料異常出現多筆，
    // 取「最新」的一筆作為目前關卡進入時間，避免用到已經過期的舊開放列低估停留天數。
    const existing = map.get(row.issueId);
    if (!existing || row.executedAt.getTime() > existing.getTime()) {
      map.set(row.issueId, row.executedAt);
    }
  }
  return map;
}

function toStageRef(stage: {
  id: string;
  stageKey: string;
  label: string;
  stageType: string;
  assignedTeamId: string | null;
  assignedTeam: { id: string; name: string } | null;
}): GovernanceStageRef {
  return {
    id: stage.id,
    stageKey: stage.stageKey,
    label: stage.label,
    stageType: stage.stageType,
    assignedTeamId: stage.assignedTeamId,
    assignedTeamName: stage.assignedTeam?.name ?? null,
  };
}

function deriveLifecycleStatus(issue: {
  workflowVersionId: string | null;
  currentWorkflowStage: { isEnd: boolean; terminalOutcome: string | null } | null;
}): GovernanceLifecycleStatus {
  if (issue.workflowVersionId === null) return "LEGACY";
  if (!issue.currentWorkflowStage) return "NOT_STARTED";
  if (!issue.currentWorkflowStage.isEnd) return "IN_PROGRESS";
  return issue.currentWorkflowStage.terminalOutcome === "CANCELLED" ? "CANCELLED" : "COMPLETED";
}

// 風險狀態採「最嚴重者優先」聚合：YES > UNKNOWN > UNANSWERED（已建立但尚未填答）；
// 若完全沒有 StageRiskCheck 紀錄，或所有紀錄皆已填答 NO，一律視為 NONE（無需注意的
// 風險狀態）——NONE 亦是 Plan 第七節「尚無風險紀錄」空狀態的判斷依據。
function deriveRiskStatus(riskChecks: { answer: string | null }[]): GovernanceRiskStatus {
  if (riskChecks.some((c) => c.answer === "YES")) return "YES";
  if (riskChecks.some((c) => c.answer === "UNKNOWN")) return "UNKNOWN";
  if (riskChecks.some((c) => c.answer === null)) return "UNANSWERED";
  return "NONE";
}

export async function getVisibleGovernanceIssueRows(actorId: string): Promise<GovernanceIssueRow[]> {
  await requireGovernanceDashboardAccess(actorId);

  const issues = await prisma.issue.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      currentWorkflowStage: { include: { assignedTeam: true } },
      workflowVersion: { include: { workflowDefinition: true } },
      assignedTeam: true,
      workflowStageHistory: {
        where: { transitionType: "RETURNED" },
        include: { toStage: true, fromStage: true },
        orderBy: { executedAt: "asc" },
      },
      approvalRecords: { where: { decision: "PENDING", recordStatus: "ACTIVE" }, select: { id: true } },
      stageRiskChecks: { select: { answer: true } },
    },
  });

  const openHistoryByIssueId = await fetchOpenHistoryRows(issues.map((i) => i.id));
  const now = Date.now();

  return issues.map((issue) => {
    const lifecycleStatus = deriveLifecycleStatus(issue);
    const currentStage = issue.currentWorkflowStage ? toStageRef(issue.currentWorkflowStage) : null;

    let dwellDays: number | null = null;
    if (lifecycleStatus === "IN_PROGRESS") {
      const enteredAt = openHistoryByIssueId.get(issue.id);
      if (enteredAt) {
        dwellDays = Math.floor((now - enteredAt.getTime()) / 86_400_000);
      }
    }

    const returnEvents = issue.workflowStageHistory.map((h) => ({
      toStageId: h.toStageId,
      toStageLabel: h.toStage.label,
      fromStageId: h.fromStageId,
      fromStageLabel: h.fromStage?.label ?? null,
      executedAt: h.executedAt,
    }));

    const row: GovernanceIssueRow = {
      id: issue.id,
      issueKey: issue.issueKey,
      title: issue.title,
      issueType: issue.issueType,
      createdAt: issue.createdAt,
      assignedTeamId: issue.assignedTeamId,
      assignedTeamName: issue.assignedTeam?.name ?? null,
      workflowDefinition: issue.workflowVersion
        ? {
            id: issue.workflowVersion.workflowDefinition.id,
            key: issue.workflowVersion.workflowDefinition.key,
            name: issue.workflowVersion.workflowDefinition.name,
            issueType: issue.workflowVersion.workflowDefinition.issueType,
          }
        : null,
      lifecycleStatus,
      currentStage,
      dwellDays,
      returnEvents,
      returnCount: returnEvents.length,
      pendingApproval: issue.approvalRecords.length > 0,
      riskStatus: deriveRiskStatus(issue.stageRiskChecks),
    };
    return row;
  });
}
