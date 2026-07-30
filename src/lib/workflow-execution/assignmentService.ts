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

// ---------------------------------------------------------------------------
// RD/QA/OP 接單流程新增：承接團隊 Lead 指派／重新指派執行人。
//
// 執行人記錄使用既有 IssueFieldValue（依 issue 動態欄位延伸點，見 prisma/schema.prisma
// 註解與 requirementService.ts 既有 REQUIRE_FIELD 用法）保存，fieldKey 見
// hotfixDomainMap.ts；不新增 Schema。指派／重新指派一律要求 reasonCode 並寫入 AuditLog。
//
// assignIssueExecutor：僅能在 CLAIM 關卡（已接單、尚未指派）呼叫，指派後立即在同一
// transaction 內執行離開 CLAIM 的 FORWARD Transition（承接團隊 Lead 代替執行人本人送出，
// 語意等同 M2-B 原本「認領」但改為 Lead 指派而非個人自助認領）。
//
// reassignIssueExecutor：僅能在 RD／QA／OP 尚未送主管簽核的 WORK 關卡呼叫，只更新執行人
// 欄位，不移動關卡。明確 allowlist 三個執行 stageKey；核准、核准後部署與其他任何關卡皆
// fail closed，不需要額外的鎖定欄位。
// ---------------------------------------------------------------------------

import { executeIssueTransitionInTx } from "./transitionService";
import { getExecutorDomainForStageKey, executorFieldKey, executorAssignedByFieldKey, executorAssignedAtFieldKey } from "./hotfixDomainMap";
import { WorkflowExecutionAccessDeniedError } from "./types";
import { insertExecutorReassignmentHistoryRow } from "./historyService";

const REASSIGNABLE_EXECUTION_STAGE_KEYS = new Set(["rdInProgress", "qaInProgress", "opPreparing"]);
const REASSIGN_UNAUTHORIZED_MESSAGE = "只有目前承接團隊主管可重新指派執行人。";
const REASSIGN_INVALID_MEMBER_MESSAGE = "所選人員不屬於目前承接團隊，無法指派。";
const REASSIGN_INVALID_STAGE_MESSAGE = "此工單目前狀態不可重新指派執行人。";

export interface AssignableMemberInfo {
  userId: string;
  userName: string;
}

export interface AssignableMembersPreview {
  assignable: boolean; // false：目前關卡不支援指派／重新指派，或 Issue 尚未有承接團隊
  isReassignment: boolean; // true：目前在 WORK 階段重新指派；false：CLAIM 階段首次指派
  teamId: string | null;
  teamName: string | null;
  currentExecutorUserId: string | null;
  currentExecutorName: string | null;
  currentExecutorAssignedAt: string | null;
  actorIsLead: boolean;
  members: AssignableMemberInfo[];
}

async function loadExecutorFieldValue(client: Tx | typeof prisma, issueId: string, domain: ReturnType<typeof getExecutorDomainForStageKey>) {
  if (!domain) return null;
  const row = await client.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId, fieldKey: executorFieldKey(domain) } } });
  return row?.fieldValue || null;
}

