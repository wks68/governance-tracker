// M1.5-B 新增：核准治理健康檢查服務層。
//
// 即時計算，不落地存表。只開放 canViewAllGovernance（Admin／資安推動小組），
// 一般使用者／Team LEAD 一律拒絕（整體治理視角，非個人資料）。
//
// isActive 語意：自然到期（validUntil 已過但 isActive=true）是正常歷史紀錄，不列入
// 任何異常；只有「isActive 與撤銷欄位不一致」才列入（見第 5 項）。
//
// 「沒有可用核准人的 Team」一律透過 getEligibleApprovers 的真實資格邏輯計算，不得只
// 查 Delegation 資料列——技術代理只有在 delegator 目前仍是該 Team 的有效 LEAD 時，
// getEligibleApprovers 才會把代理人算進 eligible，這一點已由 permissions.ts 既有邏輯
// 保證，本檔案不重新實作一份。

import { prisma } from "./prisma";
import {
  resolveGovernanceAccessContext,
  getEffectiveSupervisor,
  findSupervisorCyclesByTimeWindow,
  getEligibleApprovers,
  type TeamMembershipLike,
} from "./permissions";
import { isApprovalType, isTeamMembershipRole, type ApprovalType } from "./constants";
import { windowsOverlap, isWithinHalfOpenWindow } from "./timeWindow";
import { delegatorHasOriginalAuthority } from "./approvalDelegationService";
import { GovernanceAccessDeniedError } from "./supervisorAssignmentService";

export type HealthSeverity = "normal" | "warning" | "critical";

export interface HealthFindingItem {
  id: string;
  description: string;
}

export interface HealthFinding {
  checkKey: string;
  label: string;
  severity: HealthSeverity;
  items: HealthFindingItem[];
}

export interface GovernanceHealthReport {
  overallSeverity: HealthSeverity;
  findings: HealthFinding[];
  computedAt: Date;
}

export interface GetApprovalGovernanceHealthOptions {
  expiringWithinDays?: number; // 預設 7
  now?: Date;
}

const TECHNICAL_APPROVAL_TYPES: readonly ApprovalType[] = ["RD_LEAD_APPROVAL", "QA_LEAD_APPROVAL", "DEPLOYMENT_APPROVAL"];

function buildFinding(checkKey: string, label: string, categorySeverity: HealthSeverity, items: HealthFindingItem[]): HealthFinding {
  return { checkKey, label, severity: items.length > 0 ? categorySeverity : "normal", items };
}

function toTeamMembershipLikeList(
  rows: readonly { teamId: string; userId: string; membershipRole: string; isActive: boolean }[],
): TeamMembershipLike[] {
  const result: TeamMembershipLike[] = [];
  for (const m of rows) {
    if (!isTeamMembershipRole(m.membershipRole)) continue; // deny-by-default：非法值域資料視為無有效成員身分
    result.push({ teamId: m.teamId, userId: m.userId, membershipRole: m.membershipRole, isActive: m.isActive });
  }
  return result;
}

export async function getApprovalGovernanceHealth(
  actorId: string,
  options: GetApprovalGovernanceHealthOptions = {},
): Promise<GovernanceHealthReport> {
  const ctx = await resolveGovernanceAccessContext(actorId);
  if (!ctx.canViewAllGovernance) {
    throw new GovernanceAccessDeniedError("僅 Admin／資安推動小組可查看核准治理健康檢查");
  }

  const now = options.now ?? new Date();
  const expiringWithinDays = options.expiringWithinDays ?? 7;

  const [users, teams, teamMembers, supervisorAssignments, delegations, systems, systemTeamMappings] = await Promise.all([
    prisma.user.findMany(),
    prisma.team.findMany(),
    prisma.teamMember.findMany(),
    prisma.userSupervisorAssignment.findMany(),
    prisma.approvalDelegation.findMany(),
    prisma.system.findMany(),
    prisma.systemTeamMapping.findMany(),
  ]);

  const teamMembershipLikes = toTeamMembershipLikeList(teamMembers);

  const findings: HealthFinding[] = [
    checkUsersWithoutPrimarySupervisor(users, supervisorAssignments, now),
    checkSupervisorCycles(supervisorAssignments),
    checkTeamsWithoutLead(teams, teamMembers),
    checkTeamsWithoutEligibleApprover(teams, teamMembershipLikes, delegations, now),
    checkDelegationActiveRevocationConsistency(delegations),
    checkDelegationsExpiringSoon(delegations, now, expiringWithinDays),
    checkOverlappingPrimarySupervisors(supervisorAssignments),
    checkOverlappingDelegations(delegations),
    checkSystemsWithoutTeamMapping(systems, systemTeamMappings),
    checkTeamsWithoutActiveMember(teams, teamMembers),
    checkInactiveUsersWithActiveSettings(users, supervisorAssignments, delegations, now),
    await checkDelegatorsWithoutOriginalAuthority(delegations, now),
  ];

  const overallSeverity: HealthSeverity = findings.some((f) => f.severity === "critical")
    ? "critical"
    : findings.some((f) => f.severity === "warning")
      ? "warning"
      : "normal";

  return { overallSeverity, findings, computedAt: now };
}

