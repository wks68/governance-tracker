// M2-B 新增：TRIAGE 關卡的 Issue.assignedTeamId 指派。
//
// WorkflowStage.assignedTeamId 只是「範本預設負責 Team」提示（見 Plan Team 同步規則），
// TRIAGE 關卡的實際指派結果一律寫入 Issue.assignedTeamId，且必須經由本檔案這個唯一入口，
// 不得由 UI 或其他服務直接 tx.issue.update({ data: { assignedTeamId } })。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requireExecutionCapability, requireActorEligibleForStage } from "./access";
import { assertReasonCodeProvided, throwIfInvalid, getIssueOrThrow, getStageOrThrow } from "./validation";
import { WorkflowExecutionStateError, WorkflowExecutionNotFoundError } from "./types";
import type { SetIssueAssignedTeamAtTriageInput } from "./types";

type Tx = Prisma.TransactionClient;

async function setIssueAssignedTeamAtTriageTx(tx: Tx, input: SetIssueAssignedTeamAtTriageInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  if (!input.teamId) issues.push("teamId 不得為空");
  throwIfInvalid(issues);

  const issue = await getIssueOrThrow(tx, input.issueId);
  if (!issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow，無法指派處理團隊");
  }
  const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
  if (stage.stageType !== "TRIAGE") {
    throw new WorkflowExecutionStateError(`目前關卡「${stage.stageKey}」非 TRIAGE 類型，不得於此指派處理團隊`);
  }

  // 額外要求既有 "issue.assignTeam" 能力（M1 既有能力，語意本就是「誰能指派 Issue 處理團隊」），
  // 疊加在關卡本身的 requiredExecutionRole／requiredMembershipRole 資格之上。
  await requireExecutionCapability(input.actorId, "issue.assignTeam", tx);
  await requireActorEligibleForStage(tx, input.actorId, issue, stage);

  const team = await tx.team.findUnique({ where: { id: input.teamId } });
  if (!team) throw new WorkflowExecutionNotFoundError(`找不到 Team：${input.teamId}`);

  const previousTeam = issue.assignedTeamId ? await tx.team.findUnique({ where: { id: issue.assignedTeamId } }) : null;

  const updated = await tx.issue.update({ where: { id: issue.id }, data: { assignedTeamId: team.id } });

  await writeAuditLog(
    {
      entityType: "Issue",
      entityId: issue.id,
      actionType: "TeamReassigned",
      summary: `TRIAGE 關卡「${stage.label}」指派處理團隊：「${previousTeam?.name ?? "（未指派）"}」→「${team.name}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
      fromValue: previousTeam?.id ?? undefined,
      toValue: team.id,
    },
    tx,
  );

  return updated;
}

export async function setIssueAssignedTeamAtTriage(input: SetIssueAssignedTeamAtTriageInput) {
  return prisma.$transaction((tx) => setIssueAssignedTeamAtTriageTx(tx, input));
}
