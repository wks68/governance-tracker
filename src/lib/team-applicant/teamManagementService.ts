// 建立工單／團隊整合修正新增：Admin 團隊 CRUD 服務層。
//
// 重要資料模型缺口（本輪不新增 Schema／Migration，詳見最終報告）：Team model 目前沒有
// isActive／disabledAt 等欄位，因此「啟用團隊／停用團隊」這個規格要求的動作在目前資料模型下
// 無法表示——本檔案只能提供「建立／編輯名稱說明／（無引用時）永久刪除」，不提供停用。
// 已被引用的團隊在目前資料模型下沒有任何下架手段（既不能停用、也不能刪除），只能繼續存在於
// 團隊清單中；這是本檔案刻意的 fail-closed 選擇（寧可不提供停用，也不冒用其他欄位或刪除有
// 引用的資料列冒充停用）。
//
// 授權一律使用 active UserRole（admin.full 能力），不得使用 User.role。

import { prisma } from "../prisma";
import { requireCapability } from "../permissions";
import { writeAuditLog } from "../audit";

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