// ---------------------------------------------------------------------------
// 12 項檢查
// ---------------------------------------------------------------------------

function checkUsersWithoutPrimarySupervisor(
  users: readonly { id: string; name: string; isActive: boolean }[],
  assignments: Parameters<typeof getEffectiveSupervisor>[0],
  now: Date,
): HealthFinding {
  const items: HealthFindingItem[] = [];
  for (const u of users) {
    if (!u.isActive) continue;
    const result = getEffectiveSupervisor(assignments, u.id, now);
    if (result.kind === "none") {
      items.push({ id: u.id, description: `使用者「${u.name}」(${u.id}) 目前沒有有效的 primary 主管` });
    } else if (result.kind === "configError") {
      items.push({ id: u.id, description: `使用者「${u.name}」(${u.id}) 存在多筆重疊的 primary 主管指派，設定衝突` });
    }
  }
  return buildFinding("usersWithoutPrimarySupervisor", "沒有有效 primary 主管的使用者", "warning", items);
}

function checkSupervisorCycles(assignments: Parameters<typeof findSupervisorCyclesByTimeWindow>[0]): HealthFinding {
  const cycles = findSupervisorCyclesByTimeWindow(assignments);
  const items = cycles.map((c, idx) => ({
    id: `cycle-${idx}`,
    description: `主管循環：${[...c.userIds, c.userIds[0]].join(" → ")}（自 ${c.overlapFrom.toISOString()} 起${
      c.overlapUntil ? `至 ${c.overlapUntil.toISOString()}` : "持續中"
    }）`,
  }));
  return buildFinding("supervisorCycles", "存在主管循環", "critical", items);
}

function checkTeamsWithoutLead(
  teams: readonly { id: string; name: string }[],
  teamMembers: readonly { teamId: string; isActive: boolean; membershipRole: string }[],
): HealthFinding {
  const leadTeamIds = new Set(teamMembers.filter((m) => m.isActive && m.membershipRole === "LEAD").map((m) => m.teamId));
  const items = teams
    .filter((t) => !leadTeamIds.has(t.id))
    .map((t) => ({ id: t.id, description: `Team「${t.name}」(${t.id}) 目前沒有有效的 LEAD` }));
  return buildFinding("teamsWithoutLead", "沒有有效 LEAD 的 Team", "warning", items);
}

function checkTeamsWithoutEligibleApprover(
  teams: readonly { id: string; name: string }[],
  teamMemberships: readonly TeamMembershipLike[],
  delegations: Parameters<typeof getEligibleApprovers>[0]["delegations"],
  now: Date,
): HealthFinding {
  const items: HealthFindingItem[] = [];
  for (const t of teams) {
    const emptyTypes: string[] = [];
    for (const approvalType of TECHNICAL_APPROVAL_TYPES) {
      const eligible = getEligibleApprovers({
        approvalType,
        requestedByUserId: "",
        teamId: t.id,
        supervisorAssignments: [],
        teamMemberships,
        delegations,
        now,
      });
      if (eligible.length === 0) emptyTypes.push(approvalType);
    }
    if (emptyTypes.length > 0) {
      items.push({ id: t.id, description: `Team「${t.name}」(${t.id}) 對以下核准類型沒有任何可用核准人：${emptyTypes.join("、")}` });
    }
  }
  return buildFinding("teamsWithoutEligibleApprover", "沒有可用核准人的 Team", "critical", items);
}

