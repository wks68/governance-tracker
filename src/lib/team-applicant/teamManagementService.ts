// 建立工單／團隊整合修正新增：Admin 團隊 CRUD 服務層。
//
// 成員管理權限收斂更新：Team.isActive 已新增（migration 20260729120000_add_team_is_active），
// 因此本檔案改為提供完整的「建立／編輯名稱說明／啟用／停用／（無引用時）永久刪除」。
// 停用只影響「是否能承接新工作」（建立工單的團隊選項、接單資格），既有 membership、
// 已承接工單與所有歷史紀錄一律保留不動。
//
// 授權一律使用 active UserRole（admin.full 能力），不得使用 User.role。

import { prisma } from "../prisma";
import { requireCapability } from "../permissions";
import { writeAuditLog } from "../audit";
import { isTeamDomain, type TeamDomain } from "../constants";

export class TeamManagementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamManagementValidationError";
  }
}

export class TeamManagementStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamManagementStateError";
  }
}

export class TeamManagementAccessDeniedError extends Error {
  constructor(message = "僅系統管理員（Admin）可管理團隊") {
    super(message);
    this.name = "TeamManagementAccessDeniedError";
  }
}

async function requireAdmin(actorId: string) {
  try {
    await requireCapability({ id: actorId }, "admin.full");
  } catch {
    throw new TeamManagementAccessDeniedError();
  }
}

export async function createTeam(input: { name: string; description: string; actorId: string }) {
  await requireAdmin(input.actorId);
  const name = input.name.trim();
  if (!name) throw new TeamManagementValidationError("團隊名稱不得為空");

  const team = await prisma.team.create({ data: { name, description: input.description.trim() } });

  await writeAuditLog({
    entityType: "Team",
    entityId: team.id,
    actionType: "TeamCreated",
    summary: `建立團隊「${team.name}」`,
    actorUserId: input.actorId,
  });

  return team;
}

export async function updateTeam(input: { teamId: string; name: string; description: string; actorId: string }) {
  await requireAdmin(input.actorId);
  const name = input.name.trim();
  if (!name) throw new TeamManagementValidationError("團隊名稱不得為空");

  const existing = await prisma.team.findUnique({ where: { id: input.teamId } });
  if (!existing) throw new TeamManagementStateError("找不到此團隊");

  const changes: string[] = [];
  if (existing.name !== name) changes.push(`名稱：「${existing.name}」→「${name}」`);
  if (existing.description !== input.description.trim()) changes.push(`說明：「${existing.description || "（空白）"}」→「${input.description.trim() || "（空白）"}」`);

  const team = await prisma.team.update({ where: { id: input.teamId }, data: { name, description: input.description.trim() } });

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: "Team",
      entityId: team.id,
      actionType: "TeamUpdated",
      summary: `更新團隊「${existing.name}」：${changes.join("；")}`,
      actorUserId: input.actorId,
    });
  }

  return team;
}

// RD/QA/OP 接單流程新增：Team.domain（RD/QA/OP/BUSINESS/OTHER）設定入口。
//
// domain 是業務判斷（哪個 Team 實際負責 RD/QA/OP），不是程式可以從既有資料推導出來的事實——
// 本函式只提供「設定」入口本身，不提供任何自動判斷／建議／依名稱字串猜測的邏輯。設定或清除
// （傳入 null）domain 皆須明確填寫 reasonCode，並寫入 AuditLog，供稽核追溯「這個 Team 什麼
// 時候被誰分類成什麼領域」。
//
// 授權沿用本檔案既有慣例：僅具備 "team.manageDomain" 能力者（目前僅 Admin）可呼叫，見
// src/lib/permissions.ts。與 admin.full／team CRUD 分開宣告獨立能力，因為兩者語意不同——
// 「能不能管理 Team CRUD」跟「能不能分類 Team 領域」是可以分開授權的兩件事，即使目前兩者的
// 實際持有者集合相同。
async function requireManageDomainCapability(actorId: string) {
  try {
    await requireCapability({ id: actorId }, "team.manageDomain");
  } catch {
    throw new TeamManagementAccessDeniedError('僅具備 "team.manageDomain" 能力者可設定 Team 領域分類');
  }
}

