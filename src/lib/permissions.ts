// M1 新增：集中式權限判斷模組
//
// 設計原則（deny-by-default）：
// - 任何未被明確授予的能力（Capability）一律視為「不允許」，不得有隱性放行。
// - 無法辨識的角色字串（例如未來資料髒污或打字錯誤）視為「無任何能力」，而非退回某個預設能力組合。
//
// 相容性：
// - User.role（既有單一角色欄位）繼續作為主要角色來源，不刪除、不改名、不改型別。
// - UserRole（M1 新增，允許同一帳號擁有多個角色）與 User.role 取「聯集」，任一來源授予的能力即視為擁有。
//
// 本檔案的純邏輯函式（roleCapabilities / unionCapabilities / hasCapability 等）刻意不依賴 Prisma 查詢，
// 可在 Migration 套用前即可單元測試；DB 查詢型的便利函式（getUserCapabilities 等）需要 UserRole /
// TeamMember 資料表已存在，須等 M1-B 套用 Migration 後才能實際驗證。

import type { User, Prisma, PrismaClient } from "@prisma/client";
import type { RoleKey, TeamMembershipRole, ApprovalType } from "./constants";
import { ROLES, isTeamMembershipRole } from "./constants";
import { prisma } from "./prisma";
import { isWithinHalfOpenWindow } from "./timeWindow";

export type Capability =
  | "issue.view"
  | "issue.edit"
  | "issue.approve"
  | "issue.assignTeam"
  | "team.manageMembers"
  | "user.manageRoles"
  | "admin.full"
  // ---- M1.5-B 新增：核准治理設定管理能力 ----
  // 這些能力只決定「能不能改治理設定」，跟「這筆設定本身有沒有核准資格」是兩件事；
  // 後者永遠交由 getEligibleApprovers／canApproveStage 依實際紀錄判斷，不受這裡影響。
  | "governance.manageSupervisors"
  | "governance.manageTeamLeads"
  | "governance.manageAnyDelegation"
  | "governance.viewAllGovernance"
  // ---- C1-B2 新增：人員管理細粒度能力（供 C1-B3 peopleService 使用；本輪僅定義與角色映射） ----
  | "user.view"
  | "user.create"
  | "user.update"
  | "user.activate"
  | "user.deactivate"
  | "user.assignRole"
  | "user.removeRole"
  | "team.view"
  // ---- M2-A 新增：Workflow 定義／版本管理能力（只管「誰能編輯流程定義」，
  // 跟「誰能在某張 Issue 上執行某個 transition」（M2-B validateActorForCurrentStage
  // 現場判斷）是兩層，互不影響） ----
  | "workflow.view"
  | "workflow.manageDraft"
  | "workflow.publish"
  | "workflow.archive";

const VALID_ROLE_KEYS: ReadonlySet<string> = new Set(ROLES.map((r) => r.key));

// 既有角色 → 能力對照表（M1-A 範圍內的合理預設；未來里程碑可再擴充，但既有 key 不得移除）
const ROLE_CAPABILITIES: Record<RoleKey, readonly Capability[]> = {
  PM: ["issue.view", "issue.edit"],
  RD: ["issue.view", "issue.edit"],
  QA: ["issue.view", "issue.edit", "issue.approve"],
  OP: ["issue.view", "issue.edit"],
  // C1-B2：新增 user.view／team.view（唯讀查看），不得取得新增、修改、角色、啟停或 Team 成員管理能力。
  // M2-A：資安推動小組僅 workflow.view（唯讀），不得管理草稿／發布／封存。
  資安推動小組: ["issue.view", "issue.approve", "governance.viewAllGovernance", "user.view", "team.view", "workflow.view"],
  DMS主管: ["issue.view", "issue.edit", "issue.approve", "issue.assignTeam"],
  Admin: [
    "issue.view",
    "issue.edit",
    "issue.approve",
    "issue.assignTeam",
    "team.manageMembers",
    "user.manageRoles",
    "admin.full",
    "governance.manageSupervisors",
    "governance.manageTeamLeads",
    "governance.manageAnyDelegation",
    "governance.viewAllGovernance",
    // ---- C1-B2 新增：人員／Team 管理細粒度能力，Admin 取得全部 ----
    "user.view",
    "user.create",
    "user.update",
    "user.activate",
    "user.deactivate",
    "user.assignRole",
    "user.removeRole",
    "team.view",
    // ---- M2-A 新增：Workflow 定義／版本管理，Admin 全開 ----
    "workflow.view",
    "workflow.manageDraft",
    "workflow.publish",
    "workflow.archive",
  ],
};

