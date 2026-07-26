// C1-B3 新增：Person 基本資料與啟用生命週期服務層（createPerson／updatePersonProfile／activatePerson）。
//
// Transaction 邊界規則與本目錄其他服務一致：私有 xxxTx 只接受既有 tx，公開函式負責開
// prisma.$transaction。

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { requirePeopleCapability } from "./access";
import { assertReasonCodeProvided, assertValidProfileFields, assertValidRoleKey, throwIfInvalid } from "./validation";
import { PeopleNotFoundError, PeopleStateError, PeopleValidationError } from "./types";
import type { CreatePersonInput, UpdatePersonProfileInput, ActivatePersonInput } from "./types";

type Tx = Prisma.TransactionClient;

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

// ---------------------------------------------------------------------------
// createPerson：建立 User＋對應 active UserRole＋UserRoleHistory，全部同一 transaction
// ---------------------------------------------------------------------------

async function createPersonTx(tx: Tx, input: CreatePersonInput) {
  const issues: string[] = [];
  if (!input.name?.trim()) issues.push("name 不得為空");
  assertValidProfileFields({ email: input.email }, issues);
  assertValidRoleKey(input.initialRole, issues, "initialRole");
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  // 不允許建立 Break-glass Admin：CreatePersonInput 本身不曝露 isBreakGlassAdmin 欄位，
  // 一律建立為一般（非 Break-glass）使用者。
  await requirePeopleCapability(input.actorId, "user.create", tx);

  const normalizedLoginIdentifier = input.loginIdentifier?.trim() ? input.loginIdentifier.trim() : null;
  const conflicts: string[] = [];
  const existingEmail = await tx.user.findUnique({ where: { email: input.email } });
  if (existingEmail) conflicts.push(`email 已被使用：${input.email}`);
  if (normalizedLoginIdentifier) {
    const existingLogin = await tx.user.findUnique({ where: { loginIdentifier: normalizedLoginIdentifier } });
    if (existingLogin) conflicts.push(`loginIdentifier 已被使用：${normalizedLoginIdentifier}`);
  }
  if (conflicts.length > 0) throw new PeopleValidationError(conflicts);

  const now = new Date();
  const user = await tx.user.create({
    data: {
      name: input.name.trim(),
      email: input.email,
      department: input.department ?? "",
      loginIdentifier: normalizedLoginIdentifier,
      role: input.initialRole,
      isActive: true, // 不允許啟用 User 沒有 active UserRole：下方同一 transaction 立即建立 active UserRole
    },
  });

  const userRole = await tx.userRole.create({
    data: { userId: user.id, role: input.initialRole, isActive: true },
  });

  await tx.userRoleHistory.create({
    data: {
      userRoleId: userRole.id,
      userId: user.id,
      role: input.initialRole,
      eventType: "ASSIGNED",
      fromValue: null,
      toValue: input.initialRole,
      actorUserId: input.actorId,
      eventSource: "ADMIN_ACTION",
      reasonCode: input.reasonCode,
      effectiveAt: now,
    },
  });

  await writeAuditLog(
    {
      entityType: "User",
      entityId: user.id,
      actionType: "UserCreated",
      summary: `建立使用者「${user.name}」（初始角色：${input.initialRole}）`,
      actorUserId: input.actorId,
      toValue: input.initialRole,
      reasonCode: input.reasonCode,
    },
    tx,
  );
  await writeAuditLog(
    {
      entityType: "UserRole",
      entityId: userRole.id,
      actionType: "UserRoleAssigned",
      summary: `將使用者「${user.name}」指派角色「${input.initialRole}」`,
      actorUserId: input.actorId,
      toValue: input.initialRole,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return user;
}

export async function createPerson(input: CreatePersonInput) {
  try {
    return await prisma.$transaction((tx) => createPersonTx(tx, input));
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new PeopleValidationError([`email 或 loginIdentifier 已被使用（email：${input.email}）`]);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updatePersonProfile：只修改 profile 欄位（name／department），no-op 不寫 AuditLog
// ---------------------------------------------------------------------------

async function updatePersonProfileTx(tx: Tx, input: UpdatePersonProfileInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  assertValidProfileFields({ name: input.name, department: input.department }, issues);
  throwIfInvalid(issues);

  await requirePeopleCapability(input.actorId, "user.update", tx);

  const target = await tx.user.findUnique({ where: { id: input.userId } });
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);

  const nextName = input.name !== undefined ? input.name.trim() : target.name;
  const nextDepartment = input.department !== undefined ? input.department : target.department;
  const nextLoginIdentifier =
    input.loginIdentifier !== undefined ? (input.loginIdentifier?.trim() ? input.loginIdentifier.trim() : null) : target.loginIdentifier;

  if (nextName === target.name && nextDepartment === target.department && nextLoginIdentifier === target.loginIdentifier) {
    return target; // no-op：不寫 AuditLog
  }

  if (nextLoginIdentifier && nextLoginIdentifier !== target.loginIdentifier) {
    const existingLogin = await tx.user.findUnique({ where: { loginIdentifier: nextLoginIdentifier } });
    if (existingLogin && existingLogin.id !== target.id) {
      throw new PeopleValidationError([`loginIdentifier 已被使用：${nextLoginIdentifier}`]);
    }
  }

  const updated = await tx.user.update({
    where: { id: target.id },
    data: { name: nextName, department: nextDepartment, loginIdentifier: nextLoginIdentifier },
  });

  await writeAuditLog(
    {
      entityType: "User",
      entityId: updated.id,
      actionType: "UserUpdated",
      summary: `更新使用者「${target.name}」的基本資料`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function updatePersonProfile(input: UpdatePersonProfileInput) {
  return prisma.$transaction((tx) => updatePersonProfileTx(tx, input));
}

// ---------------------------------------------------------------------------
// activatePerson：transaction 內重新確認角色／Break-glass 一致性，不一致時阻擋、不自動修復
// ---------------------------------------------------------------------------

async function activatePersonTx(tx: Tx, input: ActivatePersonInput) {
  const issues: string[] = [];
  assertReasonCodeProvided(input.reasonCode, issues);
  throwIfInvalid(issues);

  await requirePeopleCapability(input.actorId, "user.activate", tx);

  const target = await tx.user.findUnique({ where: { id: input.userId } });
  if (!target) throw new PeopleNotFoundError(`找不到使用者：${input.userId}`);

  if (target.isActive) {
    return target; // no-op
  }

  const activeRoles = await tx.userRole.findMany({ where: { userId: target.id, isActive: true } });
  if (activeRoles.length === 0) {
    throw new PeopleStateError("此使用者沒有任何 active UserRole，不得啟用（不會自動指派角色）");
  }
  if (!activeRoles.some((r) => r.role === target.role)) {
    throw new PeopleStateError(
      "User.role（主要角色顯示快取）與 active UserRole 不一致，不得啟用（不會自動修復，請先呼叫 updatePrimaryRole）",
    );
  }
  if (target.isBreakGlassAdmin && !activeRoles.some((r) => r.role === "Admin")) {
    throw new PeopleStateError("Break-glass Admin 必須具有 active 的 Admin UserRole，才能啟用");
  }

  const updated = await tx.user.update({ where: { id: target.id }, data: { isActive: true } });

  await writeAuditLog(
    {
      entityType: "User",
      entityId: updated.id,
      actionType: "UserActivated",
      summary: `啟用使用者「${target.name}」`,
      actorUserId: input.actorId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function activatePerson(input: ActivatePersonInput) {
  return prisma.$transaction((tx) => activatePersonTx(tx, input));
}
