// RD/QA/OP 接單流程新增：TRIAGE 關卡的「團隊接單」（取代 M2-B 原本單一授權者
// setIssueAssignedTeamAtTriage 的指派模型）。
//
// 接單資格（見任務指示，不得放寬）：
//   1. active User。
//   2. 具備基本 "issue.edit" 能力（deny-by-default 的帳號啟用門檻，比照既有 WORK/CLAIM
//      關卡的兩層授權模式：baseline capability + 結構性資格）。
//   3. active TeamMember，membershipRole=LEAD。
//   4. 該 Team.domain 與目前關卡要求的領域相符（見 hotfixDomainMap.ts）。
//   5. 不支援代理人（正式代理模型尚未建立，見 Team.domain checkpoint 回報）。
//   6. 不得因 Admin／DMS主管等角色能力自動取得資格——即使該角色持有 "issue.assignTeam"
//      之類的能力，仍必須實際是該 Team 的 active LEAD 才能接單。
//
// 併發控制：與 M2-B 既有 Transition 引擎相同的信任邊界模式——一律在 transaction 內重新
// 讀取 Issue、重新確認 assignedTeamId 仍為 null、重新驗證 actor／Team 資格，靠
// Prisma/SQLite 單一寫入者序列化 + 交易內現場重查，不需要額外的樂觀鎖版本欄位（同一原因
// 已在 transitionService.ts 開頭註解說明過）。第一個成功寫入 assignedTeamId 的
// transaction 提交後，第二個交易重新讀取到的 assignedTeamId 已非 null，fail closed。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import type { TeamDomain } from "../constants";
import { requireExecutionCapability } from "./access";
import { getIssueOrThrow, getStageOrThrow, assertReasonCodeProvided, throwIfInvalid } from "./validation";
import { executeIssueTransitionInTx } from "./transitionService";
import { getClaimDomainForStageKey } from "./hotfixDomainMap";
import { WorkflowExecutionStateError, WorkflowExecutionAccessDeniedError, WorkflowExecutionNotFoundError } from "./types";

type Tx = Prisma.TransactionClient;
type Client = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// 唯讀預覽：不具授權效力，僅供 UI 顯示可接單團隊清單／已接單團隊名稱。
// ---------------------------------------------------------------------------

export interface ClaimableTeamInfo {
  teamId: string;
  teamName: string;
  actorIsEligibleLead: boolean;
}

export interface ClaimableStagePreview {
  claimable: boolean; // false：目前關卡非 TRIAGE 可接單關卡，或已被接單
  domain: TeamDomain | null;
  alreadyClaimedTeamName: string | null;
  teams: ClaimableTeamInfo[];
}

export async function listClaimableTeamsForStage(issueId: string, actorId: string): Promise<ClaimableStagePreview> {
  const issue = await getIssueOrThrow(prisma, issueId);
  if (!issue.currentWorkflowStageId) {
    return { claimable: false, domain: null, alreadyClaimedTeamName: null, teams: [] };
  }
  const stage = await getStageOrThrow(prisma, issue.currentWorkflowStageId);
  const domain = getClaimDomainForStageKey(stage.stageKey);
  if (!domain) {
    return { claimable: false, domain: null, alreadyClaimedTeamName: null, teams: [] };
  }

  if (issue.assignedTeamId) {
    const team = await prisma.team.findUnique({ where: { id: issue.assignedTeamId } });
    return { claimable: false, domain, alreadyClaimedTeamName: team?.name ?? "（未知團隊）", teams: [] };
  }

  const teams = await prisma.team.findMany({ where: { domain }, orderBy: { name: "asc" } });
  const memberships = await prisma.teamMember.findMany({
    where: { userId: actorId, isActive: true, membershipRole: "LEAD", teamId: { in: teams.map((t) => t.id) } },
  });
  const eligibleTeamIds = new Set(memberships.map((m) => m.teamId));

  return {
    claimable: true,
    domain,
    alreadyClaimedTeamName: null,
    teams: teams.map((t) => ({ teamId: t.id, teamName: t.name, actorIsEligibleLead: eligibleTeamIds.has(t.id) })),
  };
}

// ---------------------------------------------------------------------------
// 資格判斷（DB 版本，可在 transaction 內或外呼叫；真正的信任邊界仍是
// claimIssueForTeamTx 內部在自己的 transaction 內重新呼叫本函式，不信任任何呼叫端
// 事先算好的結果）。
// ---------------------------------------------------------------------------