function isKnownRoleKey(role: string): role is RoleKey {
  return VALID_ROLE_KEYS.has(role);
}

// 單一角色字串 → 能力集合。deny-by-default：無法辨識的角色回傳空集合，不套用任何預設能力。
export function roleCapabilities(role: string): ReadonlySet<Capability> {
  if (!isKnownRoleKey(role)) return new Set();
  return new Set(ROLE_CAPABILITIES[role]);
}

// 多個角色字串（例如 legacy User.role + UserRole 多筆）取聯集
export function unionCapabilities(roles: readonly string[]): ReadonlySet<Capability> {
  const result = new Set<Capability>();
  for (const role of roles) {
    for (const cap of roleCapabilities(role)) result.add(cap);
  }
  return result;
}

// 純邏輯角色去重工具。
//
// C1-B2：active UserRole 是唯一系統角色授權來源，全域只有這一套角色解析語意——不論
// 同步或 DB-backed，一律只依呼叫端明確提供的 active UserRole 角色集合，不得從 User.role
// 推導能力。本函式與 hasCapability／requireCapabilitySync 因此不接受 User 物件、
// 不接受「User.role + extraRoles」的舊介面，只接受呼叫端已經明確持有的角色字串陣列
// （DB 版本見下方 getUserEffectiveRoles，內部同樣呼叫本函式，確保語意單一）。
export function effectiveRoles(roleKeys: readonly string[]): string[] {
  return [...new Set(roleKeys)];
}

export function hasCapability(roleKeys: readonly string[], capability: Capability): boolean {
  const caps = unionCapabilities(effectiveRoles(roleKeys));
  return caps.has(capability);
}

export class PermissionDeniedError extends Error {
  constructor(capability: Capability) {
    super(`權限不足：缺少能力 "${capability}"`);
    this.name = "PermissionDeniedError";
  }
}

// deny-by-default，未擁有能力時拋出 PermissionDeniedError
export function requireCapabilitySync(roleKeys: readonly string[], capability: Capability): void {
  if (!hasCapability(roleKeys, capability)) {
    throw new PermissionDeniedError(capability);
  }
}

// ---------------------------------------------------------------------------
// Team 成員身分（MEMBER／LEAD）判斷
// ---------------------------------------------------------------------------

export interface TeamMembershipLike {
  teamId: string;
  userId: string;
  membershipRole: TeamMembershipRole;
  isActive: boolean;
}

// 純邏輯版本：由已取得的成員名單判斷是否為（啟用中的）團隊成員
export function isTeamMember(memberships: readonly TeamMembershipLike[], teamId: string, userId: string): boolean {
  return memberships.some((m) => m.teamId === teamId && m.userId === userId && m.isActive);
}

// 純邏輯版本：由已取得的成員名單判斷是否為（啟用中的）團隊 LEAD
export function isTeamLead(memberships: readonly TeamMembershipLike[], teamId: string, userId: string): boolean {
  return memberships.some(
    (m) => m.teamId === teamId && m.userId === userId && m.isActive && m.membershipRole === "LEAD",
  );
}

// ---------------------------------------------------------------------------
// DB 查詢便利函式（需 UserRole / TeamMember 資料表已存在，等 M1-B 套用 Migration 後才可執行）
// ---------------------------------------------------------------------------

