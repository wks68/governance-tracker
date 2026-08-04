// M1.5-B 新增：核准代理管理服務層。
//
// 「誰能操作代理」（write path 所有權）與「代理資格是否成立」是兩層獨立檢查：
// - 所有權：actorId===delegatorUserId（自己的代理）或具備 governance.manageAnyDelegation
//   （Admin 代任何 delegator 操作）。跟角色、跟是不是同 Team 的另一位 LEAD 都無關——
//   Team LEAD 不得撤銷同 Team 其他 LEAD 建立的代理。
// - 資格：delegatorHasOriginalAuthority 驗證 delegator 目前是否真的具備原始核准資格
//   （BUSINESS：目前是否為任何人的有效 primary 主管；技術類：目前是否為指定 Team 的
//   有效 LEAD）。建立時必查（不論操作者是本人或 Admin），撤銷不查（撤銷本來就是要
//   清掉失效代理的正常動作，不該被「已經沒資格了」擋住）。
//
// Transaction 邊界規則與其他治理服務相同：私有 xxxTx 函式接受既有 tx，公開函式負責
// 開啟 prisma.$transaction。

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { resolveGovernanceAccessContext, wouldCreateDelegationChainOrCycle, isCurrentPrimarySupervisorOfAnyone } from "./permissions";
import { isApprovalType, type ApprovalType } from "./constants";
import { windowsOverlap } from "./timeWindow";
import { writeAuditLog } from "./audit";
import {
  GovernanceValidationError,
  GovernanceNotFoundError,
  GovernanceStateError,
  GovernanceAccessDeniedError,
} from "./supervisorAssignmentService";

type Tx = Prisma.TransactionClient;

const TEAM_LEAD_APPROVAL_TYPES: ReadonlySet<ApprovalType> = new Set(["RD_LEAD_APPROVAL", "QA_LEAD_APPROVAL", "DEPLOYMENT_APPROVAL"]);

// 供建立時把關，也供健康檢查第 12 項共用同一份判斷。
export async function delegatorHasOriginalAuthority(
  tx: Tx,
  params: { approvalType: ApprovalType; teamId: string | null; delegatorUserId: string; now: Date },
): Promise<boolean> {
  if (params.approvalType === "BUSINESS_APPROVAL") {
    const assignments = await tx.userSupervisorAssignment.findMany({
      where: { supervisorUserId: params.delegatorUserId },
    });
    return isCurrentPrimarySupervisorOfAnyone(assignments, params.delegatorUserId, params.now);
  }
  if (!params.teamId) return false;
  const membership = await tx.teamMember.findFirst({
    where: { teamId: params.teamId, userId: params.delegatorUserId, membershipRole: "LEAD", isActive: true },
  });
  return membership !== null;
}

// ---------------------------------------------------------------------------
// 建立
// ---------------------------------------------------------------------------

export interface CreateApprovalDelegationInput {
  delegatorUserId: string;
  delegateUserId: string;
  approvalType: ApprovalType;
  teamId?: string | null;
  validFrom: Date;
  validUntil: Date; // 必填
  reason?: string; // schema 既有欄位，業務理由，選填
  actorId: string;
  reasonCode?: string | null; // 只有 Admin 代他人（actorId≠delegatorUserId）建立時必填
}

