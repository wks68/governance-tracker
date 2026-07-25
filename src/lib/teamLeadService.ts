// M1.5-B 新增：Team LEAD 設定管理服務層。
//
// 沿用既有 TeamMember 表的 membershipRole（MEMBER／LEAD），不另建 TeamLead 表。
// assignTeamLead 只把既有的啟用中成員升級為 LEAD，不會順便建立成員關係——目標必須
// 已經是該 Team 的 TeamMember。同一 Team 允許多位 LEAD，不強迫任選單一核准人。
//
// Transaction 邊界規則與 supervisorAssignmentService.ts 相同：私有 xxxTx 函式接受既有
// tx，公開函式負責開啟 prisma.$transaction。

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { resolveGovernanceAccessContext } from "./permissions";
import { writeAuditLog } from "./audit";
import { GovernanceValidationError, GovernanceStateError, GovernanceAccessDeniedError } from "./supervisorAssignmentService";

type Tx = Prisma.TransactionClient;

export interface AssignTeamLeadInput {
  teamId: string;
  userId: string;
  actorId: string;
  reasonCode: string; // 一律必填：本操作永遠是 Admin-only
}

async function assignTeamLeadTx(tx: Tx, input: AssignTeamLeadInput) {
  if (!input.teamId) throw new GovernanceValidationError(["teamId 不得為空"]);
  if (!input.userId) throw new GovernanceValidationError(["userId 不得為空"]);
  if (!input.reasonCode?.trim()) throw new GovernanceValidationError(["reasonCode 不得為空"]);

  const ctx = await resolveGovernanceAccessContext(input.actorId, tx);
  if (!ctx.canManageTeamLeads) {
    throw new GovernanceAccessDeniedError("僅具備 governance.manageTeamLeads 能力者可設定 Team LEAD");
  }

  const membership = await tx.teamMember.findFirst({ where: { teamId: input.teamId, userId: input.userId } });
  if (!membership || !membership.isActive) {
    throw new GovernanceStateError("目標必須已是該 Team 的啟用中成員，才能設為 LEAD（不會自動建立成員關係）");
  }
  if (membership.membershipRole === "LEAD") {
    throw new GovernanceStateError("此使用者已經是該 Team 的 LEAD");
  }

  const updated = await tx.teamMember.update({ where: { id: membership.id }, data: { membershipRole: "LEAD" } });

  await writeAuditLog(
    {
      entityType: "TeamMember",
      entityId: updated.id,
      actionType: "TeamLeadAssigned",
      summary: `將 Team「${input.teamId}」成員「${input.userId}」設為 LEAD`,
      actorUserId: input.actorId,
      fromValue: "MEMBER",
      toValue: "LEAD",
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function assignTeamLead(input: AssignTeamLeadInput) {
  return prisma.$transaction((tx) => assignTeamLeadTx(tx, input));
}

export interface RemoveTeamLeadInput {
  teamId: string;
  userId: string;
  actorId: string;
  reasonCode: string;
}

async function removeTeamLeadTx(tx: Tx, input: RemoveTeamLeadInput) {
  if (!input.teamId) throw new GovernanceValidationError(["teamId 不得為空"]);
  if (!input.userId) throw new GovernanceValidationError(["userId 不得為空"]);
  if (!input.reasonCode?.trim()) throw new GovernanceValidationError(["reasonCode 不得為空"]);

  const ctx = await resolveGovernanceAccessContext(input.actorId, tx);
  if (!ctx.canManageTeamLeads) {
    throw new GovernanceAccessDeniedError("僅具備 governance.manageTeamLeads 能力者可移除 Team LEAD");
  }

  const membership = await tx.teamMember.findFirst({ where: { teamId: input.teamId, userId: input.userId } });
  if (!membership || !membership.isActive) {
    throw new GovernanceStateError("目標必須是該 Team 的啟用中成員");
  }
  if (membership.membershipRole !== "LEAD") {
    throw new GovernanceStateError("此使用者目前不是該 Team 的 LEAD");
  }

  const updated = await tx.teamMember.update({ where: { id: membership.id }, data: { membershipRole: "MEMBER" } });

  await writeAuditLog(
    {
      entityType: "TeamMember",
      entityId: updated.id,
      actionType: "TeamLeadRemoved",
      summary: `將 Team「${input.teamId}」成員「${input.userId}」的 LEAD 資格移除（改為一般成員）`,
      actorUserId: input.actorId,
      fromValue: "LEAD",
      toValue: "MEMBER",
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function removeTeamLead(input: RemoveTeamLeadInput) {
  return prisma.$transaction((tx) => removeTeamLeadTx(tx, input));
}

// ---------------------------------------------------------------------------
// 查詢（row-level authorization）
// ---------------------------------------------------------------------------

// 不帶 teamId：canViewAllGovernance 回全部 Team 的 LEAD；一般使用者/Team LEAD 只回自己所屬 Team 範圍。
// 帶 teamId：該 teamId 必須在授權範圍內，否則拒絕。
export async function listTeamLeads(actorId: string, teamId?: string) {
  const ctx = await resolveGovernanceAccessContext(actorId);

  if (teamId) {
    if (!ctx.canViewAllGovernance && !ctx.memberTeamIds.includes(teamId)) {
      throw new GovernanceAccessDeniedError("只能查看自己所屬 Team 的 LEAD 名單");
    }
    return prisma.teamMember.findMany({ where: { teamId, membershipRole: "LEAD", isActive: true } });
  }

  if (ctx.canViewAllGovernance) {
    return prisma.teamMember.findMany({ where: { membershipRole: "LEAD", isActive: true } });
  }
  if (ctx.memberTeamIds.length === 0) return [];
  return prisma.teamMember.findMany({
    where: { membershipRole: "LEAD", isActive: true, teamId: { in: ctx.memberTeamIds } },
  });
}

// 整體治理視角查詢，只開放 canViewAllGovernance（Admin／資安推動小組）。
export async function listTeamsWithoutLead(actorId: string) {
  const ctx = await resolveGovernanceAccessContext(actorId);
  if (!ctx.canViewAllGovernance) {
    throw new GovernanceAccessDeniedError("僅 Admin／資安推動小組可查看整體治理視角的查詢");
  }
  const [teams, leads] = await Promise.all([
    prisma.team.findMany({}),
    prisma.teamMember.findMany({ where: { membershipRole: "LEAD", isActive: true } }),
  ]);
  const teamsWithLead = new Set(leads.map((l) => l.teamId));
  return teams.filter((t) => !teamsWithLead.has(t.id));
}