// C1-B2：查詢使用者目前所有有效角色，只讀 active UserRole，完全不回退到 User.role
// （User.role 自本次起只作 primary role 顯示快取／歷史快照，不再是任何真實授權入口的
// 角色來源）。以 `user: { isActive: true }` relation filter 現場查 DB，deny-by-default：
// 不信任呼叫端傳入物件的 isActive 快照（可能過期或被偽造）——即使呼叫端跳過
// getCurrentUser／requireCurrentUser 直接呼叫本函式，inactive User 一律解析出空角色集合，
// fail closed。回傳前呼叫 effectiveRoles 去重，確保與純邏輯版本同一套語意實作。
// 可選 client：寫入服務在自己的 transaction 內解析權限時，應傳入該 transaction 的 tx，
// 避免另開連線在 SQLite 上跟持有寫鎖的 transaction 互相干擾。
export async function getUserEffectiveRoles(
  user: Pick<User, "id">,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<string[]> {
  const userRoles = await client.userRole.findMany({
    where: { userId: user.id, isActive: true, user: { isActive: true } },
  });
  return effectiveRoles(userRoles.map((r) => r.role));
}

// 查詢使用者目前是否擁有指定能力（DB 版本，only active UserRole；inactive User 一律 false）
export async function getUserHasCapability(
  user: Pick<User, "id">,
  capability: Capability,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const roles = await getUserEffectiveRoles(user, client);
  return hasCapability(roles, capability);
}

// Server-side 強制檢查（DB 版本）：deny-by-default，未擁有能力時拋出 PermissionDeniedError；
// inactive User 一律視為無任何能力，不論呼叫端是否已先經過 getCurrentUser。
export async function requireCapability(
  user: Pick<User, "id">,
  capability: Capability,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<void> {
  const allowed = await getUserHasCapability(user, capability, client);
  if (!allowed) {
    throw new PermissionDeniedError(capability);
  }
}

// 查詢使用者在指定團隊的成員身分（DB 版本）
// deny-by-default：資料庫中若出現不在固定值域內的髒資料，視為無有效成員身分，不得盲目轉型
export async function getTeamMembershipRole(
  teamId: string,
  userId: string,
): Promise<TeamMembershipRole | null> {
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId, isActive: true },
  });
  if (!membership || !isTeamMembershipRole(membership.membershipRole)) return null;
  return membership.membershipRole;
}

export async function isUserTeamMember(teamId: string, userId: string): Promise<boolean> {
  return (await getTeamMembershipRole(teamId, userId)) !== null;
}

export async function isUserTeamLead(teamId: string, userId: string): Promise<boolean> {
  return (await getTeamMembershipRole(teamId, userId)) === "LEAD";
}

// ---------------------------------------------------------------------------
// M1.5-A 新增：核准治理層資格判斷（純邏輯，不依賴 Prisma 查詢，可在 Migration
// 套用前單元測試）。
//
// 重要：本節所有函式刻意只讀取 UserSupervisorAssignment／TeamMember／
// ApprovalDelegation 的實際紀錄，完全不查詢／不參考 User.role 或 UserRole。
// Admin、資安推動小組（或任何角色）都不得因角色本身自動取得主管／團隊 LEAD
// 核准資格——唯一取得資格的途徑是存在對應的有效紀錄。未來維護者擴充本節時，
// 不得加入「若 role === 'Admin' 則視為有權核准」之類的角色捷徑。
// ---------------------------------------------------------------------------

export interface SupervisorAssignmentLike {
  id: string;
  userId: string;
  supervisorUserId: string;
  validFrom: Date;
  validUntil: Date | null;
  isPrimary: boolean;
  isActive: boolean;
}

export interface ApprovalDelegationLike {
  id: string;
  delegatorUserId: string;
  delegateUserId: string;
  teamId: string | null;
  approvalType: string;
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
}

// role 字串本身永遠不構成核准資格來源（對任何角色皆成立，包含 Admin、資安推動小組）；
// 僅作為文件化聲明供測試與程式碼審查引用，非實際判斷邏輯的一部分。
export function roleNeverGrantsApprovalAuthority(role: string): true {
  void role;
  return true;
}

export type EffectiveSupervisorResult =
  | { kind: "resolved"; assignment: SupervisorAssignmentLike }
  | { kind: "none" }
  | { kind: "configError"; reason: "multiplePrimary"; conflictingAssignmentIds: string[] };

// 純邏輯：解析某使用者「目前」唯一有效的 primary 直屬主管指派。
// 有 0 筆或無法辨識唯一 primary 時一律 deny-by-default（none／configError），不得臆測。
export function getEffectiveSupervisor(
  assignments: readonly SupervisorAssignmentLike[],
  userId: string,
  now: Date = new Date(),
): EffectiveSupervisorResult {
  const candidates = assignments.filter(
    (a) =>
      a.userId === userId &&
      a.isActive &&
      a.isPrimary &&
      isWithinHalfOpenWindow(a.validFrom, a.validUntil, now),
  );
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length > 1) {
    return {
      kind: "configError",
      reason: "multiplePrimary",
      conflictingAssignmentIds: candidates.map((c) => c.id),
    };
  }
  return { kind: "resolved", assignment: candidates[0] };
}