function checkDelegationActiveRevocationConsistency(
  delegations: readonly {
    id: string;
    delegatorUserId: string;
    delegateUserId: string;
    isActive: boolean;
    revokedAt: Date | null;
    revokedByUserId: string | null;
    revocationReason: string | null;
  }[],
): HealthFinding {
  const items: HealthFindingItem[] = [];
  for (const d of delegations) {
    if (d.revokedAt !== null && d.isActive) {
      items.push({ id: d.id, description: `代理 ${d.id}（${d.delegatorUserId}→${d.delegateUserId}）已有撤銷資訊卻仍標示為有效` });
    } else if (!d.isActive && (d.revokedAt === null || d.revokedByUserId === null || !d.revocationReason)) {
      items.push({ id: d.id, description: `代理 ${d.id}（${d.delegatorUserId}→${d.delegateUserId}）標示為停用但缺少完整撤銷留痕` });
    }
  }
  return buildFinding("delegationActiveRevocationInconsistency", "代理 isActive 與撤銷欄位不一致", "critical", items);
}

function checkDelegationsExpiringSoon(
  delegations: readonly {
    id: string;
    delegatorUserId: string;
    delegateUserId: string;
    isActive: boolean;
    revokedAt: Date | null;
    validUntil: Date;
  }[],
  now: Date,
  days: number,
): HealthFinding {
  const threshold = now.getTime() + days * 24 * 60 * 60 * 1000;
  const items = delegations
    .filter((d) => d.isActive && d.revokedAt === null && d.validUntil.getTime() >= now.getTime() && d.validUntil.getTime() < threshold)
    .map((d) => ({ id: d.id, description: `代理 ${d.id}（${d.delegatorUserId}→${d.delegateUserId}）將於 ${d.validUntil.toISOString()} 到期` }));
  return buildFinding("delegationsExpiringSoon", `${days} 天內到期的代理`, "warning", items);
}

interface OverlapCheckAssignment {
  id: string;
  userId: string;
  isPrimary: boolean;
  isActive: boolean;
  validFrom: Date;
  validUntil: Date | null;
}

function checkOverlappingPrimarySupervisors(assignments: readonly OverlapCheckAssignment[]): HealthFinding {
  const items: HealthFindingItem[] = [];
  const byUser = new Map<string, OverlapCheckAssignment[]>();
  for (const a of assignments) {
    if (!a.isPrimary || !a.isActive) continue;
    const arr = byUser.get(a.userId) ?? [];
    arr.push(a);
    byUser.set(a.userId, arr);
  }
  for (const [userId, list] of byUser) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (windowsOverlap(list[i].validFrom, list[i].validUntil, list[j].validFrom, list[j].validUntil)) {
          items.push({
            id: `${list[i].id}:${list[j].id}`,
            description: `使用者「${userId}」的兩筆 primary 主管指派時間重疊（${list[i].id} 與 ${list[j].id}）`,
          });
        }
      }
    }
  }
  return buildFinding("overlappingPrimarySupervisors", "重疊 primary 主管期間", "critical", items);
}

interface OverlapCheckDelegation {
  id: string;
  delegatorUserId: string;
  approvalType: string;
  teamId: string | null;
  isActive: boolean;
  validFrom: Date;
  validUntil: Date;
}

function checkOverlappingDelegations(delegations: readonly OverlapCheckDelegation[]): HealthFinding {
  const items: HealthFindingItem[] = [];
  const byScope = new Map<string, OverlapCheckDelegation[]>();
  for (const d of delegations) {
    if (!d.isActive) continue;
    const key = `${d.delegatorUserId}|${d.approvalType}|${d.teamId ?? ""}`;
    const arr = byScope.get(key) ?? [];
    arr.push(d);
    byScope.set(key, arr);
  }
  for (const list of byScope.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (windowsOverlap(list[i].validFrom, list[i].validUntil, list[j].validFrom, list[j].validUntil)) {
          items.push({
            id: `${list[i].id}:${list[j].id}`,
            description: `代理 ${list[i].id} 與 ${list[j].id} 時間重疊（委託人「${list[i].delegatorUserId}」，${list[i].approvalType}）`,
          });
        }
      }
    }
  }
  return buildFinding("overlappingDelegations", "重疊代理期間", "critical", items);
}