export async function listAssignableMembers(issueId: string, actorId: string): Promise<AssignableMembersPreview> {
  const issue = await getIssueOrThrow(prisma, issueId);
  const empty: AssignableMembersPreview = {
    assignable: false,
    isReassignment: false,
    teamId: null,
    teamName: null,
    currentExecutorUserId: null,
    currentExecutorName: null,
    currentExecutorAssignedAt: null,
    actorIsLead: false,
    members: [],
  };
  if (!issue.currentWorkflowStageId || !issue.assignedTeamId) return empty;

  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  const domain = getExecutorDomainForStageKey(stage.stageKey);
  if (!domain) return empty;

  const team = await prisma.team.findUnique({ where: { id: issue.assignedTeamId } });
  if (!team) return empty;

  const isInitialAssignment = stage.stageType === "CLAIM";
  const isReassignment = REASSIGNABLE_EXECUTION_STAGE_KEYS.has(stage.stageKey);
  const assignable = isInitialAssignment || isReassignment;

  const [leadMembership, memberRows, currentExecutorId, assignedAtRow] = await Promise.all([
    prisma.teamMember.findFirst({ where: { teamId: team.id, userId: actorId, isActive: true, membershipRole: "LEAD" } }),
    prisma.teamMember.findMany({
      where: {
        teamId: team.id,
        isActive: true,
        user: {
          isActive: true,
          userRoles: { some: { role: domain, isActive: true } },
        },
      },
      include: { user: true },
    }),
    loadExecutorFieldValue(prisma, issueId, domain),
    prisma.issueFieldValue.findUnique({
      where: { issueId_fieldKey: { issueId, fieldKey: executorAssignedAtFieldKey(domain) } },
    }),
  ]);

  const currentExecutor = currentExecutorId ? memberRows.find((m) => m.userId === currentExecutorId) : null;

  return {
    assignable,
    isReassignment,
    teamId: team.id,
    teamName: team.name,
    currentExecutorUserId: currentExecutorId,
    currentExecutorName: currentExecutor?.user.name ?? null,
    currentExecutorAssignedAt: assignedAtRow?.fieldValue || null,
    actorIsLead: !!leadMembership,
    members: assignable ? memberRows.map((m) => ({ userId: m.userId, userName: m.user.name })) : [],
  };
}

async function requireLeadOfAssignedTeam(tx: Tx, actorId: string, teamId: string) {
  await requireExecutionCapability(actorId, "issue.edit", tx);
  const leadMembership = await tx.teamMember.findFirst({ where: { teamId, userId: actorId, isActive: true } });
  if (!leadMembership || leadMembership.membershipRole !== "LEAD") {
    throw new WorkflowExecutionAccessDeniedError("僅承接團隊的 active Team Lead 可指派／重新指派執行人");
  }
}

async function requireActiveTeamMemberExecutor(tx: Tx, teamId: string, executorUserId: string, requiredRole?: string) {
  const membership = await tx.teamMember.findFirst({ where: { teamId, userId: executorUserId, isActive: true } });
  if (!membership) {
    throw new WorkflowExecutionAccessDeniedError("指派對象必須是承接團隊的 active 成員");
  }
  const user = await tx.user.findUnique({ where: { id: executorUserId } });
  if (!user || !user.isActive) {
    throw new WorkflowExecutionAccessDeniedError("指派對象帳號不存在或已停用");
  }
  if (requiredRole) {
    const role = await tx.userRole.findFirst({ where: { userId: executorUserId, role: requiredRole, isActive: true } });
    if (!role) {
      throw new WorkflowExecutionAccessDeniedError("指派對象不具備此執行階段所需的 active 角色");
    }
  }
  return user;
}

export interface AssignIssueExecutorInput {
  issueId: string;
  executorUserId: string;
  actorId: string;
  reasonCode: string;
}