// 主管循環偵測：沿現有有效指派鏈由 proposedSupervisorUserId 向上追溯，若能追溯回
// userId（或途中重複經過任一節點），視為會形成循環，一律拒絕。
export function wouldCreateSupervisorCycle(
  assignments: readonly SupervisorAssignmentLike[],
  userId: string,
  proposedSupervisorUserId: string,
  now: Date = new Date(),
): boolean {
  if (userId === proposedSupervisorUserId) return true;
  const visited = new Set<string>([userId]);
  let current = proposedSupervisorUserId;
  for (;;) {
    if (visited.has(current)) return true;
    visited.add(current);
    const result = getEffectiveSupervisor(assignments, current, now);
    if (result.kind !== "resolved") return false;
    current = result.assignment.supervisorUserId;
  }
}

// 純邏輯：是否存在符合條件的有效代理紀錄（delegatorUserId 委任 delegateUserId，
// 特定 approvalType，特定 teamId——BUSINESS_APPROVAL 恆為 null，TEAM_LEAD 類型須相符）。
export function isValidDelegate(
  delegations: readonly ApprovalDelegationLike[],
  delegatorUserId: string,
  delegateUserId: string,
  approvalType: string,
  teamId: string | null,
  now: Date = new Date(),
): boolean {
  return delegations.some(
    (d) =>
      d.delegatorUserId === delegatorUserId &&
      d.delegateUserId === delegateUserId &&
      d.approvalType === approvalType &&
      d.teamId === teamId &&
      d.isActive &&
      isWithinHalfOpenWindow(d.validFrom, d.validUntil, now),
  );
}

// 代理鏈／循環代理偵測：不支援代理人再次轉代理（提議的 delegateUserId 若同類型下
// 自己已是某代理紀錄的 delegator，視為轉委託鏈，拒絕）；亦不允許循環代理（沿現有
// 同類型代理鏈能追溯回 delegatorUserId）。
export function wouldCreateDelegationChainOrCycle(
  delegations: readonly ApprovalDelegationLike[],
  delegatorUserId: string,
  delegateUserId: string,
  approvalType: string,
  now: Date = new Date(),
): boolean {
  if (delegatorUserId === delegateUserId) return true;
  const sameType = delegations.filter(
    (d) => d.approvalType === approvalType && d.isActive && isWithinHalfOpenWindow(d.validFrom, d.validUntil, now),
  );
  // 不支援代理人再次轉代理：提議的 delegatorUserId 若本身目前已是（同類型）某筆有效代理紀錄的
  // delegateUserId（即已持有代理身分），不得再以代理人身分建立新的委任。
  if (sameType.some((d) => d.delegateUserId === delegatorUserId)) return true;
  const visited = new Set<string>([delegatorUserId]);
  let current = delegateUserId;
  for (;;) {
    if (visited.has(current)) return true;
    visited.add(current);
    const next = sameType.find((d) => d.delegatorUserId === current);
    if (!next) return false;
    current = next.delegateUserId;
  }
}

// 核准資格來源：DIRECT_SUPERVISOR＝直屬主管本人；TEAM_LEAD＝團隊 LEAD 本人；
// DELEGATE＝有效代理人（onBehalfOfUserId 記錄被代理的主管／LEAD 本人）。
export type ApprovalAuthoritySource =
  | { authorityType: "DIRECT_SUPERVISOR"; userId: string; supervisorAssignmentId: string }
  | { authorityType: "TEAM_LEAD"; userId: string; teamId: string }
  | { authorityType: "DELEGATE"; userId: string; approvalDelegationId: string; onBehalfOfUserId: string };

