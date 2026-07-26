// C1-B3 新增：系統角色（UserRole）管理服務層。
//
// Transaction 邊界規則與 supervisorAssignmentService.ts／teamLeadService.ts 相同：私有
// xxxTx 函式只接受既有 tx，公開函式負責開啟 prisma.$transaction。角色本身的授權判斷
// 全部透過 src/lib/permissions.ts（active UserRole 是唯一授權來源，見 C1-B2），本檔案
// 只負責角色「資料」的生命週期管理，不重建授權邏輯。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requirePeopleCapability } from "./access";
import { assertReasonCodeProvided, assertValidRoleKey, throwIfInvalid } from "./validation";
import { PeopleNotFoundError, PeopleStateError } from "./types";
import type { AssignSystemRoleInput, UpdatePrimaryRoleInput, RemoveSystemRoleInput } from "./types";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// assignSystemRole：新增或重新啟用一筆 UserRole
// ---------------------------------------------------------------------------

async function assignSystemRoleTx(tx: Tx, input: AssignSystemRoleInput) {
  const issues: string[] = [];
  assertValidRoleKey(input.role, issues, "role");
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  await requirePeopleCapability(input.actorId, "user.assignRole", tx);

  const target = await tx.user.findUnique({ where: { id: input.userId } });
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);

  const existing = await tx.userRole.findUnique({
    where: { userId_role: { userId: input.userId, role: input.role } },
  });

  let userRole;
  if (existing) {
    if (existing.isActive) {
      throw new PeopleStateError(`此使用者已經具有 active 角色「${input.role}」`);
    }
    userRole = await tx.userRole.update({ where: { id: existing.id }, data: { isActive: true } });
  } else {
    userRole = await tx.userRole.create({ data: { userId: input.userId, role: input.role, isActive: true } });
  }

  await tx.userRoleHistory.create({
    data: {
      userRoleId: userRole.id,
      userId: input.userId,
      role: input.role,
      eventType: "ASSIGNED",
      fromValue: null,
      toValue: input.role,
      actorUserId: input.actorId,
      eventSource: "ADMIN_ACTION",
      reasonCode: input.reasonCode,
      effectiveAt: new Date(),
    },
  });

  await writeAuditLog(
    {
      entityType: "UserRole",
      entityId: userRole.id,
      actionType: "UserRoleAssigned",
      summary: `將使用者「${target.name}」指派角色「${input.role}」`,
      actorUserId: input.actorId,
      toValue: input.role,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return userRole;
}

export async function assignSystemRole(input: AssignSystemRoleInput) {
  return prisma.$transaction((tx) => assignSystemRoleTx(tx, input));
}

// ---------------------------------------------------------------------------
// updatePrimaryRole：只更新 User.role 這個「主要角色顯示快取」，不影響 UserRole 資料本身
// ---------------------------------------------------------------------------

async function updatePrimaryRoleTx(tx: Tx, input: UpdatePrimaryRoleInput) {
  const issues: string[] = [];
  assertValidRoleKey(input.role, issues, "role");
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  await requirePeopleCapability(input.actorId, "user.assignRole", tx);

  const target = await tx.user.findUnique({ where: { id: input.userId } });
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);

  const activeRole = await tx.userRole.findUnique({
    where: { userId_role: { userId: input.userId, role: input.role } },
  });
  if (!activeRole || !activeRole.isActive) {
    throw new PeopleStateError(`「${input.role}」必須是此使用者目前的 active UserRole，才能設為主要角色（不得自動挑選角色）`);
  }

  if (target.role === input.role) {
    return target; // no-op：不寫 History／AuditLog
  }

  const previousRole = target.role;
  const updated = await tx.user.update({ where: { id: target.id }, data: { role: input.role } });

  await tx.userRoleHistory.create({
    data: {
      userRoleId: activeRole.id,
      userId: target.id,
      role: input.role,
      eventType: "PRIMARY_CHANGED",
      fromValue: previousRole,
      toValue: input.role,
      actorUserId: input.actorId,
      eventSource: "ADMIN_ACTION",
      reasonCode: input.reasonCode,
      effectiveAt: new Date(),
    },
  });

  await writeAuditLog(
    {
      entityType: "User",
      entityId: target.id,
      actionType: "RoleChange",
      summary: `將使用者「${target.name}」的主要角色從「${previousRole}」變更為「${input.role}」`,
      actorUserId: input.actorId,
      fromValue: previousRole,
      toValue: input.role,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function updatePrimaryRole(input: UpdatePrimaryRoleInput) {
  return prisma.$transaction((tx) => updatePrimaryRoleTx(tx, input));
}

// ---------------------------------------------------------------------------
// removeSystemRole：只設 isActive=false（軟移除），並套用多層 blocking 規則
// ---------------------------------------------------------------------------

async function removeSystemRoleTx(tx: Tx, input: RemoveSystemRoleInput) {
  const issues: string[] = [];
  assertValidRoleKey(input.role, issues, "role");
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  await requirePeopleCapability(input.actorId, "user.removeRole", tx);

  const target = await tx.user.findUnique({ where: { id: input.userId } });
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);

  const userRole = await tx.userRole.findUnique({
    where: { userId_role: { userId: input.userId, role: input.role } },
  });
  if (!userRole || !userRole.isActive) {
    throw new PeopleStateError(`此使用者目前沒有 active 角色「${input.role}」，無法移除`);
  }

  if (target.role === input.role) {
    throw new PeopleStateError("不得移除目前的主要角色，請先呼叫 updatePrimaryRole 改為其他 active 角色後再移除");
  }

  const activeRoles = await tx.userRole.findMany({ where: { userId: input.userId, isActive: true } });
  if (activeRoles.length <= 1) {
    throw new PeopleStateError("不得移除此使用者最後一個 active 角色");
  }

  if (input.role === "Admin") {
    if (target.isBreakGlassAdmin) {
      throw new PeopleStateError("Break-glass Admin 的 Admin 角色不得移除");
    }
    const otherActiveAdmins = await tx.userRole.count({
      where: { role: "Admin", isActive: true, userId: { not: input.userId }, user: { isActive: true } },
    });
    if (otherActiveAdmins === 0) {
      throw new PeopleStateError("不得移除最後一位有效 Admin 的角色");
    }
  }

  const updated = await tx.userRole.update({ where: { id: userRole.id }, data: { isActive: false } });

  await tx.userRoleHistory.create({
    data: {
      userRoleId: updated.id,
      userId: input.userId,
      role: input.role,
      eventType: "REMOVED",
      fromValue: input.role,
      toValue: null,
      actorUserId: input.actorId,
      eventSource: "ADMIN_ACTION",
      reasonCode: input.reasonCode,
      effectiveAt: new Date(),
    },
  });

  await writeAuditLog(
    {
      entityType: "UserRole",
      entityId: updated.id,
      actionType: "UserRoleRemoved",
      summary: `移除使用者「${target.name}」的角色「${input.role}」`,
      actorUserId: input.actorId,
      fromValue: input.role,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function removeSystemRole(input: RemoveSystemRoleInput) {
  return prisma.$transaction((tx) => removeSystemRoleTx(tx, input));
}
