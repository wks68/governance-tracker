// 成員管理權限收斂新增：團隊成員管理的組合式服務層。
//
// 「最高權限管理員可管理所有團隊、團隊主管只能管理自己團隊」這條規則的唯一實作位置是
// src/lib/people/access.ts 的 requirePeopleCapabilityInTeamScope（＋ leadScope.ts 的額外
// 限制）；本檔案只負責把既有的單一職責服務（createPerson／addTeamMember／主管指派）
// 組合成 UI 實際需要的操作，並確保每個操作都在同一個 transaction 內完成。
//
// 授權一律在服務層以 actorId 現場重新解析，不接受呼叫端傳入 isAdmin／teamIds 等旗標，
// 也不信任前端是否有隱藏按鈕。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import type { RoleKey } from "../constants";
import {
  createSupervisorAssignmentCoreTx,
  endSupervisorAssignmentCoreTx,
} from "../supervisorAssignmentService";
import { hasPeopleCapability, requirePeopleCapabilityInTeamScope, resolveLedTeamIds } from "./access";
import {
  assertLeadMayUseRole,
  assertLeadTargetInTeam,
  assertLeadTargetIsNotAnotherLead,
  assertLeadTargetIsNotSelf,
} from "./leadScope";
import { createPersonTx } from "./profileService";
import { addTeamMemberTx } from "./teamMembershipService";
import { PeopleAccessDeniedError, PeopleNotFoundError, PeopleStateError, PeopleValidationError } from "./types";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// 可管理範圍解析（供 UI 決定顯示哪些按鈕；服務層仍會重新驗證）
// ---------------------------------------------------------------------------

export interface MemberManagementScope {
  /** 具備跨團隊管理能力（最高權限管理員） */
  canManageAllTeams: boolean;
  /** 目前擔任 active LEAD 的團隊 id（只能管理這些團隊的成員） */
  ledTeamIds: string[];
}

export async function resolveMemberManagementScope(actorId: string): Promise<MemberManagementScope> {
  const [canManageAllTeams, ledTeamIds] = await Promise.all([
    hasPeopleCapability(actorId, "team.manageMembers"),
    resolveLedTeamIds(actorId),
  ]);
  return { canManageAllTeams, ledTeamIds };
}

export async function canActorManageTeamMembers(actorId: string, teamId: string): Promise<boolean> {
  const scope = await resolveMemberManagementScope(actorId);
  return scope.canManageAllTeams || scope.ledTeamIds.includes(teamId);
}

// ---------------------------------------------------------------------------
// 新增團隊成員（建立使用者 ＋ 角色 ＋ membership ＋ 直屬主管，同一 transaction）
// ---------------------------------------------------------------------------

export interface CreateTeamMemberInput {
  teamId: string;
  name: string;
  email: string;
  loginIdentifier?: string | null;
  department?: string;
  role: RoleKey;
  /** 直屬主管；團隊主管操作時只能指定自己 */
  supervisorUserId?: string | null;
  isActive: boolean;
  actorId: string;
  reasonCode: string;
}

export async function createTeamMember(input: CreateTeamMemberInput) {
  return prisma.$transaction(async (tx) => {
    const grant = await requirePeopleCapabilityInTeamScope(input.actorId, "user.create", input.teamId, tx);
    if (grant === "TEAM_LEAD") {
      assertLeadMayUseRole(input.role);
      if (input.supervisorUserId && input.supervisorUserId !== input.actorId) {
        throw new PeopleAccessDeniedError("團隊主管只能將自己設為該成員的直屬主管");
      }
    }

    const team = await tx.team.findUnique({ where: { id: input.teamId } });
    if (!team) throw new PeopleNotFoundError(`找不到團隊：${input.teamId}`);

    const user = await createPersonTx(tx, {
      name: input.name,
      email: input.email,
      department: input.department,
      loginIdentifier: input.loginIdentifier,
      initialRole: input.role,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
      teamScopeId: input.teamId,
    });

    await addTeamMemberTx(tx, {
      teamId: input.teamId,
      userId: user.id,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
    });

    if (input.supervisorUserId) {
      await assignSupervisorCoreTx(tx, {
        teamId: input.teamId,
        userId: user.id,
        supervisorUserId: input.supervisorUserId,
        actorId: input.actorId,
        reasonCode: input.reasonCode,
      });
    }

    // createPerson 一律建立 active User；若要求建立為停用狀態，於同一 transaction 內調整。
    if (!input.isActive) {
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
      await writeAuditLog(
        {
          entityType: "User",
          entityId: user.id,
          actionType: "UserDeactivated",
          summary: `建立使用者「${user.name}」時即設定為停用狀態`,
          actorUserId: input.actorId,
          reasonCode: input.reasonCode,
        },
        tx,
      );
    }

    return user;
  });
}

