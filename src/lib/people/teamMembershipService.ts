// C1-B3 新增：一般 Team 成員關係（MEMBER）管理服務層。
//
// 刻意不重新實作 Team LEAD 邏輯：LEAD 的指派／移除一律透過既有 src/lib/teamLeadService.ts
// （assignTeamLead／removeTeamLead），本檔案的 removeTeamMember 遇到目前是 LEAD 的成員一律
// 拒絕，要求呼叫端先呼叫 removeTeamLead 降級為 MEMBER。
//
// 核准候選人歸零判斷不得自行複製 eligibility 邏輯，一律呼叫 src/lib/approvalService.ts
// 匯出的 getEligibleApproverUserIdsInTx。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { getEligibleApproverUserIdsInTx } from "../approvalService";
import { requirePeopleCapabilityInTeamScope } from "./access";
import { assertLeadTargetIsNotSelf, assertTeamKeepsAtLeastOneLead } from "./leadScope";
import { assertReasonCodeProvided, throwIfInvalid } from "./validation";
import { PeopleNotFoundError, PeopleStateError } from "./types";
import type { AddTeamMemberInput, RemoveTeamMemberInput } from "./types";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// addTeamMember：新增或重新啟用一筆 MEMBER 身分的 TeamMember
// ---------------------------------------------------------------------------

// 匯出供 memberDirectoryService 於同一 transaction 內組合使用（授權仍在本函式內執行）。
export async function addTeamMemberTx(tx: Tx, input: AddTeamMemberInput) {
  const issues: string[] = [];
  if (!input.teamId) issues.push("teamId 不得為空");
  if (!input.userId) issues.push("userId 不得為空");
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  await requirePeopleCapabilityInTeamScope(input.actorId, "team.manageMembers", input.teamId, tx);

  const [team, target] = await Promise.all([
    tx.team.findUnique({ where: { id: input.teamId } }),
    tx.user.findUnique({ where: { id: input.userId } }),
  ]);
  if (!team) throw new PeopleNotFoundError(`找不到 Team：${input.teamId}`);
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);
  if (!target.isActive) {
    throw new PeopleStateError("目標使用者必須是 active 狀態，才能加入 Team");
  }

  const existing = await tx.teamMember.findUnique({
    where: { teamId_userId: { teamId: input.teamId, userId: input.userId } },
  });

  let membership;
  if (existing) {
    if (existing.isActive) {
      throw new PeopleStateError("此使用者已經是該 Team 的啟用中成員");
    }
    membership = await tx.teamMember.update({
      where: { id: existing.id },
      data: { isActive: true, membershipRole: "MEMBER" },
    });
  } else {
    membership = await tx.teamMember.create({
      data: { teamId: input.teamId, userId: input.userId, membershipRole: "MEMBER", isActive: true },
    });
  }

  await tx.teamMembershipHistory.create({
    data: {
      teamMemberId: membership.id,
      teamId: input.teamId,
      userId: input.userId,
      eventType: "JOINED",
      fromMembershipRole: null,
      toMembershipRole: "MEMBER",
      actorUserId: input.actorId,
      eventSource: "ADMIN_ACTION",
      reasonCode: input.reasonCode,
      effectiveAt: new Date(),
    },
  });

  await writeAuditLog(
    {
      entityType: "TeamMember",
      entityId: membership.id,
      actionType: "TeamMemberAdded",
      summary: `將使用者「${target.name}」加入 Team「${team.name}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return membership;
}

export async function addTeamMember(input: AddTeamMemberInput) {
  return prisma.$transaction((tx) => addTeamMemberTx(tx, input));
}

// ---------------------------------------------------------------------------
// removeTeamMember：軟移除（isActive=false），LEAD 必須先走 removeTeamLead，
// 且移除後不可造成任何待核准紀錄的合法候選人歸零。
// ---------------------------------------------------------------------------

async function removeTeamMemberTx(tx: Tx, input: RemoveTeamMemberInput) {
  const issues: string[] = [];
  if (!input.teamId) issues.push("teamId 不得為空");
  if (!input.userId) issues.push("userId 不得為空");
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  const grant = await requirePeopleCapabilityInTeamScope(input.actorId, "team.manageMembers", input.teamId, tx);
  if (grant === "TEAM_LEAD") assertLeadTargetIsNotSelf(input.actorId, input.userId, "移除團隊成員");
  // 不論授權來源為何，都不得讓團隊失去最後一位啟用中主管。
  await assertTeamKeepsAtLeastOneLead(tx, input.teamId, input.userId);

  const [team, target] = await Promise.all([
    tx.team.findUnique({ where: { id: input.teamId } }),
    tx.user.findUnique({ where: { id: input.userId } }),
  ]);
  if (!team) throw new PeopleNotFoundError(`找不到 Team：${input.teamId}`);
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);

  const membership = await tx.teamMember.findUnique({
    where: { teamId_userId: { teamId: input.teamId, userId: input.userId } },
  });
  if (!membership || !membership.isActive) {
    throw new PeopleStateError("此使用者目前不是該 Team 的啟用中成員");
  }
  if (membership.membershipRole === "LEAD") {
    throw new PeopleStateError("此使用者目前是該 Team 的 LEAD，請先呼叫 removeTeamLead 降級為一般成員後再移除");
  }

  const now = new Date();
  const pendingRecords = await tx.approvalRecord.findMany({
    where: { decision: "PENDING", recordStatus: "ACTIVE", approverTeamId: input.teamId },
  });
  for (const record of pendingRecords) {
    const eligibleUserIds = await getEligibleApproverUserIdsInTx(
      tx,
      { approvalType: record.approvalType, requestedByUserId: record.requestedByUserId, approverTeamId: record.approverTeamId },
      now,
    );
    if (!eligibleUserIds.includes(input.userId)) continue;
    const remaining = eligibleUserIds.filter((id) => id !== input.userId);
    if (remaining.length === 0) {
      throw new PeopleStateError(
        `移除此成員將導致待核准紀錄「${record.id}」合法候選人歸零，不得移除（請先安排其他合法核准人或代理人）`,
      );
    }
  }

  const updated = await tx.teamMember.update({ where: { id: membership.id }, data: { isActive: false } });

  await tx.teamMembershipHistory.create({
    data: {
      teamMemberId: updated.id,
      teamId: input.teamId,
      userId: input.userId,
      eventType: "REMOVED",
      fromMembershipRole: membership.membershipRole,
      toMembershipRole: null,
      actorUserId: input.actorId,
      eventSource: "ADMIN_ACTION",
      reasonCode: input.reasonCode,
      effectiveAt: now,
    },
  });

  await writeAuditLog(
    {
      entityType: "TeamMember",
      entityId: updated.id,
      actionType: "TeamMemberRemoved",
      summary: `將使用者「${target.name}」自 Team「${team.name}」移除`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function removeTeamMember(input: RemoveTeamMemberInput) {
  return prisma.$transaction((tx) => removeTeamMemberTx(tx, input));
}