async function createApprovalDelegationTx(tx: Tx, input: CreateApprovalDelegationInput) {
  const issues: string[] = [];
  if (!isApprovalType(input.approvalType)) issues.push("approvalType 不在合法值域");
  if (!input.delegatorUserId) issues.push("delegatorUserId 不得為空");
  if (!input.delegateUserId) issues.push("delegateUserId 不得為空");
  if (input.delegatorUserId && input.delegateUserId && input.delegatorUserId === input.delegateUserId) {
    issues.push("不得自行代理給自己");
  }
  if (!input.validUntil || input.validUntil.getTime() <= input.validFrom.getTime()) {
    issues.push("validUntil 為必填且必須晚於 validFrom");
  }
  const isTeamLeadType = TEAM_LEAD_APPROVAL_TYPES.has(input.approvalType);
  if (isTeamLeadType && !input.teamId) issues.push("技術核准代理必須指定 teamId");
  if (input.approvalType === "BUSINESS_APPROVAL" && input.teamId) issues.push("BUSINESS_APPROVAL 代理的 teamId 必須為 null");
  if (issues.length > 0) throw new GovernanceValidationError(issues);

  const isSelf = input.actorId === input.delegatorUserId;
  const ctx = await resolveGovernanceAccessContext(input.actorId, tx);
  if (!isSelf && !ctx.canManageAnyDelegation) {
    throw new GovernanceAccessDeniedError("只能建立自己是委託人（delegator）的代理，或由 Admin 代為建立");
  }
  if (!isSelf && !input.reasonCode?.trim()) {
    throw new GovernanceValidationError(["Admin 代他人建立代理時 reasonCode 必填"]);
  }

  const [delegatorRow, delegateRow, teamRow] = await Promise.all([
    tx.user.findUnique({ where: { id: input.delegatorUserId } }),
    tx.user.findUnique({ where: { id: input.delegateUserId } }),
    input.teamId ? tx.team.findUnique({ where: { id: input.teamId } }) : Promise.resolve(null),
  ]);
  const existenceIssues: string[] = [];
  if (!delegatorRow) existenceIssues.push("delegatorUserId 對應的使用者不存在");
  if (!delegateRow) existenceIssues.push("delegateUserId 對應的使用者不存在");
  if (input.teamId && !teamRow) existenceIssues.push("teamId 對應的 Team 不存在");
  if (existenceIssues.length > 0) throw new GovernanceValidationError(existenceIssues);

  const now = new Date();
  const hasAuthority = await delegatorHasOriginalAuthority(tx, {
    approvalType: input.approvalType,
    teamId: input.teamId ?? null,
    delegatorUserId: input.delegatorUserId,
    now,
  });
  if (!hasAuthority) {
    throw new GovernanceStateError(
      "delegator 目前不具備原始核准資格（BUSINESS_APPROVAL：不是任何人的有效 primary 主管；技術類：不是指定 Team 的有效 LEAD），不得建立代理",
    );
  }

  const sameTypeDelegations = await tx.approvalDelegation.findMany({ where: { approvalType: input.approvalType } });
  if (wouldCreateDelegationChainOrCycle(sameTypeDelegations, input.delegatorUserId, input.delegateUserId, input.approvalType, now)) {
    throw new GovernanceStateError("此代理會形成循環代理或轉委託鏈，不得建立");
  }

  const sameScope = sameTypeDelegations.filter(
    (d) => d.delegatorUserId === input.delegatorUserId && d.teamId === (input.teamId ?? null) && d.isActive,
  );
  const overlap = sameScope.some((d) => windowsOverlap(d.validFrom, d.validUntil, input.validFrom, input.validUntil));
  if (overlap) {
    throw new GovernanceStateError("此委託人在指定期間、範圍已存在重疊的有效代理");
  }

  const created = await tx.approvalDelegation.create({
    data: {
      delegatorUserId: input.delegatorUserId,
      delegateUserId: input.delegateUserId,
      approvalType: input.approvalType,
      teamId: input.teamId ?? null,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      reason: input.reason ?? "",
      createdByUserId: input.actorId,
    },
  });

  await writeAuditLog(
    {
      entityType: "ApprovalDelegation",
      entityId: created.id,
      actionType: "ApprovalDelegationCreated",
      summary: `建立核准代理：「${input.delegatorUserId}」委託「${input.delegateUserId}」處理 ${input.approvalType}${input.teamId ? `（Team ${input.teamId}）` : ""}`,
      actorUserId: input.actorId,
      toValue: input.delegateUserId,
      reasonCode: input.reasonCode ?? undefined,
    },
    tx,
  );

  return created;
}

export async function createApprovalDelegation(input: CreateApprovalDelegationInput) {
  return prisma.$transaction((tx) => createApprovalDelegationTx(tx, input));
}