// ---------------------------------------------------------------------------
// 設定直屬主管
// ---------------------------------------------------------------------------

export interface SetTeamMemberSupervisorInput {
  teamId: string;
  userId: string;
  supervisorUserId: string;
  actorId: string;
  reasonCode: string;
}

async function assignSupervisorCoreTx(
  tx: Tx,
  input: { teamId: string; userId: string; supervisorUserId: string; actorId: string; reasonCode: string },
) {
  const now = new Date();

  // 既有的有效 primary 指派先無縫終止，再建立新指派（半開區間，不留重疊）。
  const existing = await tx.userSupervisorAssignment.findMany({
    where: { userId: input.userId, isPrimary: true, isActive: true },
  });
  for (const assignment of existing) {
    if (assignment.validUntil !== null && assignment.validUntil.getTime() <= now.getTime()) continue;
    if (assignment.supervisorUserId === input.supervisorUserId && assignment.validFrom.getTime() <= now.getTime()) {
      return assignment; // 已經是這位主管，no-op
    }
    if (assignment.validFrom.getTime() >= now.getTime()) {
      // 尚未生效的排程：直接停用，不得把 validUntil 設成 <= validFrom
      await tx.userSupervisorAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
      continue;
    }
    await endSupervisorAssignmentCoreTx(tx, {
      assignmentId: assignment.id,
      endAt: now,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
      now,
    });
  }

  return createSupervisorAssignmentCoreTx(tx, {
    userId: input.userId,
    supervisorUserId: input.supervisorUserId,
    validFrom: now,
    isPrimary: true,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
  });
}

export async function setTeamMemberSupervisor(input: SetTeamMemberSupervisorInput) {
  return prisma.$transaction(async (tx) => {
    const grant = await requirePeopleCapabilityInTeamScope(input.actorId, "team.manageMembers", input.teamId, tx);
    if (grant === "TEAM_LEAD") {
      assertLeadTargetIsNotSelf(input.actorId, input.userId, "設定直屬主管");
      await assertLeadTargetInTeam(tx, input.teamId, input.userId);
      await assertLeadTargetIsNotAnotherLead(tx, input.teamId, input.userId);
      if (input.supervisorUserId !== input.actorId) {
        throw new PeopleAccessDeniedError("團隊主管只能將自己設為該成員的直屬主管");
      }
    }
    if (input.userId === input.supervisorUserId) {
      throw new PeopleValidationError(["不得指派自己為自己的主管"]);
    }
    return assignSupervisorCoreTx(tx, input);
  });
}

// ---------------------------------------------------------------------------
// 刪除規則
//
// 只要 User／TeamMember 已被任何業務、稽核或歷史資料引用，就一律不得物理刪除，
// 只能停用或移除 membership。本檔案不做「刪除後再補寫稽核」這種會遺失軌跡的處理。
//
// 目前 schema 的 AuditLog.actorUserId 為 optional relation（Prisma 預設 onDelete: SetNull），
// 因此只要使用者曾在 AuditLog 留下任何一筆 actor 紀錄，硬刪除就會讓該筆稽核失去操作者——
// 依規則此種情況一律禁止 hard delete。
// ---------------------------------------------------------------------------

export interface MemberDeletionBlocker {
  category: string;
  count: number;
  message: string;
}

