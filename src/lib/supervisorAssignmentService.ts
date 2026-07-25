// M1.5-B 新增：直屬主管指派管理服務層。
//
// 信任邊界：與 approvalService.ts 同樣原則——所有權限與規則檢查一律在同一個
// prisma.$transaction 內、以 actorId 現場重新解析，不信任呼叫端傳入的 isAdmin 等旗標。
//
// Transaction 邊界規則：私有 xxxTx 函式只接受既有 tx，不自行開啟 transaction；
// 公開函式才負責開 prisma.$transaction。公開函式之間不得互相呼叫（會巢狀開兩個獨立
// transaction）——需要「一次做兩件事」的操作（例如 replaceSupervisorAssignment）
// 一律在單一公開 wrapper 裡直接呼叫多個私有 xxxTx，全程共用同一個 tx。
//
// isActive 語意：行政啟用旗標，跟 validFrom／validUntil 的時間有效性是兩件事。
// 自然到期（validUntil 已過但 isActive=true）是正常歷史紀錄。isActive=false 只在
// 「取消尚未生效的排程」（cancelScheduledSupervisorAssignment）時才會被設定，一般 UI
// 不曝露其他切換方式。

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { resolveGovernanceAccessContext, wouldCreateSupervisorCycleInWindow, getEffectiveSupervisor, type EffectiveSupervisorResult } from "./permissions";
import { windowsOverlap } from "./timeWindow";
import { writeAuditLog } from "./audit";

type Tx = Prisma.TransactionClient;

export class GovernanceValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`治理設定驗證失敗：${issues.join("; ")}`);
    this.name = "GovernanceValidationError";
  }
}
export class GovernanceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceNotFoundError";
  }
}
export class GovernanceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceStateError";
  }
}
export class GovernanceAccessDeniedError extends Error {
  constructor(message: string = "沒有權限執行此操作") {
    super(message);
    this.name = "GovernanceAccessDeniedError";
  }
}

// ---------------------------------------------------------------------------
// 建立
// ---------------------------------------------------------------------------

export interface CreateSupervisorAssignmentInput {
  userId: string;
  supervisorUserId: string;
  validFrom: Date;
  validUntil?: Date | null;
  isPrimary?: boolean; // 預設 true
  actorId: string;
  reasonCode: string; // 一律必填：本操作永遠是 Admin-only，沒有自助路徑
}