async function assignIssueExecutorTx(tx: Tx, input: AssignIssueExecutorInput) {
  const validationIssues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, validationIssues);
  if (!input.executorUserId) validationIssues.push("executorUserId 不得為空");
  throwIfInvalid(validationIssues);

  const issue = await getIssueOrThrow(tx, input.issueId);
  if (!issue.currentWorkflowStageId || !issue.assignedTeamId) {
    throw new WorkflowExecutionStateError("Issue 尚未有承接團隊，無法指派執行人");
  }
  const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
  if (stage.stageType !== "CLAIM") {
    throw new WorkflowExecutionStateError(`目前關卡「${stage.stageKey}」非「已接單待指派」關卡，請改用重新指派`);
  }
  const domain = getExecutorDomainForStageKey(stage.stageKey);
  if (!domain) throw new WorkflowExecutionStateError(`目前關卡「${stage.stageKey}」不支援指派執行人`);

  await requireLeadOfAssignedTeam(tx, input.actorId, issue.assignedTeamId);
  const executorUser = await requireActiveTeamMemberExecutor(tx, issue.assignedTeamId, input.executorUserId, domain);

  const now = new Date().toISOString();
  await tx.issueFieldValue.upsert({
    where: { issueId_fieldKey: { issueId: issue.id, fieldKey: executorFieldKey(domain) } },
    create: { issueId: issue.id, fieldKey: executorFieldKey(domain), fieldLabel: "指派執行人", fieldValue: input.executorUserId },
    update: { fieldValue: input.executorUserId },
  });
  await tx.issueFieldValue.upsert({
    where: { issueId_fieldKey: { issueId: issue.id, fieldKey: executorAssignedByFieldKey(domain) } },
    create: { issueId: issue.id, fieldKey: executorAssignedByFieldKey(domain), fieldLabel: "指派主管", fieldValue: input.actorId },
    update: { fieldValue: input.actorId },
  });
  await tx.issueFieldValue.upsert({
    where: { issueId_fieldKey: { issueId: issue.id, fieldKey: executorAssignedAtFieldKey(domain) } },
    create: { issueId: issue.id, fieldKey: executorAssignedAtFieldKey(domain), fieldLabel: "指派時間", fieldValue: now },
    update: { fieldValue: now },
  });

  await writeAuditLog(
    {
      entityType: "Issue",
      entityId: issue.id,
      actionType: "IssueExecutorAssigned",
      summary: `指派 ${domain} 執行人：「${executorUser.name}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
      toValue: input.executorUserId,
    },
    tx,
  );

  const forwardTransition = await tx.workflowTransition.findFirst({ where: { fromStageId: stage.id, transitionType: "FORWARD" } });
  if (!forwardTransition) {
    throw new WorkflowExecutionStateError(`關卡「${stage.stageKey}」沒有可用的 FORWARD Transition，資料異常`);
  }
  return executeIssueTransitionInTx(tx, {
    issueId: issue.id,
    transitionId: forwardTransition.id,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
  });
}

export async function assignIssueExecutor(input: AssignIssueExecutorInput) {
  return prisma.$transaction((tx) => assignIssueExecutorTx(tx, input));
}

export interface ReassignIssueExecutorInput {
  issueId: string;
  executorUserId: string;
  actorId: string;
  reasonCode: string;
}

async function reassignIssueExecutorTx(tx: Tx, input: ReassignIssueExecutorInput) {
  const validationIssues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, validationIssues);
  throwIfInvalid(validationIssues);
  if (!input.executorUserId) {
    throw new WorkflowExecutionAccessDeniedError(REASSIGN_INVALID_MEMBER_MESSAGE);
  }

  const issue = await getIssueOrThrow(tx, input.issueId);
  if (!issue.currentWorkflowStageId || !issue.assignedTeamId) {
    throw new WorkflowExecutionStateError(REASSIGN_INVALID_STAGE_MESSAGE);
  }
  const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
  const domain = getExecutorDomainForStageKey(stage.stageKey);
  if (!domain || !REASSIGNABLE_EXECUTION_STAGE_KEYS.has(stage.stageKey)) {
    throw new WorkflowExecutionStateError(REASSIGN_INVALID_STAGE_MESSAGE);
  }

  try {
    await requireLeadOfAssignedTeam(tx, input.actorId, issue.assignedTeamId);
  } catch (err) {
    if (err instanceof WorkflowExecutionAccessDeniedError) {
      throw new WorkflowExecutionAccessDeniedError(REASSIGN_UNAUTHORIZED_MESSAGE);
    }
    throw err;
  }

  const executorUser = await requireActiveTeamMemberExecutor(tx, issue.assignedTeamId, input.executorUserId, domain).catch((err: unknown) => {
    if (err instanceof WorkflowExecutionAccessDeniedError) {
      throw new WorkflowExecutionAccessDeniedError(REASSIGN_INVALID_MEMBER_MESSAGE);
    }
    throw err;
  });

  const previousExecutorId = await loadExecutorFieldValue(tx, issue.id, domain);
  if (!previousExecutorId) {
    throw new WorkflowExecutionStateError(REASSIGN_INVALID_STAGE_MESSAGE);
  }
  if (previousExecutorId === input.executorUserId) {
    return {
      issue: await tx.issue.findUniqueOrThrow({ where: { id: issue.id } }),
      executorName: executorUser.name,
      changed: false,
    };
  }

  const previousExecutor = await tx.user.findUnique({ where: { id: previousExecutorId } });
  const executedAt = new Date();
  const now = executedAt.toISOString();
  await tx.issueFieldValue.update({
    where: { issueId_fieldKey: { issueId: issue.id, fieldKey: executorFieldKey(domain) } },
    data: { fieldValue: input.executorUserId },
  });
  await tx.issueFieldValue.upsert({
    where: { issueId_fieldKey: { issueId: issue.id, fieldKey: executorAssignedByFieldKey(domain) } },
    create: { issueId: issue.id, fieldKey: executorAssignedByFieldKey(domain), fieldLabel: "指派主管", fieldValue: input.actorId },
    update: { fieldValue: input.actorId },
  });
  await tx.issueFieldValue.upsert({
    where: { issueId_fieldKey: { issueId: issue.id, fieldKey: executorAssignedAtFieldKey(domain) } },
    create: { issueId: issue.id, fieldKey: executorAssignedAtFieldKey(domain), fieldLabel: "指派時間", fieldValue: now },
    update: { fieldValue: now },
  });

  await writeAuditLog(
    {
      entityType: "Issue",
      entityId: issue.id,
      actionType: "IssueExecutorReassigned",
      summary: `重新指派 ${domain} 執行人：「${previousExecutor?.name ?? "原執行人"}」→「${executorUser.name}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
      fromValue: previousExecutorId,
      toValue: input.executorUserId,
    },
    tx,
  );

  await insertExecutorReassignmentHistoryRow(tx, {
    issueId: issue.id,
    stageId: stage.id,
    actorUserId: input.actorId,
    reasonCode: input.reasonCode,
    assignedTeamId: issue.assignedTeamId,
    executedAt,
  });

  return {
    issue: await tx.issue.findUniqueOrThrow({ where: { id: issue.id } }),
    executorName: executorUser.name,
    changed: true,
  };
}