// 純邏輯：解析某核准情境下「目前」所有合格核准來源。
// - BUSINESS_APPROVAL：requestedByUserId 的唯一有效直屬主管，及其有效代理人（teamId 必為 null）。
// - RD_LEAD_APPROVAL／QA_LEAD_APPROVAL／DEPLOYMENT_APPROVAL：teamId 對應團隊的啟用中 LEAD，
//   及其有效代理人（teamId 須相符）。
// 完全不查詢／不參考 User.role：Admin、資安推動小組不因角色本身出現在回傳結果中。
export function getEligibleApprovers(params: {
  approvalType: ApprovalType;
  requestedByUserId: string;
  teamId: string | null;
  supervisorAssignments: readonly SupervisorAssignmentLike[];
  teamMemberships: readonly TeamMembershipLike[];
  delegations: readonly ApprovalDelegationLike[];
  now?: Date;
}): ApprovalAuthoritySource[] {
  const now = params.now ?? new Date();
  const results: ApprovalAuthoritySource[] = [];

  if (params.approvalType === "BUSINESS_APPROVAL") {
    const supervisorResult = getEffectiveSupervisor(params.supervisorAssignments, params.requestedByUserId, now);
    if (supervisorResult.kind === "resolved") {
      const supervisorUserId = supervisorResult.assignment.supervisorUserId;
      results.push({
        authorityType: "DIRECT_SUPERVISOR",
        userId: supervisorUserId,
        supervisorAssignmentId: supervisorResult.assignment.id,
      });
      for (const d of params.delegations) {
        if (
          d.delegatorUserId === supervisorUserId &&
          d.approvalType === params.approvalType &&
          d.teamId === null &&
          d.isActive &&
          isWithinHalfOpenWindow(d.validFrom, d.validUntil, now)
        ) {
          results.push({
            authorityType: "DELEGATE",
            userId: d.delegateUserId,
            approvalDelegationId: d.id,
            onBehalfOfUserId: supervisorUserId,
          });
        }
      }
    }
    return results;
  }

  if (!params.teamId) return results;

  const leadUserIds: string[] = [];
  for (const m of params.teamMemberships) {
    if (m.teamId === params.teamId && m.isActive && m.membershipRole === "LEAD") {
      leadUserIds.push(m.userId);
      results.push({ authorityType: "TEAM_LEAD", userId: m.userId, teamId: params.teamId });
    }
  }
  for (const leadUserId of leadUserIds) {
    for (const d of params.delegations) {
      if (
        d.delegatorUserId === leadUserId &&
        d.approvalType === params.approvalType &&
        d.teamId === params.teamId &&
        d.isActive &&
        isWithinHalfOpenWindow(d.validFrom, d.validUntil, now)
      ) {
        results.push({
          authorityType: "DELEGATE",
          userId: d.delegateUserId,
          approvalDelegationId: d.id,
          onBehalfOfUserId: leadUserId,
        });
      }
    }
  }
  return results;
}

// 純邏輯：candidateUserId 是否為 eligible 名單中的合格核准人；是則回傳其資格來源。
export function canApproveStage(
  candidateUserId: string,
  eligible: readonly ApprovalAuthoritySource[],
): ApprovalAuthoritySource | null {
  return eligible.find((e) => e.userId === candidateUserId) ?? null;
}

export class SelfApprovalError extends Error {
  constructor() {
    super("不得自行核准：核准人不得與該階段送核人相同");
    this.name = "SelfApprovalError";
  }
}

// deny-by-default：送核人與核准人相同時一律拒絕，不論核准資格來源為何。
export function assertNotSelfApproval(requestedByUserId: string, approverUserId: string): void {
  if (requestedByUserId === approverUserId) {
    throw new SelfApprovalError();
  }
}

// ---------------------------------------------------------------------------
// M1.5-B 新增：主管關係時間區間感知循環偵測（純邏輯）。
//
// 與 wouldCreateSupervisorCycle 的差異：wouldCreateSupervisorCycle 只沿「now 當下」
// 的有效鏈往上追溯，無法反映「排定未來生效」情境下才會成環的狀況；本節函式改成
// 對整段時間依 validFrom／validUntil 邊界切段，逐段建圖偵測，只有「同一時間真的
// 同時生效」才視為成環。
// ---------------------------------------------------------------------------

export interface SupervisorCycleFinding {
  userIds: string[]; // 循環節點順序，例如 [a,b,c] 代表 a→b→c→a
  overlapFrom: Date;
  overlapUntil: Date | null; // null = 目前仍開放（無終止日）
}