// ---------------------------------------------------------------------------
// 撤銷
// ---------------------------------------------------------------------------

export interface RevokeApprovalDelegationInput {
  delegationId: string;
  actorId: string;
  revocationReason: string; // 一律必填，不分自助或代操作
}

async function revokeApprovalDelegationTx(tx: Tx, input: RevokeApprovalDelegationInput) {
  if (!input.revocationReason?.trim()) throw new GovernanceValidationError(["revocationReason 不得為空"]);

  const delegation = await tx.approvalDelegation.findUnique({ where: { id: input.delegationId } });
  if (!delegation) throw new GovernanceNotFoundError(`找不到代理紀錄：${input.delegationId}`);

  const isSelf = input.actorId === delegation.delegatorUserId;
  const ctx = await resolveGovernanceAccessContext(input.actorId, tx);
  if (!isSelf && !ctx.canManageAnyDelegation) {
    throw new GovernanceAccessDeniedError("只能撤銷自己是委託人（delegator）的代理，或由 Admin 代為撤銷");
  }

  if (!delegation.isActive) {
    throw new GovernanceStateError("此代理已被撤銷或停用");
  }

  const updated = await tx.approvalDelegation.update({
    where: { id: delegation.id },
    data: {
      isActive: false,
      revokedAt: new Date(),
      revokedByUserId: input.actorId,
      revocationReason: input.revocationReason,
    },
  });

  await writeAuditLog(
    {
      entityType: "ApprovalDelegation",
      entityId: delegation.id,
      actionType: "ApprovalDelegationRevoked",
      summary: `撤銷核准代理：「${delegation.delegatorUserId}」委託「${delegation.delegateUserId}」處理 ${delegation.approvalType} 的代理已撤銷`,
      actorUserId: input.actorId,
      fromValue: delegation.delegateUserId,
      reasonCode: input.revocationReason,
    },
    tx,
  );

  return updated;
}

export async function revokeApprovalDelegation(input: RevokeApprovalDelegationInput) {
  return prisma.$transaction((tx) => revokeApprovalDelegationTx(tx, input));
}

// ---------------------------------------------------------------------------
// 查詢（row-level authorization）
// ---------------------------------------------------------------------------

export interface ListDelegationsFilter {
  delegatorUserId?: string;
  teamId?: string;
  approvalType?: ApprovalType;
  includeHistory?: boolean; // 預設 false：只回有效＋未來排程
}

export async function listDelegations(actorId: string, filter: ListDelegationsFilter = {}) {
  const ctx = await resolveGovernanceAccessContext(actorId);

  if (!ctx.canViewAllGovernance) {
    if (filter.delegatorUserId && filter.delegatorUserId !== actorId) {
      throw new GovernanceAccessDeniedError("不得查詢他人為委託人的代理");
    }
    if (filter.teamId && !ctx.ledTeamIds.includes(filter.teamId)) {
      throw new GovernanceAccessDeniedError("只能查詢自己領導 Team 的技術代理");
    }
  }

  const where: Prisma.ApprovalDelegationWhereInput = {};
  if (filter.approvalType) where.approvalType = filter.approvalType;
  if (!filter.includeHistory) where.isActive = true;

  if (ctx.canViewAllGovernance) {
    if (filter.delegatorUserId) where.delegatorUserId = filter.delegatorUserId;
    if (filter.teamId) where.teamId = filter.teamId;
  } else if (filter.delegatorUserId || filter.teamId) {
    // 已個別驗證過在授權範圍內
    if (filter.delegatorUserId) where.delegatorUserId = filter.delegatorUserId;
    if (filter.teamId) where.teamId = filter.teamId;
  } else {
    where.OR = [
      { delegatorUserId: actorId },
      { delegateUserId: actorId },
      ...(ctx.ledTeamIds.length > 0 ? [{ teamId: { in: ctx.ledTeamIds } }] : []),
    ];
  }

  return prisma.approvalDelegation.findMany({ where, orderBy: { validFrom: "desc" } });
}