export async function reassignIssueExecutor(input: ReassignIssueExecutorInput) {
  return prisma.$transaction((tx) => reassignIssueExecutorTx(tx, input));
}

// ---------------------------------------------------------------------------
// 供 access.ts／pageContext.ts 判斷「目前這個 actor 是不是這一輪的指派執行人」使用。
// ---------------------------------------------------------------------------

export async function getCurrentExecutorUserId(client: Tx | typeof prisma, issueId: string, stageKey: string): Promise<string | null> {
  const domain = getExecutorDomainForStageKey(stageKey);
  if (!domain) return null;
  return loadExecutorFieldValue(client, issueId, domain);
}

// 真正的信任邊界：供 WORK／DEPLOYMENT／CONFIRMATION 關卡的實際寫入入口（欄位填寫、送主管
// 核准、上版結果延續動作）呼叫，確保「其他 RD/QA/OP 人員只能唯讀」不只是 UI 隱藏按鈕，
// 而是服務層真的拒絕。非執行人專屬關卡（stageKey 不在 hotfixDomainMap 範圍內）視為不受此
// 限制，交由呼叫端既有的 evaluateActorEligibilityForStage 團隊成員檢查把關。
export async function assertActorIsCurrentExecutor(client: Tx | typeof prisma, issueId: string, actorId: string, stageKey: string): Promise<void> {
  const domain = getExecutorDomainForStageKey(stageKey);
  if (!domain) return;
  const executorUserId = await loadExecutorFieldValue(client, issueId, domain);
  if (!executorUserId) {
    throw new WorkflowExecutionAccessDeniedError("此關卡尚未指派執行人，請先由承接團隊 Lead 指派");
  }
  if (executorUserId !== actorId) {
    throw new WorkflowExecutionAccessDeniedError("僅指派執行人本人可在此關卡填寫／送出，其他人員唯讀");
  }
}