function checkSystemsWithoutTeamMapping(
  systems: readonly { id: string; key: string; name: string; isActive: boolean }[],
  mappings: readonly { systemId: string; isActive: boolean }[],
): HealthFinding {
  const mappedSystemIds = new Set(mappings.filter((m) => m.isActive).map((m) => m.systemId));
  const items = systems
    .filter((s) => s.isActive && !mappedSystemIds.has(s.id))
    .map((s) => ({ id: s.id, description: `System「${s.name}」(${s.key}) 沒有對應任何啟用中的 Team` }));
  return buildFinding("systemsWithoutTeamMapping", "無對應 Team 的 System", "warning", items);
}

function checkTeamsWithoutActiveMember(
  teams: readonly { id: string; name: string }[],
  teamMembers: readonly { teamId: string; isActive: boolean }[],
): HealthFinding {
  const activeMemberTeamIds = new Set(teamMembers.filter((m) => m.isActive).map((m) => m.teamId));
  const items = teams
    .filter((t) => !activeMemberTeamIds.has(t.id))
    .map((t) => ({ id: t.id, description: `Team「${t.name}」(${t.id}) 沒有任何啟用中的成員` }));
  return buildFinding("teamsWithoutActiveMember", "無有效 TeamMember 的 Team", "warning", items);
}

function checkInactiveUsersWithActiveSettings(
  users: readonly { id: string; isActive: boolean }[],
  assignments: readonly { id: string; userId: string; supervisorUserId: string; isActive: boolean; validFrom: Date; validUntil: Date | null }[],
  delegations: readonly { id: string; delegatorUserId: string; delegateUserId: string; isActive: boolean; validFrom: Date; validUntil: Date }[],
  now: Date,
): HealthFinding {
  const items: HealthFindingItem[] = [];
  const inactiveUserIds = new Set(users.filter((u) => !u.isActive).map((u) => u.id));

  for (const a of assignments) {
    if (!a.isActive || !isWithinHalfOpenWindow(a.validFrom, a.validUntil, now)) continue;
    if (inactiveUserIds.has(a.userId)) {
      items.push({ id: `assignment-${a.id}-user`, description: `已停用使用者「${a.userId}」仍是有效主管指派 ${a.id} 的當事人` });
    }
    if (inactiveUserIds.has(a.supervisorUserId)) {
      items.push({ id: `assignment-${a.id}-supervisor`, description: `已停用使用者「${a.supervisorUserId}」仍是有效主管指派 ${a.id} 的主管` });
    }
  }
  for (const d of delegations) {
    if (!d.isActive || !isWithinHalfOpenWindow(d.validFrom, d.validUntil, now)) continue;
    if (inactiveUserIds.has(d.delegatorUserId)) {
      items.push({ id: `delegation-${d.id}-delegator`, description: `已停用使用者「${d.delegatorUserId}」仍是有效代理 ${d.id} 的委託人` });
    }
    if (inactiveUserIds.has(d.delegateUserId)) {
      items.push({ id: `delegation-${d.id}-delegate`, description: `已停用使用者「${d.delegateUserId}」仍是有效代理 ${d.id} 的代理人` });
    }
  }
  return buildFinding("inactiveUsersWithActiveSettings", "使用者已停用但仍存在有效主管或代理設定", "critical", items);
}

async function checkDelegatorsWithoutOriginalAuthority(
  delegations: readonly { id: string; approvalType: string; teamId: string | null; delegatorUserId: string; isActive: boolean }[],
  now: Date,
): Promise<HealthFinding> {
  const items: HealthFindingItem[] = [];
  for (const d of delegations) {
    if (!d.isActive) continue;
    if (!isApprovalType(d.approvalType)) continue; // deny-by-default：非法值域資料略過，不誤判
    const hasAuthority = await delegatorHasOriginalAuthority(prisma, {
      approvalType: d.approvalType,
      teamId: d.teamId,
      delegatorUserId: d.delegatorUserId,
      now,
    });
    if (!hasAuthority) {
      items.push({ id: d.id, description: `代理 ${d.id} 的委託人「${d.delegatorUserId}」已不再具有原始核准資格（${d.approvalType}）` });
    }
  }
  return buildFinding("delegatorsWithoutOriginalAuthority", "代理委託人已不再具有原始核准資格", "critical", items);
}