export interface ClaimEligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export async function evaluateClaimEligibility(
  client: Client,
  actorId: string,
  teamId: string,
  requiredDomain: TeamDomain,
): Promise<ClaimEligibilityResult> {
  const reasons: string[] = [];

  const user = await client.user.findUnique({ where: { id: actorId } });
  if (!user || !user.isActive) {
    return { eligible: false, reasons: ["帳號不存在或已停用"] };
  }

  const team = await client.team.findUnique({ where: { id: teamId } });
  if (!team) return { eligible: false, reasons: ["找不到此團隊"] };
  if (team.domain !== requiredDomain) {
    reasons.push(`團隊領域為「${team.domain ?? "未分類"}」，需要「${requiredDomain}」`);
  }

  const membership = await client.teamMember.findFirst({ where: { teamId, userId: actorId, isActive: true } });
  if (!membership || membership.membershipRole !== "LEAD") {
    reasons.push("僅該團隊 active Team Lead 可接單（代理功能尚未開放）");
  }

  return { eligible: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// 接單（信任邊界核心）
// ---------------------------------------------------------------------------

export interface ClaimIssueForTeamInput {
  issueId: string;
  teamId: string;
  actorId: string;
  reasonCode: string;
}

async function claimIssueForTeamTx(tx: Tx, input: ClaimIssueForTeamInput) {
  const validationIssues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, validationIssues);
  if (!input.teamId) validationIssues.push("teamId 不得為空");
  throwIfInvalid(validationIssues);

  // 1. 重新讀取 Issue
  const issue = await getIssueOrThrow(tx, input.issueId);
  if (!issue.currentWorkflowStageId) {
    throw new WorkflowExecutionStateError("Issue 尚未啟動 Workflow，無法接單");
  }

  // 2. 確認 current stage 為可接單（TRIAGE）關卡
  const stage = await getStageOrThrow(tx, issue.currentWorkflowStageId);
  const domain = getClaimDomainForStageKey(stage.stageKey);
  if (!domain) {
    throw new WorkflowExecutionStateError(`目前關卡「${stage.stageKey}」不是可接單關卡`);
  }

  // 3. 確認 assignedTeamId 仍為 null（併發防護的核心：第二個交易在此會看到已非 null）
  if (issue.assignedTeamId) {
    const existingTeam = await tx.team.findUnique({ where: { id: issue.assignedTeamId } });
    throw new WorkflowExecutionStateError(`此工單已由其他團隊承接（${existingTeam?.name ?? "未知團隊"}）。`);
  }

  // 4. 確認 actor 與 Team 仍合格（baseline capability + 結構性 LEAD／領域資格）
  await requireExecutionCapability(input.actorId, "issue.edit", tx);
  const eligibility = await evaluateClaimEligibility(tx, input.actorId, input.teamId, domain);
  if (!eligibility.eligible) {
    throw new WorkflowExecutionAccessDeniedError(`不具備接單資格：${eligibility.reasons.join("; ")}`);
  }
  const team = await tx.team.findUnique({ where: { id: input.teamId } });
  if (!team) throw new WorkflowExecutionNotFoundError(`找不到團隊：${input.teamId}`);

  // 5. 寫入 assignedTeam
  await tx.issue.update({ where: { id: issue.id }, data: { assignedTeamId: team.id } });

  // 6. 寫入 History：緊接著在同一 transaction 內執行離開 TRIAGE 的 FORWARD Transition，
  //    由 transitionService 既有邏輯負責 insertStageHistoryRow（assignedTeamIdBefore=null，
  //    assignedTeamIdAfter=team.id）。
  const forwardTransition = await tx.workflowTransition.findFirst({
    where: { fromStageId: stage.id, transitionType: "FORWARD" },
  });
  if (!forwardTransition) {
    throw new WorkflowExecutionStateError(`關卡「${stage.stageKey}」沒有可用的 FORWARD Transition，資料異常`);
  }
  const result = await executeIssueTransitionInTx(tx, {
    issueId: issue.id,
    transitionId: forwardTransition.id,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
  });

  // 7. 寫入 AuditLog（額外一筆專屬「接單」事件，與 Transition 本身的
  //    IssueWorkflowAdvanced 稽核紀錄分開，方便日後單獨檢索「誰在什麼時候讓哪個團隊接了單」）。
  await writeAuditLog(
    {
      entityType: "Issue",
      entityId: issue.id,
      actionType: "IssueClaimedByTeam",
      summary: `團隊「${team.name}」接單，承接關卡「${stage.label}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
      toValue: team.id,
    },
    tx,
  );

  return result;
}

export async function claimIssueForTeam(input: ClaimIssueForTeamInput) {
  return prisma.$transaction((tx) => claimIssueForTeamTx(tx, input));
}
