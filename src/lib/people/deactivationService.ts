// C1-B4 新增：人員停用治理服務層（getUserDeactivationImpact／checkUserDeactivationImpact／
// deactivatePerson）。
//
// 核准候選人歸零判斷一律呼叫 src/lib/approvalService.ts 匯出的
// getEligibleApproverUserIdsInTx，不得另行複製 eligibility 邏輯。演算法（見 Plan）：
//   1. 解析目前全部合法候選人。
//   2. 判斷 target 是否為候選人。
//   3. 排除 target。
//   4. 重新解析剩餘候選人。
//   5. 剩餘為零才 blocking。
// 不得只判斷 expectedApproverUserId === userId。

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { isWithinHalfOpenWindow } from "../timeWindow";
import { isClosed } from "../workflow";
import { getEligibleApproverUserIdsInTx } from "../approvalService";
import { requirePeopleCapability, requirePeopleCapabilityInTeamScope } from "./access";
import { assertLeadTargetInTeam, assertLeadTargetIsNotAnotherLead, assertLeadTargetIsNotSelf, assertTeamKeepsAtLeastOneLead } from "./leadScope";
import { assertReasonCodeProvided, throwIfInvalid } from "./validation";
import { PeopleNotFoundError, PeopleStateError } from "./types";
import type { DeactivationImpactItem, GetUserDeactivationImpactInput, DeactivatePersonInput } from "./types";

type Tx = Prisma.TransactionClient;
type Client = PrismaClient | Tx;

// ---------------------------------------------------------------------------
// 影響分析：純粹「讀」，供 getUserDeactivationImpact（預覽）與 deactivatePerson
// （transaction 內重新確認）共用同一套邏輯，避免兩處判斷結果不一致。
// ---------------------------------------------------------------------------