async function createSupervisorAssignmentTx(tx: Tx, input: CreateSupervisorAssignmentInput) {
  const isPrimary = input.isPrimary ?? true;
  const issues: string[] = [];
  if (!input.userId) issues.push("userId 不得為空");
  if (!input.supervisorUserId) issues.push("supervisorUserId 不得為空");
  if (input.userId && input.supervisorUserId && input.userId === input.supervisorUserId) {
    issues.push("不得指派自己為自己的主管");
  }
  if (input.validUntil != null && input.validUntil.getTime() <= input.validFrom.getTime()) {
    issues.push("validUntil 必須晚於 validFrom");
  }
  if (!input.reasonCode?.trim()) issues.push("reasonCode 不得為空");
  if (issues.length > 0) throw new GovernanceValidationError(issues);

  const ctx = await resolveGovernanceAccessContext(input.actorId, tx);
  if (!ctx.canManageSupervisors) {
    throw new GovernanceAccessDeniedError("僅具備 governance.manageSupervisors 能力者可維護主管指派");
  }

  const [userRow, supervisorRow] = await Promise.all([
    tx.user.findUnique({ where: { id: input.userId } }),
    tx.user.findUnique({ where: { id: input.supervisorUserId } }),
  ]);
  const existenceIssues: string[] = [];
  if (!userRow) existenceIssues.push("userId 對應的使用者不存在");
  if (!supervisorRow) existenceIssues.push("supervisorUserId 對應的使用者不存在");
  if (existenceIssues.length > 0) throw new GovernanceValidationError(existenceIssues);

  if (isPrimary) {
    const existingPrimary = await tx.userSupervisorAssignment.findMany({
      where: { userId: input.userId, isPrimary: true, isActive: true },
    });
    const overlap = existingPrimary.some((a) =>
      windowsOverlap(a.validFrom, a.validUntil, input.validFrom, input.validUntil ?? null),
    );
    if (overlap) {
      throw new GovernanceStateError("此使用者在指定期間已存在重疊的有效 primary 主管指派");
    }
  }

  const allAssignments = await tx.userSupervisorAssignment.findMany({});
  if (
    wouldCreateSupervisorCycleInWindow(allAssignments, {
      userId: input.userId,
      supervisorUserId: input.supervisorUserId,
      validFrom: input.validFrom,
      validUntil: input.validUntil ?? null,
    })
  ) {
    throw new GovernanceStateError("此指派會在某段時間內形成主管循環，不得建立");
  }

  const created = await tx.userSupervisorAssignment.create({
    data: {
      userId: input.userId,
      supervisorUserId: input.supervisorUserId,
      validFrom: input.validFrom,
      validUntil: input.validUntil ?? null,
      isPrimary,
      createdByUserId: input.actorId,
    },
  });

  await writeAuditLog(
    {
      entityType: "UserSupervisorAssignment",
      entityId: created.id,
      actionType: "SupervisorAssignmentCreated",
      summary: `新增主管指派：使用者「${input.userId}」的主管設為「${input.supervisorUserId}」（生效於 ${input.validFrom.toISOString()}）`,
      actorUserId: input.actorId,
      toValue: input.supervisorUserId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return created;
}

export async function createSupervisorAssignment(input: CreateSupervisorAssignmentInput) {
  return prisma.$transaction((tx) => createSupervisorAssignmentTx(tx, input));
}

// ---------------------------------------------------------------------------
// 終止（已生效紀錄）
// ---------------------------------------------------------------------------

export interface EndSupervisorAssignmentInput {
  assignmentId: string;
  endAt: Date;
  actorId: string;
  reasonCode: string;
  now?: Date;
}

async function endSupervisorAssignmentTx(tx: Tx, input: EndSupervisorAssignmentInput) {
  if (!input.reasonCode?.trim()) throw new GovernanceValidationError(["reasonCode 不得為空"]);

  const ctx = await resolveGovernanceAccessContext(input.actorId, tx);
  if (!ctx.canManageSupervisors) {
    throw new GovernanceAccessDeniedError("僅具備 governance.manageSupervisors 能力者可終止主管指派");
  }

  const assignment = await tx.userSupervisorAssignment.findUnique({ where: { id: input.assignmentId } });
  if (!assignment) throw new GovernanceNotFoundError(`找不到主管指派：${input.assignmentId}`);

  const now = input.now ?? new Date();
  if (!assignment.isActive) {
    throw new GovernanceStateError("此指派已被停用（可能已取消排程），不得終止");
  }
  if (now.getTime() < assignment.validFrom.getTime()) {
    throw new GovernanceStateError("此指派尚未生效，不得終止，請使用取消排程（cancelScheduledSupervisorAssignment）");
  }
  if (input.endAt.getTime() <= assignment.validFrom.getTime()) {
    throw new GovernanceValidationError(["終止時間必須晚於生效時間"]);
  }
  if (assignment.validUntil !== null && input.endAt.getTime() >= assignment.validUntil.getTime()) {
    throw new GovernanceStateError("此指派已設定較早或相同的終止時間，不得延後");
  }

  const updated = await tx.userSupervisorAssignment.update({
    where: { id: assignment.id },
    data: { validUntil: input.endAt },
  });

  await writeAuditLog(
    {
      entityType: "UserSupervisorAssignment",
      entityId: assignment.id,
      actionType: "SupervisorAssignmentEnded",
      summary: `終止主管指派：使用者「${assignment.userId}」與主管「${assignment.supervisorUserId}」的關係於 ${input.endAt.toISOString()} 終止`,
      actorUserId: input.actorId,
      fromValue: assignment.supervisorUserId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function endSupervisorAssignment(input: EndSupervisorAssignmentInput) {
  return prisma.$transaction((tx) => endSupervisorAssignmentTx(tx, input));
}

// ---------------------------------------------------------------------------
// 取消尚未生效的排程
// ---------------------------------------------------------------------------

export interface CancelScheduledSupervisorAssignmentInput {
  assignmentId: string;
  actorId: string;
  reasonCode: string;
  now?: Date;
}

async function cancelScheduledSupervisorAssignmentTx(tx: Tx, input: CancelScheduledSupervisorAssignmentInput) {
  if (!input.reasonCode?.trim()) throw new GovernanceValidationError(["reasonCode 不得為空"]);

  const ctx = await resolveGovernanceAccessContext(input.actorId, tx);
  if (!ctx.canManageSupervisors) {
    throw new GovernanceAccessDeniedError("僅具備 governance.manageSupervisors 能力者可取消主管指派排程");
  }

  const assignment = await tx.userSupervisorAssignment.findUnique({ where: { id: input.assignmentId } });
  if (!assignment) throw new GovernanceNotFoundError(`找不到主管指派：${input.assignmentId}`);

  const now = input.now ?? new Date();
  if (!assignment.isActive) {
    throw new GovernanceStateError("此指派已被停用");
  }
  if (now.getTime() >= assignment.validFrom.getTime()) {
    throw new GovernanceStateError("此指派已生效，不得取消，請使用終止（endSupervisorAssignment）");
  }

  const updated = await tx.userSupervisorAssignment.update({
    where: { id: assignment.id },
    data: { isActive: false },
  });

  await writeAuditLog(
    {
      entityType: "UserSupervisorAssignment",
      entityId: assignment.id,
      actionType: "SupervisorAssignmentCancelled",
      summary: `取消尚未生效的主管指派：使用者「${assignment.userId}」原排定主管「${assignment.supervisorUserId}」（生效於 ${assignment.validFrom.toISOString()}）`,
      actorUserId: input.actorId,
      fromValue: assignment.supervisorUserId,
      reasonCode: input.reasonCode,
    },
    tx,
  );

  return updated;
}

export async function cancelScheduledSupervisorAssignment(input: CancelScheduledSupervisorAssignmentInput) {
  return prisma.$transaction((tx) => cancelScheduledSupervisorAssignmentTx(tx, input));
}

// ---------------------------------------------------------------------------
// 更換主管：同一 transaction 內依「舊指派是否已生效」二選一（終止 或 取消排程）＋建立新指派
// ---------------------------------------------------------------------------

export interface ReplaceSupervisorAssignmentInput {
  oldAssignmentId: string;
  newSupervisorUserId: string;
  effectiveAt: Date;
  actorId: string;
  reasonCode: string;
  now?: Date;
}

export async function replaceSupervisorAssignment(input: ReplaceSupervisorAssignmentInput) {
  return prisma.$transaction(async (tx) => {
    if (!input.reasonCode?.trim()) throw new GovernanceValidationError(["reasonCode 不得為空"]);

    const old = await tx.userSupervisorAssignment.findUnique({ where: { id: input.oldAssignmentId } });
    if (!old) throw new GovernanceNotFoundError(`找不到主管指派：${input.oldAssignmentId}`);

    const now = input.now ?? new Date();

    if (now.getTime() >= old.validFrom.getTime()) {
      // 情況 A：舊指派已生效 → 半開區間無縫交接
      await endSupervisorAssignmentTx(tx, {
        assignmentId: old.id,
        endAt: input.effectiveAt,
        actorId: input.actorId,
        reasonCode: input.reasonCode,
        now,
      });
    } else {
      // 情況 B：舊指派尚未生效 → 視為取消排程，不得把 validUntil 設成 <= validFrom
      await cancelScheduledSupervisorAssignmentTx(tx, {
        assignmentId: old.id,
        actorId: input.actorId,
        reasonCode: input.reasonCode,
        now,
      });
    }

    return createSupervisorAssignmentTx(tx, {
      userId: old.userId,
      supervisorUserId: input.newSupervisorUserId,
      validFrom: input.effectiveAt,
      isPrimary: true,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
    });
  });
}

// ---------------------------------------------------------------------------
// 查詢（row-level authorization：actorId 現場解析，不信任呼叫端旗標）
// ---------------------------------------------------------------------------

export async function listSupervisorHistory(actorId: string, userId: string) {
  const ctx = await resolveGovernanceAccessContext(actorId);
  if (!ctx.canViewAllGovernance && userId !== actorId) {
    throw new GovernanceAccessDeniedError("只能查看自己的主管歷史紀錄");
  }
  return prisma.userSupervisorAssignment.findMany({ where: { userId }, orderBy: { validFrom: "desc" } });
}

export interface CurrentSupervisorRow {
  userId: string;
  result: EffectiveSupervisorResult;
}

// 一般使用者只回自己那一筆；canViewAllGovernance 時回全部使用者。
export async function listCurrentSupervisors(actorId: string, now: Date = new Date()): Promise<CurrentSupervisorRow[]> {
  const ctx = await resolveGovernanceAccessContext(actorId);
  const scopedUserId = ctx.canViewAllGovernance ? null : actorId;

  const users = await prisma.user.findMany({ where: scopedUserId ? { id: scopedUserId } : {} });
  const assignments = await prisma.userSupervisorAssignment.findMany({
    where: scopedUserId ? { userId: scopedUserId } : {},
  });

  return users.map((u) => ({ userId: u.id, result: getEffectiveSupervisor(assignments, u.id, now) }));
}