export async function collectMemberDeletionBlockers(userId: string): Promise<MemberDeletionBlocker[]> {
  const [
    auditLogs,
    issuesReported,
    approvalsRequested,
    approvalsApproved,
    approvalsExpected,
    roleHistories,
    membershipHistories,
    supervisorAsUser,
    supervisorAsSupervisor,
    supervisorAsCreator,
    stageHistories,
  ] = await Promise.all([
    prisma.auditLog.count({ where: { actorUserId: userId } }),
    prisma.issue.count({ where: { reporterUserId: userId } }),
    prisma.approvalRecord.count({ where: { requestedByUserId: userId } }),
    prisma.approvalRecord.count({ where: { approverUserId: userId } }),
    prisma.approvalRecord.count({ where: { expectedApproverUserId: userId } }),
    prisma.userRoleHistory.count({ where: { OR: [{ userId }, { actorUserId: userId }] } }),
    prisma.teamMembershipHistory.count({ where: { OR: [{ userId }, { actorUserId: userId }] } }),
    prisma.userSupervisorAssignment.count({ where: { userId } }),
    prisma.userSupervisorAssignment.count({ where: { supervisorUserId: userId } }),
    prisma.userSupervisorAssignment.count({ where: { createdByUserId: userId } }),
    prisma.issueWorkflowStageHistory.count({ where: { actorUserId: userId } }),
  ]);

  const blockers: MemberDeletionBlocker[] = [];
  const push = (category: string, count: number, message: string) => {
    if (count > 0) blockers.push({ category, count, message });
  };

  push("AuditLog", auditLogs, `此使用者已於 ${auditLogs} 筆稽核紀錄中留下操作者資訊，永久刪除會使稽核失去操作者`);
  push("Issue", issuesReported, `此使用者是 ${issuesReported} 筆工單的申請人`);
  push("ApprovalRecord", approvalsRequested + approvalsApproved + approvalsExpected, "此使用者被核准紀錄引用");
  push("UserRoleHistory", roleHistories, `此使用者被 ${roleHistories} 筆角色異動歷程引用`);
  push("TeamMembershipHistory", membershipHistories, `此使用者被 ${membershipHistories} 筆團隊成員異動歷程引用`);
  push(
    "UserSupervisorAssignment",
    supervisorAsUser + supervisorAsSupervisor + supervisorAsCreator,
    "此使用者被主管指派紀錄引用",
  );
  push("WorkflowHistory", stageHistories, `此使用者被 ${stageHistories} 筆流程歷程引用`);

  return blockers;
}

export interface PermanentlyDeleteMemberInput {
  teamId: string;
  userId: string;
  actorId: string;
  reasonCode: string;
}

/**
 * 永久刪除成員帳號。fail closed：只要存在任何引用即整筆拒絕，不做任何連帶刪除。
 *
 * 實務上，任何透過正式服務層建立的使用者都至少會有 UserRoleHistory 與 AuditLog，
 * 因此本操作幾乎一律會被擋下——這是刻意的：規格要求「不得刪除後失去紀錄」。
 */
export async function permanentlyDeleteMember(input: PermanentlyDeleteMemberInput) {
  await requirePeopleCapabilityInTeamScope(input.actorId, "team.manageMembers", input.teamId, prisma);
  if (!input.reasonCode?.trim()) throw new PeopleValidationError(["reasonCode 不得為空"]);
  if (input.actorId === input.userId) {
    throw new PeopleAccessDeniedError("不得永久刪除自己");
  }

  const blockers = await collectMemberDeletionBlockers(input.userId);
  if (blockers.length > 0) {
    throw new PeopleStateError(
      `此成員已被既有資料引用，不得永久刪除（請改用「停用成員」）：${blockers.map((b) => b.message).join("；")}`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId } });
    if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);

    await tx.teamMember.deleteMany({ where: { userId: input.userId } });
    await tx.userRole.deleteMany({ where: { userId: input.userId } });
    await tx.user.delete({ where: { id: input.userId } });

    // 刪除的是「完全未被引用」的帳號，因此本筆稽核不會因 FK SetNull 而失去意義
    // （actorUserId 是執行者，不是被刪除者）。
    await writeAuditLog(
      {
        entityType: "User",
        entityId: input.userId,
        actionType: "UserPermanentlyDeleted",
        summary: `永久刪除未被任何資料引用的使用者「${target.name}」`,
        actorUserId: input.actorId,
        reasonCode: input.reasonCode,
      },
      tx,
    );

    return { deletedUserId: input.userId, name: target.name };
  });
}