async function collectDeactivationImpact(client: Client, userId: string, now: Date = new Date()): Promise<DeactivationImpactItem[]> {
  const target = await client.user.findUnique({ where: { id: userId } });
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${userId}`);

  const items: DeactivationImpactItem[] = [];

  // ---- Blocking：active Team LEAD ----
  const ledMemberships = await client.teamMember.findMany({ where: { userId, membershipRole: "LEAD", isActive: true } });
  for (const m of ledMemberships) {
    items.push({
      severity: "blocking",
      blocking: true,
      category: "teamLead",
      message: `此人員目前是 Team「${m.teamId}」的 LEAD，停用前必須先移除或改派 LEAD`,
      relatedEntityId: m.teamId,
      suggestedAction: "先使用 removeTeamLead／assignTeamLead 移除或改派此 Team 的 LEAD",
    });
  }

  // ---- Blocking：active primary supervisor（目前正在管理他人） ----
  const supervisedAssignments = await client.userSupervisorAssignment.findMany({
    where: { supervisorUserId: userId, isActive: true, isPrimary: true },
  });
  for (const a of supervisedAssignments) {
    if (isWithinHalfOpenWindow(a.validFrom, a.validUntil, now)) {
      items.push({
        severity: "blocking",
        blocking: true,
        category: "supervisor",
        message: `此人員目前是使用者「${a.userId}」的直屬主管，停用前必須先更換主管`,
        relatedEntityId: a.id,
        suggestedAction: "先使用 replaceSupervisorAssignment 更換此人員名下的直屬主管指派",
      });
    }
  }

  // ---- Blocking：active delegation delegator（委任來源） ----
  const asDelegator = await client.approvalDelegation.findMany({ where: { delegatorUserId: userId, isActive: true } });
  for (const d of asDelegator) {
    if (isWithinHalfOpenWindow(d.validFrom, d.validUntil, now)) {
      items.push({
        severity: "blocking",
        blocking: true,
        category: "delegationDelegator",
        message: "此人員目前委任他人代理核准（委任來源），停用前必須先撤銷此代理委任",
        relatedEntityId: d.id,
        suggestedAction: "先撤銷此代理委任",
      });
    }
  }

  // ---- Blocking：active delegation delegate（代理人） ----
  const asDelegate = await client.approvalDelegation.findMany({ where: { delegateUserId: userId, isActive: true } });
  for (const d of asDelegate) {
    if (isWithinHalfOpenWindow(d.validFrom, d.validUntil, now)) {
      items.push({
        severity: "blocking",
        blocking: true,
        category: "delegationDelegate",
        message: "此人員目前是他人的有效代理人，停用前必須先撤銷此代理委任",
        relatedEntityId: d.id,
        suggestedAction: "先撤銷此代理委任",
      });
    }
  }

  // ---- Blocking：最後一位有效 Admin ----
  if (target.isActive) {
    const activeAdminRole = await client.userRole.findFirst({ where: { userId, role: "Admin", isActive: true } });
    if (activeAdminRole) {
      const otherActiveAdmins = await client.userRole.count({
        where: { role: "Admin", isActive: true, userId: { not: userId }, user: { isActive: true } },
      });
      if (otherActiveAdmins === 0) {
        items.push({
          severity: "blocking",
          blocking: true,
          category: "lastAdmin",
          message: "此人員是目前唯一有效的 Admin，停用前必須先指派至少一位其他 Admin",
          relatedEntityId: activeAdminRole.id,
          suggestedAction: "先指派另一位使用者為 Admin",
        });
      }
    }
  }

  // ---- Blocking：最後一位 active Break-glass Admin ----
  if (target.isActive && target.isBreakGlassAdmin) {
    const otherBreakGlass = await client.user.count({
      where: { isBreakGlassAdmin: true, isActive: true, id: { not: userId } },
    });
    if (otherBreakGlass === 0) {
      items.push({
        severity: "blocking",
        blocking: true,
        category: "lastBreakGlassAdmin",
        message: "此人員是目前唯一 active 的 Break-glass Admin，停用前必須先安排另一位 Break-glass Admin",
        relatedEntityId: null,
        suggestedAction: "先安排另一位使用者作為 Break-glass Admin",
      });
    }
  }

  // ---- Blocking：pending ApprovalRecord 候選人模擬 ----
  const pendingRecords = await client.approvalRecord.findMany({ where: { decision: "PENDING", recordStatus: "ACTIVE" } });
  for (const r of pendingRecords) {
    const eligibleUserIds = await getEligibleApproverUserIdsInTx(
      client as Tx,
      { approvalType: r.approvalType, requestedByUserId: r.requestedByUserId, approverTeamId: r.approverTeamId },
      now,
    );
    if (!eligibleUserIds.includes(userId)) continue;
    const remaining = eligibleUserIds.filter((id) => id !== userId);
    if (remaining.length === 0) {
      items.push({
        severity: "blocking",
        blocking: true,
        category: "pendingApproval",
        message: `此人員是待核准紀錄「${r.id}」目前唯一合法核准人，排除後無其他合法候選人`,
        relatedEntityId: r.id,
        suggestedAction: "先處理此筆待核准紀錄，或安排其他合法核准人／代理人",
      });
    }
  }

  // ---- Warning：一般 active Team MEMBER ----
  const memberships = await client.teamMember.findMany({ where: { userId, membershipRole: "MEMBER", isActive: true } });
  for (const m of memberships) {
    items.push({
      severity: "warning",
      blocking: false,
      category: "teamMember",
      message: `此人員目前是 Team「${m.teamId}」的一般成員，停用後將自動結束此成員關係`,
      relatedEntityId: m.teamId,
      suggestedAction: "停用時將自動結束此成員關係，無需另外處理",
    });
  }

  // ---- Warning：未結案 Issue ownerUserId／reporterUserId ----
  const ownedIssues = await client.issue.findMany({ where: { ownerUserId: userId } });
  for (const issue of ownedIssues) {
    if (!isClosed(issue.issueType, issue.workflowStatus)) {
      items.push({
        severity: "warning",
        blocking: false,
        category: "issueOwner",
        message: `此人員目前是未結案工單「${issue.issueKey}」的負責人`,
        relatedEntityId: issue.id,
        suggestedAction: "停用後請另行改派此工單的負責人",
      });
    }
  }
  const reportedIssues = await client.issue.findMany({ where: { reporterUserId: userId } });
  for (const issue of reportedIssues) {
    if (!isClosed(issue.issueType, issue.workflowStatus)) {
      items.push({
        severity: "warning",
        blocking: false,
        category: "issueReporter",
        message: `此人員目前是未結案工單「${issue.issueKey}」的通報人`,
        relatedEntityId: issue.id,
        suggestedAction: "停用不會自動變更通報人紀錄，如需要請另行處理",
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// getUserDeactivationImpact：預覽用途，不寫 UserDeactivationImpactChecked AuditLog
// ---------------------------------------------------------------------------

export async function getUserDeactivationImpact(input: GetUserDeactivationImpactInput): Promise<DeactivationImpactItem[]> {
  await requirePeopleCapability(input.actorId, "user.deactivate");
  return collectDeactivationImpact(prisma, input.userId);
}

// ---------------------------------------------------------------------------
// checkUserDeactivationImpact：明確的影響檢查動作，寫入 UserDeactivationImpactChecked
// ---------------------------------------------------------------------------

export async function checkUserDeactivationImpact(input: GetUserDeactivationImpactInput): Promise<DeactivationImpactItem[]> {
  return prisma.$transaction(async (tx) => {
    await requirePeopleCapability(input.actorId, "user.deactivate", tx);
    const items = await collectDeactivationImpact(tx, input.userId);
    const target = await tx.user.findUnique({ where: { id: input.userId } });
    const blockingCount = items.filter((i) => i.blocking).length;
    await writeAuditLog(
      {
        entityType: "User",
        entityId: input.userId,
        actionType: "UserDeactivationImpactChecked",
        summary: `檢查使用者「${target?.name ?? input.userId}」的停用影響（共 ${items.length} 筆，其中 ${blockingCount} 筆為 blocking）`,
        actorUserId: input.actorId,
      },
      tx,
    );
    return items;
  });
}

// ---------------------------------------------------------------------------
// deactivatePerson：transaction 內重新執行影響分析，有 blocking 整筆拒絕
// ---------------------------------------------------------------------------

async function deactivatePersonTx(tx: Tx, input: DeactivatePersonInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  const grant = await requirePeopleCapabilityInTeamScope(input.actorId, "user.deactivate", input.teamScopeId, tx);
  if (grant === "TEAM_LEAD") {
    assertLeadTargetIsNotSelf(input.actorId, input.userId, "停用成員");
    await assertLeadTargetInTeam(tx, input.teamScopeId!, input.userId);
    await assertLeadTargetIsNotAnotherLead(tx, input.teamScopeId!, input.userId);
    await assertTeamKeepsAtLeastOneLead(tx, input.teamScopeId!, input.userId);
  }

  const target = await tx.user.findUnique({ where: { id: input.userId } });
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);

  if (!target.isActive) {
    return target; // no-op
  }

  const impact = await collectDeactivationImpact(tx, input.userId);
  const blockingItems = impact.filter((i) => i.blocking);
  if (blockingItems.length > 0) {
    throw new PeopleStateError(
      `此使用者存在 ${blockingItems.length} 筆停用阻擋項目，不得停用：${blockingItems.map((i) => i.message).join("；")}`,
    );
  }

  // 一般 MEMBER 自動結束 membership（impact 分析已排除 active LEAD 存在的情形）
  const memberships = await tx.teamMember.findMany({ where: { userId: input.userId, isActive: true } });
  const now = new Date();
  for (const m of memberships) {
    await tx.teamMember.update({ where: { id: m.id }, data: { isActive: false } });
    await tx.teamMembershipHistory.create({
      data: {
        teamMemberId: m.id,
        teamId: m.teamId,
        userId: input.userId,
        eventType: "REMOVED",
        fromMembershipRole: m.membershipRole,
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
        entityId: m.id,
        actionType: "TeamMemberRemoved",
        summary: `使用者「${target.name}」停用，自動結束其於 Team「${m.teamId}」的成員關係`,
        actorUserId: input.actorId,
        reasonCode: input.reasonCode,
      },
      tx,
    );
  }

  // UserRole 保留，不自動停用；不自動改派主管、LEAD、代理、Issue 或 ApprovalRecord。
  const updated = await tx.user.update({
    where: { id: target.id },
    data: { isActive: false, disabledAt: now, disabledByUserId: input.actorId, disabledReasonCode: input.reasonCode },
  });

  await writeAuditLog(
    {
      entityType: "User",
      entityId: updated.id,
      actionType: "UserDeactivated",
      summary: `停用使用者「${target.name}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function deactivatePerson(input: DeactivatePersonInput) {
  return prisma.$transaction((tx) => deactivatePersonTx(tx, input));
}