// 把循環節點序列旋轉到「以字典序最小的 userId 開頭」，作為判斷跨區段是否為
// 「同一個環」的穩定 key（方向不變，只調整起點）。
function canonicalCycleKey(cycle: readonly string[]): string {
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) minIdx = i;
  }
  const rotated = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
  return rotated.join("→");
}

// 在一張有向圖（userId → supervisorUserId 邊，可能有多條出邊）裡找出所有環。
// 資料乾淨時每個節點至多一條出邊（同一時間至多一筆有效 primary）；髒資料防禦性地
// 只沿第一條出邊走，足以在 MVP 資料量下找出主要問題，不追求窮舉所有可能路徑。
function findCyclesInDirectedGraph(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const cycles: string[][] = [];
  const globalVisited = new Set<string>();

  for (const startNode of edges.keys()) {
    if (globalVisited.has(startNode)) continue;
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let current: string | undefined = startNode;
    while (current !== undefined) {
      if (onPath.has(current)) {
        const cycleStart = onPath.get(current)!;
        const cycle = path.slice(cycleStart);
        cycles.push(cycle);
        for (const n of cycle) globalVisited.add(n);
        break;
      }
      if (globalVisited.has(current)) break;
      onPath.set(current, path.length);
      path.push(current);
      const next = edges.get(current);
      current = next && next.length > 0 ? next[0] : undefined;
    }
    for (const n of path) globalVisited.add(n);
  }
  return cycles;
}

// 純邏輯：找出「在某段時間內真的同時生效並成環」的所有主管關係循環。
// 只看 isPrimary && isActive 的指派（只有 primary 才構成回報鏈）。
// 同一個環若跨多個相鄰、無落差的時間段持續存在，合併成一筆 finding；
// 若中間出現沒有這個環的空窗，回傳成兩筆獨立 finding，不得失真合併。
export function findSupervisorCyclesByTimeWindow(
  assignments: readonly SupervisorAssignmentLike[],
): SupervisorCycleFinding[] {
  const primary = assignments.filter((a) => a.isPrimary && a.isActive);
  if (primary.length === 0) return [];

  const boundarySet = new Set<number>();
  for (const a of primary) {
    boundarySet.add(a.validFrom.getTime());
    if (a.validUntil !== null) boundarySet.add(a.validUntil.getTime());
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);

  interface Segment {
    start: number;
    end: number | null;
    cycles: Map<string, string[]>;
  }

  const segments: Segment[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : null;
    const t = new Date(start);
    const edges = new Map<string, string[]>();
    for (const a of primary) {
      if (isWithinHalfOpenWindow(a.validFrom, a.validUntil, t)) {
        const arr = edges.get(a.userId) ?? [];
        arr.push(a.supervisorUserId);
        edges.set(a.userId, arr);
      }
    }
    const cycleMap = new Map<string, string[]>();
    for (const c of findCyclesInDirectedGraph(edges)) {
      cycleMap.set(canonicalCycleKey(c), c);
    }
    segments.push({ start, end, cycles: cycleMap });
  }

  interface OpenFinding {
    userIds: string[];
    overlapFrom: number;
    overlapUntil: number | null;
  }
  const results: SupervisorCycleFinding[] = [];
  const open = new Map<string, OpenFinding>();

  const closeFinding = (finding: OpenFinding) => {
    results.push({
      userIds: finding.userIds,
      overlapFrom: new Date(finding.overlapFrom),
      overlapUntil: finding.overlapUntil === null ? null : new Date(finding.overlapUntil),
    });
  };

  for (const seg of segments) {
    const thisKeys = new Set(seg.cycles.keys());
    for (const [key, finding] of [...open.entries()]) {
      if (!thisKeys.has(key) || finding.overlapUntil !== seg.start) {
        // 這段沒有這個環，或跟前一段有落差（不相鄰）→ close 掉，不得延伸涵蓋空窗
        closeFinding(finding);
        open.delete(key);
      }
    }
    for (const key of thisKeys) {
      if (!open.has(key)) {
        open.set(key, { userIds: seg.cycles.get(key)!, overlapFrom: seg.start, overlapUntil: seg.end });
      } else {
        open.get(key)!.overlapUntil = seg.end;
      }
    }
  }
  for (const finding of open.values()) closeFinding(finding);

  return results;
}