export async function setTeamDomain(input: { teamId: string; domain: TeamDomain | null; actorId: string; reasonCode: string }) {
  await requireManageDomainCapability(input.actorId);
  if (!input.reasonCode?.trim()) throw new TeamManagementValidationError("reasonCode 不得為空");
  if (input.domain !== null && !isTeamDomain(input.domain)) {
    throw new TeamManagementValidationError("domain 不在合法值域（RD/QA/OP/BUSINESS/OTHER）");
  }

  const existing = await prisma.team.findUnique({ where: { id: input.teamId } });
  if (!existing) throw new TeamManagementStateError("找不到此團隊");

  if (existing.domain === input.domain) {
    return existing;
  }

  const team = await prisma.team.update({ where: { id: input.teamId }, data: { domain: input.domain } });

  await writeAuditLog({
    entityType: "Team",
    entityId: team.id,
    actionType: "TeamDomainChanged",
    summary: `設定團隊「${team.name}」領域分類：「${existing.domain ?? "（未分類）"}」→「${input.domain ?? "（未分類）"}」`,
    actorUserId: input.actorId,
    fromValue: existing.domain ?? undefined,
    toValue: input.domain ?? undefined,
    reasonCode: input.reasonCode,
  });

  return team;
}

async function countTeamReferences(teamId: string) {
  const [members, membershipHistory, issues, approvalRecords, delegations, systemMappings] = await Promise.all([
    prisma.teamMember.count({ where: { teamId } }),
    prisma.teamMembershipHistory.count({ where: { teamId } }),
    prisma.issue.count({ where: { assignedTeamId: teamId } }),
    prisma.approvalRecord.count({ where: { approverTeamId: teamId } }),
    prisma.approvalDelegation.count({ where: { teamId } }),
    prisma.systemTeamMapping.count({ where: { teamId } }),
  ]);
  return members + membershipHistory + issues + approvalRecords + delegations + systemMappings;
}

// 唯讀檢查：純供 UI 決定是否顯示「永久刪除」按鈕，不構成授權判斷（實際刪除一律由
// deleteTeamIfUnreferenced 在寫入當下重新檢查）。
export async function isTeamDeletable(teamId: string): Promise<boolean> {
  return (await countTeamReferences(teamId)) === 0;
}

// 只有完全無任何引用（成員、成員歷程、工單、核准紀錄、核准代理、系統對應）的空白團隊才允許
// Admin 永久刪除；有引用一律拒絕（見檔案頂端說明：目前無停用手段，只能拒絕刪除）。
export async function deleteTeamIfUnreferenced(input: { teamId: string; actorId: string }) {
  await requireAdmin(input.actorId);
  const team = await prisma.team.findUnique({ where: { id: input.teamId } });
  if (!team) throw new TeamManagementStateError("找不到此團隊");

  const referenceCount = await countTeamReferences(input.teamId);
  if (referenceCount > 0) {
    throw new TeamManagementStateError("此團隊已被工單、成員歷程或核准紀錄引用，無法直接永久刪除");
  }

  await prisma.team.delete({ where: { id: input.teamId } });

  await writeAuditLog({
    entityType: "Team",
    entityId: input.teamId,
    actionType: "TeamDeleted",
    summary: `永久刪除空白（無引用）團隊「${team.name}」`,
    actorUserId: input.actorId,
  });
}

// ---------------------------------------------------------------------------
// 成員管理權限收斂新增：啟用／停用團隊（Admin only）
//
// 停用不刪除任何資料、不解除任何 membership、不影響既有工單——只讓團隊無法再承接新工作
// （見 teamApplicantService.listCreatableTeamsForActor／claimService.evaluateClaimEligibility）。
// ---------------------------------------------------------------------------

export async function setTeamActiveState(input: { teamId: string; isActive: boolean; actorId: string; reasonCode: string }) {
  await requireAdmin(input.actorId);
  if (!input.reasonCode?.trim()) throw new TeamManagementValidationError("原因不得為空");

  const team = await prisma.team.findUnique({ where: { id: input.teamId } });
  if (!team) throw new TeamManagementValidationError("找不到此團隊");
  if (team.isActive === input.isActive) return team; // no-op：不重寫 AuditLog

  if (!input.isActive) {
    // fail closed：仍有進行中工單指派給此團隊時不得停用，避免出現「無人可處理」的工單。
    const activeIssues = await prisma.issue.count({
      where: { assignedTeamId: input.teamId, workflowStatus: { notIn: ["closed", "cancelled"] } },
    });
    if (activeIssues > 0) {
      throw new TeamManagementStateError(`此團隊尚有 ${activeIssues} 筆未結案工單，不得停用`);
    }
  }

  const updated = await prisma.team.update({ where: { id: input.teamId }, data: { isActive: input.isActive } });

  await writeAuditLog({
    entityType: "Team",
    entityId: team.id,
    actionType: input.isActive ? "TeamActivated" : "TeamDeactivated",
    summary: `${input.isActive ? "啟用" : "停用"}團隊「${team.name}」`,
    actorUserId: input.actorId,
    fromValue: String(team.isActive),
    toValue: String(input.isActive),
    reasonCode: input.reasonCode,
  });

  return updated;
}