function cycleContainsEdge(cycle: readonly string[], from: string, to: string): boolean {
  for (let i = 0; i < cycle.length; i++) {
    if (cycle[i] === from && cycle[(i + 1) % cycle.length] === to) return true;
  }
  return false;
}

// 建立時的擋環檢查：把提議的新指派併入現有資料後重新找環，只有「新指派這條邊本身
// 參與了某個環」才擋——不會因為資料庫裡既有、跟這次新增無關的舊循環而誤擋新指派。
export function wouldCreateSupervisorCycleInWindow(
  existingAssignments: readonly SupervisorAssignmentLike[],
  proposed: { userId: string; supervisorUserId: string; validFrom: Date; validUntil: Date | null },
): boolean {
  if (proposed.userId === proposed.supervisorUserId) return true;
  const merged: SupervisorAssignmentLike[] = [
    ...existingAssignments,
    {
      id: "__proposed__",
      userId: proposed.userId,
      supervisorUserId: proposed.supervisorUserId,
      validFrom: proposed.validFrom,
      validUntil: proposed.validUntil,
      isPrimary: true,
      isActive: true,
    },
  ];
  const cycles = findSupervisorCyclesByTimeWindow(merged);
  return cycles.some((c) => cycleContainsEdge(c.userIds, proposed.userId, proposed.supervisorUserId));
}

// 純邏輯：candidateSupervisorUserId 目前是否為「任何人」的有效 primary 主管
// （不是查詢某特定人的主管鏈，而是反過來問「這個人現在還算不算主管」）。
// 供代理建立時驗證 delegator 的原始資格（見 approvalDelegationService.ts）。
export function isCurrentPrimarySupervisorOfAnyone(
  assignments: readonly SupervisorAssignmentLike[],
  candidateSupervisorUserId: string,
  now: Date = new Date(),
): boolean {
  return assignments.some(
    (a) =>
      a.supervisorUserId === candidateSupervisorUserId &&
      a.isPrimary &&
      a.isActive &&
      isWithinHalfOpenWindow(a.validFrom, a.validUntil, now),
  );
}

// ---------------------------------------------------------------------------
// M1.5-B 新增：治理設定查詢／管理的存取範圍解析（DB 版本）。
//
// 供 6 個查詢服務與 8 個寫入服務共用，統一在服務層現場重新解析 actor 的角色與
// TeamMember 身分，不信任呼叫端（例如頁面）傳入的 isAdmin／ledTeamIds 等旗標。
// ---------------------------------------------------------------------------

export interface GovernanceAccessContext {
  isActive: boolean;
  canViewAllGovernance: boolean;
  canManageSupervisors: boolean;
  canManageTeamLeads: boolean;
  canManageAnyDelegation: boolean;
  ledTeamIds: string[];
  memberTeamIds: string[];
}

// client 預設用全域 prisma（向下相容）；寫入服務在自己的 transaction 內解析 actor 權限時，
// 必須傳入該 transaction 的 tx，避免另開一條連線在 SQLite 上跟持有寫鎖的 transaction 互相干擾。
export async function resolveGovernanceAccessContext(
  actorId: string,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<GovernanceAccessContext> {
  const user = await client.user.findUnique({ where: { id: actorId } });
  if (!user || !user.isActive) {
    return {
      isActive: false,
      canViewAllGovernance: false,
      canManageSupervisors: false,
      canManageTeamLeads: false,
      canManageAnyDelegation: false,
      ledTeamIds: [],
      memberTeamIds: [],
    };
  }
  // C1-B2：只讀 active UserRole 作為角色來源，不再把 User.role 併入角色集合。
  const roles = await getUserEffectiveRoles(user, client);
  const caps = unionCapabilities(roles);
  const memberships = await client.teamMember.findMany({ where: { userId: actorId, isActive: true } });
  return {
    isActive: true,
    canViewAllGovernance: caps.has("governance.viewAllGovernance"),
    canManageSupervisors: caps.has("governance.manageSupervisors"),
    canManageTeamLeads: caps.has("governance.manageTeamLeads"),
    canManageAnyDelegation: caps.has("governance.manageAnyDelegation"),
    ledTeamIds: memberships.filter((m) => m.membershipRole === "LEAD").map((m) => m.teamId),
    memberTeamIds: memberships.map((m) => m.teamId),
  };
}
