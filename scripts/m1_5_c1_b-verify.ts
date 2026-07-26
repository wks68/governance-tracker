// M1.5-C1-B 驗證腳本
//
// 目前涵蓋範圍（尚非完整 C1-B，見下方分段標示）：
//
// C1-B1：核准資格解析排除 inactive User——驗證 src/lib/approvalService.ts 的三個私有查詢函式
// （fetchTeamMembershipsLike／fetchSupervisorAssignmentsLike／fetchDelegationsLike）不會讓
// 已停用（User.isActive=false）的 Team LEAD／主管／代理人繼續成為合格核准候選人。三個函式
// 本身為私有，不對外匯出；本腳本一律透過既有公開 API（createPendingApprovalRecord／
// decideApprovalRecord）間接驗證，不新增額外匯出。
//
// C1-B2：Active UserRole 授權來源切換——驗證 src/lib/permissions.ts 的
// getUserHasCapability／resolveGovernanceAccessContext 只讀 active UserRole，完全不參考
// User.role；並以靜態原始碼檢查確認 src/lib/auth.ts（requireAdmin）與
// src/components/Nav.tsx（管理入口顯示）都改用 admin.full Capability、不再出現
// `role === "Admin"`／`role !== "Admin"` 字串判斷。
//
// C1-B3：People／角色／Team 成員服務層（src/lib/people/*，經 src/lib/peopleService.ts
// facade 匯出）——createPerson／updatePersonProfile／activatePerson／assignSystemRole／
// updatePrimaryRole／removeSystemRole／addTeamMember／removeTeamMember。
//
// C1-B4：停用治理（getUserDeactivationImpact／checkUserDeactivationImpact／
// deactivatePerson）與 teamLeadService 的 TeamMembershipHistory ROLE_CHANGED 補寫。
//
// C1-B5：row-level 唯讀查詢（listPeopleForActor／getPersonDetailForActor／
// listTeamsForActor／getTeamDetailForActor）與非授權直接呼叫服務層的 deny-by-default。
//
// - DB 相依測試：若資料表尚未建立（Migration 尚未套用），標記為 SKIPPED，不視為失敗，
//   也不會嘗試自動套用 Migration。若資料表已存在，則建立臨時測試資料（獨立 email/id，
//   不觸碰既有 User／Issue 業務資料），測試結束後於 finally 區塊清除。
//
// 執行方式：
//   DATABASE_URL="file:./<測試 scratch DB>" node_modules/.bin/tsx scripts/m1_5_c1_b-verify.ts
//
// Fail-closed（C1-B 新增）：本檔第一行 import 為 assertSafeTestDatabase，若呼叫端未顯式
// 設定 DATABASE_URL，或其解析後（含 symlink／device+inode 比對）指向正式 prisma/dev.db，
// 一律立即 process.exit(1)，不建立 Prisma Client、不寫入任何資料。

import "./lib/assertSafeTestDatabase";

import {
  createPendingApprovalRecord,
  decideApprovalRecord,
  ApprovalValidationError,
  ApprovalAuthorityMismatchError,
} from "../src/lib/approvalService";
import {
  getUserHasCapability,
  requireCapability,
  resolveGovernanceAccessContext,
  roleCapabilities,
  PermissionDeniedError,
} from "../src/lib/permissions";
import { assignTeamLead, removeTeamLead } from "../src/lib/teamLeadService";
import {
  createPerson,
  updatePersonProfile,
  activatePerson,
  assignSystemRole,
  updatePrimaryRole,
  removeSystemRole,
  addTeamMember,
  removeTeamMember,
  getUserDeactivationImpact,
  checkUserDeactivationImpact,
  deactivatePerson,
  listPeopleForActor,
  getPersonDetailForActor,
  listTeamsForActor,
  getTeamDetailForActor,
  PeopleValidationError,
  PeopleStateError,
  PeopleAccessDeniedError,
} from "../src/lib/peopleService";
import { prisma } from "../src/lib/prisma";
import * as fs from "node:fs";
import * as path from "node:path";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}`);
  }
}

async function checkAsync(name: string, fn: () => Promise<boolean>) {
  try {
    check(name, await fn());
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name}（未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, isExpected: (err: unknown) => boolean) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（未拋出任何錯誤）`);
  } catch (err) {
    if (isExpected(err)) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（拋出非預期錯誤：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

function skip(name: string, reason: string) {
  skipCount++;
  console.log(`  SKIP  ${name}（${reason}）`);
}

const DAY = 24 * 60 * 60 * 1000;

const RUN_TAG = `m15c1bv${Date.now()}`;

interface Fixtures {
  userIds: string[];
  teamIds: string[];
  issueIds: string[];
  assignmentIds: string[];
  delegationIds: string[];
  approvalRecordIdsNewestFirst: string[];
  // [D6]／[D6b] 測試隔離修復：暫時中性化的既存（非本次 fixture 建立的）
  // isBreakGlassAdmin=true 使用者 id，測試結束後必須在 cleanupFixtures 內還原為 true，
  // 不得假設 cleanup 刪除 fixture 就會自動還原既有 seed User 的狀態。
  neutralizedBreakGlassAdminUserIds: string[];
  // [P10]／[D5] 既有中性化邏輯同樣會影響既存（非本次 fixture）使用者的 active Admin
  // UserRole（例如 admin@example.com），同樣必須記錄受影響的 UserRole id 並在
  // cleanupFixtures 內還原，確保執行前後基準 DB 的穩定資料不受影響。
  neutralizedAdminUserRoleIds: string[];
}

// C1-B2：Active UserRole 是唯一授權來源，測試 fixture 建立 User 時同步建立對應的
// active UserRole（role 與 User.role 相同）。inactive User 仍保留 active UserRole，
// 用來驗證「User 停用後即使角色仍 active，也不得通過 getCurrentUser／實際授權入口」。
async function createUser(name: string, role: string, isActive = true): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function createPendingRecord(data: {
  issueId: string;
  approvalType: string;
  relatedStageKey: string;
  requestedByUserId: string;
  approverTeamId?: string | null;
  supervisorAssignmentId?: string | null;
}): Promise<{ id: string }> {
  return prisma.approvalRecord.create({
    data: {
      issueId: data.issueId,
      approvalType: data.approvalType,
      relatedStageKey: data.relatedStageKey,
      requestedByUserId: data.requestedByUserId,
      approverTeamId: data.approverTeamId ?? null,
      supervisorAssignmentId: data.supervisorAssignmentId ?? null,
      expectedApproverUserId: null,
      approvalAuthorityType: null,
      approvalDelegationId: null,
      delegatedFromUserId: null,
    },
  });
}

async function runDbDependentTests(fx: Fixtures) {
  // ===========================================================================
  // 情境 1：inactive Team LEAD 不得出現在 eligible approvers
  // ===========================================================================
  const requesterSolo = await createUser("requesterSolo", "PM");
  const leadInactiveSolo = await createUser("leadInactiveSolo", "RD", false);
  fx.userIds.push(requesterSolo.id, leadInactiveSolo.id);

  const teamSolo = await prisma.team.create({ data: { name: `${RUN_TAG}-team-solo` } });
  fx.teamIds.push(teamSolo.id);
  await prisma.teamMember.create({ data: { teamId: teamSolo.id, userId: leadInactiveSolo.id, membershipRole: "LEAD" } });

  const issueSolo = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-SOLO`,
      issueType: "Hotfix",
      title: "verify c1-b solo lead",
      workflowStatus: "rdInProgress",
      assignedTeamId: teamSolo.id,
    },
  });
  fx.issueIds.push(issueSolo.id);

  const recordSolo = await createPendingRecord({
    issueId: issueSolo.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: "pendingRdLeadApproval",
    requestedByUserId: requesterSolo.id,
    approverTeamId: teamSolo.id,
  });
  fx.approvalRecordIdsNewestFirst.push(recordSolo.id);

  await expectError(
    "[1] 已停用 Team LEAD 不得出現在 eligible approvers（decideApprovalRecord 應拒絕）",
    () => decideApprovalRecord({ approvalRecordId: recordSolo.id, actorUserId: leadInactiveSolo.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );

  // ===========================================================================
  // 情境 2：inactive supervisor 不得出現在 eligible approvers
  // ===========================================================================
  const requesterInactiveSup = await createUser("requesterInactiveSup", "PM");
  const supervisorInactive = await createUser("supervisorInactive", "DMS主管", false);
  fx.userIds.push(requesterInactiveSup.id, supervisorInactive.id);

  const assignmentInactiveSup = await prisma.userSupervisorAssignment.create({
    data: {
      userId: requesterInactiveSup.id,
      supervisorUserId: supervisorInactive.id,
      validFrom: new Date(Date.now() - 30 * DAY),
      isPrimary: true,
      createdByUserId: supervisorInactive.id,
    },
  });
  fx.assignmentIds.push(assignmentInactiveSup.id);

  const issueInactiveSup = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-INSUP`,
      issueType: "Hotfix",
      title: "verify c1-b inactive supervisor",
      workflowStatus: "pendingBusinessApproval",
    },
  });
  fx.issueIds.push(issueInactiveSup.id);

  const recordInactiveSup = await createPendingRecord({
    issueId: issueInactiveSup.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: requesterInactiveSup.id,
    supervisorAssignmentId: assignmentInactiveSup.id,
  });
  fx.approvalRecordIdsNewestFirst.push(recordInactiveSup.id);

  await expectError(
    "[2] 已停用主管不得出現在 eligible approvers（decideApprovalRecord 應拒絕）",
    () => decideApprovalRecord({ approvalRecordId: recordInactiveSup.id, actorUserId: supervisorInactive.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );

  // ===========================================================================
  // 情境 3：inactive delegate 不得出現在 eligible approvers（delegator／supervisor 本身仍 active）
  // ===========================================================================
  const requesterDelegateInactive = await createUser("requesterDelegateInactive", "PM");
  const supervisorForInactiveDelegate = await createUser("supervisorForInactiveDelegate", "DMS主管");
  const delegateInactive = await createUser("delegateInactive", "PM", false);
  fx.userIds.push(requesterDelegateInactive.id, supervisorForInactiveDelegate.id, delegateInactive.id);

  const assignmentForInactiveDelegate = await prisma.userSupervisorAssignment.create({
    data: {
      userId: requesterDelegateInactive.id,
      supervisorUserId: supervisorForInactiveDelegate.id,
      validFrom: new Date(Date.now() - 30 * DAY),
      isPrimary: true,
      createdByUserId: supervisorForInactiveDelegate.id,
    },
  });
  fx.assignmentIds.push(assignmentForInactiveDelegate.id);

  const delegationToInactiveDelegate = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: supervisorForInactiveDelegate.id,
      delegateUserId: delegateInactive.id,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(Date.now() - DAY),
      validUntil: new Date(Date.now() + 30 * DAY),
      createdByUserId: supervisorForInactiveDelegate.id,
    },
  });
  fx.delegationIds.push(delegationToInactiveDelegate.id);

  const issueDelegateInactive = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-INDEL`,
      issueType: "Hotfix",
      title: "verify c1-b inactive delegate",
      workflowStatus: "pendingBusinessApproval",
    },
  });
  fx.issueIds.push(issueDelegateInactive.id);

  const recordDelegateInactive = await createPendingRecord({
    issueId: issueDelegateInactive.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: requesterDelegateInactive.id,
    supervisorAssignmentId: assignmentForInactiveDelegate.id,
  });
  fx.approvalRecordIdsNewestFirst.push(recordDelegateInactive.id);

  await expectError(
    "[3] 已停用代理人不得出現在 eligible approvers（decideApprovalRecord 應拒絕），縱使委任的主管本人仍 active",
    () => decideApprovalRecord({ approvalRecordId: recordDelegateInactive.id, actorUserId: delegateInactive.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );
  // 主管本人仍應可正常核准，證明本次過濾未波及未停用的委任來源本人。
  await checkAsync("[3b] 委任來源（主管本人）仍 active 時不受代理人停用影響，仍可正常核准", async () => {
    const decided = await decideApprovalRecord({
      approvalRecordId: recordDelegateInactive.id,
      actorUserId: supervisorForInactiveDelegate.id,
      decision: "APPROVED",
    });
    return decided.decision === "APPROVED" && decided.approverUserId === supervisorForInactiveDelegate.id;
  });

  // ===========================================================================
  // 情境 4：inactive delegator 的 delegation 不得生效（即使 delegate 本人仍 active）
  // ===========================================================================
  const requesterInactiveDelegator = await createUser("requesterInactiveDelegator", "PM");
  const inactiveDelegator = await createUser("inactiveDelegator", "DMS主管", false);
  const delegateOfInactiveDelegator = await createUser("delegateOfInactiveDelegator", "PM");
  fx.userIds.push(requesterInactiveDelegator.id, inactiveDelegator.id, delegateOfInactiveDelegator.id);

  const assignmentInactiveDelegator = await prisma.userSupervisorAssignment.create({
    data: {
      userId: requesterInactiveDelegator.id,
      supervisorUserId: inactiveDelegator.id,
      validFrom: new Date(Date.now() - 30 * DAY),
      isPrimary: true,
      createdByUserId: inactiveDelegator.id,
    },
  });
  fx.assignmentIds.push(assignmentInactiveDelegator.id);

  const delegationFromInactiveDelegator = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: inactiveDelegator.id,
      delegateUserId: delegateOfInactiveDelegator.id,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(Date.now() - DAY),
      validUntil: new Date(Date.now() + 30 * DAY),
      createdByUserId: inactiveDelegator.id,
    },
  });
  fx.delegationIds.push(delegationFromInactiveDelegator.id);

  const issueInactiveDelegator = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-INDELOR`,
      issueType: "Hotfix",
      title: "verify c1-b inactive delegator",
      workflowStatus: "pendingBusinessApproval",
    },
  });
  fx.issueIds.push(issueInactiveDelegator.id);

  const recordInactiveDelegator = await createPendingRecord({
    issueId: issueInactiveDelegator.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: requesterInactiveDelegator.id,
    supervisorAssignmentId: assignmentInactiveDelegator.id,
  });
  fx.approvalRecordIdsNewestFirst.push(recordInactiveDelegator.id);

  await expectError(
    "[4] 委任來源（delegator）已停用時，其 delegation 不得生效，代理人（縱使本人 active）不得核准",
    () =>
      decideApprovalRecord({
        approvalRecordId: recordInactiveDelegator.id,
        actorUserId: delegateOfInactiveDelegator.id,
        decision: "APPROVED",
      }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );

  // ===========================================================================
  // 情境 5：active 候選人的原有結果維持不變（純 active 情境不受本次過濾影響的迴歸基準）
  // ===========================================================================
  const requesterBaseline = await createUser("requesterBaseline", "PM");
  const supervisorBaseline = await createUser("supervisorBaseline", "DMS主管");
  fx.userIds.push(requesterBaseline.id, supervisorBaseline.id);

  const assignmentBaseline = await prisma.userSupervisorAssignment.create({
    data: {
      userId: requesterBaseline.id,
      supervisorUserId: supervisorBaseline.id,
      validFrom: new Date(Date.now() - 30 * DAY),
      isPrimary: true,
      createdByUserId: supervisorBaseline.id,
    },
  });
  fx.assignmentIds.push(assignmentBaseline.id);

  const issueBaseline = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-BASE`,
      issueType: "Hotfix",
      title: "verify c1-b active baseline",
      workflowStatus: "pendingBusinessApproval",
    },
  });
  fx.issueIds.push(issueBaseline.id);

  const recordBaseline = await createPendingRecord({
    issueId: issueBaseline.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: requesterBaseline.id,
    supervisorAssignmentId: assignmentBaseline.id,
  });
  fx.approvalRecordIdsNewestFirst.push(recordBaseline.id);

  await checkAsync("[5] 全 active 情境（唯一直屬主管）核准結果與本次過濾前完全一致", async () => {
    const decided = await decideApprovalRecord({
      approvalRecordId: recordBaseline.id,
      actorUserId: supervisorBaseline.id,
      decision: "APPROVED",
    });
    return (
      decided.decision === "APPROVED" &&
      decided.approverUserId === supervisorBaseline.id &&
      decided.approvalAuthorityType === "DIRECT_SUPERVISOR" &&
      decided.supervisorAssignmentId === assignmentBaseline.id
    );
  });

  // ===========================================================================
  // 情境 6：多候選人中排除 inactive 人員後，其他 active 候選人仍可核准
  // ===========================================================================
  const requesterDual = await createUser("requesterDual", "PM");
  const leadActiveDual = await createUser("leadActiveDual", "RD");
  const leadInactiveDual = await createUser("leadInactiveDual", "RD", false);
  fx.userIds.push(requesterDual.id, leadActiveDual.id, leadInactiveDual.id);

  const teamDual = await prisma.team.create({ data: { name: `${RUN_TAG}-team-dual` } });
  fx.teamIds.push(teamDual.id);
  await prisma.teamMember.create({ data: { teamId: teamDual.id, userId: leadActiveDual.id, membershipRole: "LEAD" } });
  await prisma.teamMember.create({ data: { teamId: teamDual.id, userId: leadInactiveDual.id, membershipRole: "LEAD" } });

  const issueDual = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-DUAL`,
      issueType: "Hotfix",
      title: "verify c1-b dual lead",
      workflowStatus: "rdInProgress",
      assignedTeamId: teamDual.id,
    },
  });
  fx.issueIds.push(issueDual.id);

  const recordDual = await createPendingRecord({
    issueId: issueDual.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: "pendingRdLeadApproval",
    requestedByUserId: requesterDual.id,
    approverTeamId: teamDual.id,
  });
  fx.approvalRecordIdsNewestFirst.push(recordDual.id);

  await expectError(
    "[6a] 多位候選人中的已停用 LEAD 仍被拒絕",
    () => decideApprovalRecord({ approvalRecordId: recordDual.id, actorUserId: leadInactiveDual.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );
  await checkAsync("[6b] 排除已停用候選人後，其餘 active 候選人（另一位 LEAD）仍可正常核准", async () => {
    const decided = await decideApprovalRecord({
      approvalRecordId: recordDual.id,
      actorUserId: leadActiveDual.id,
      decision: "APPROVED",
    });
    return decided.decision === "APPROVED" && decided.approverUserId === leadActiveDual.id && decided.approvalAuthorityType === "TEAM_LEAD";
  });

  // ===========================================================================
  // 情境 7：排除 inactive 人員後候選人歸零時，送核前置資格解析判定 blocking
  // （createPendingApprovalRecord 現場解析 eligible=0，拒絕建立 PENDING 紀錄）
  // ===========================================================================
  const requesterZero = await createUser("requesterZero", "PM");
  const supervisorZero = await createUser("supervisorZero", "DMS主管", false);
  fx.userIds.push(requesterZero.id, supervisorZero.id);

  await prisma.userSupervisorAssignment
    .create({
      data: {
        userId: requesterZero.id,
        supervisorUserId: supervisorZero.id,
        validFrom: new Date(Date.now() - 30 * DAY),
        isPrimary: true,
        createdByUserId: supervisorZero.id,
      },
    })
    .then((a) => fx.assignmentIds.push(a.id));

  const issueZero = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-ZERO`,
      issueType: "Hotfix",
      title: "verify c1-b zero eligible after exclusion",
      workflowStatus: "pendingBusinessApproval",
    },
  });
  fx.issueIds.push(issueZero.id);

  await expectError(
    "[7] 排除已停用主管後合格候選人歸零，createPendingApprovalRecord 現場解析判定 blocking，拒絕建立",
    () =>
      createPendingApprovalRecord({
        issueId: issueZero.id,
        approvalType: "BUSINESS_APPROVAL",
        relatedStageKey: "pendingBusinessApproval",
        requestedByUserId: requesterZero.id,
      }),
    (e) => e instanceof ApprovalValidationError,
  );

  // ===========================================================================
  // C1-B2 情境 8：Active UserRole 成為唯一授權來源
  // （getUserHasCapability／resolveGovernanceAccessContext 完全不參考 User.role）
  // ===========================================================================

  // [8a] User.role=Admin，但沒有 active Admin UserRole → 不具有 admin.full
  const adminRoleNoActiveRole = await prisma.user.create({
    data: { name: "adminRoleNoActiveRole", email: `${RUN_TAG}-adminRoleNoActiveRole@example.invalid`, role: "Admin" },
  });
  fx.userIds.push(adminRoleNoActiveRole.id);
  await checkAsync(
    "[8a] User.role=Admin 但無 active Admin UserRole，不具有 admin.full（User.role 不得單獨授予 Capability）",
    async () => !(await getUserHasCapability(adminRoleNoActiveRole, "admin.full")),
  );

  // [8b] User.role 非 Admin，但具有 active Admin UserRole → 具有 admin.full
  const nonAdminRoleActiveAdminRole = await prisma.user.create({
    data: { name: "nonAdminRoleActiveAdminRole", email: `${RUN_TAG}-nonAdminRoleActiveAdminRole@example.invalid`, role: "PM" },
  });
  fx.userIds.push(nonAdminRoleActiveAdminRole.id);
  await prisma.userRole.create({ data: { userId: nonAdminRoleActiveAdminRole.id, role: "Admin", isActive: true } });
  await checkAsync(
    "[8b] User.role=PM 但具有 active Admin UserRole，具有 admin.full（active UserRole 是唯一授權來源）",
    async () => await getUserHasCapability(nonAdminRoleActiveAdminRole, "admin.full"),
  );

  // [8c] inactive Admin UserRole → 不具有 admin.full
  const inactiveAdminRole = await prisma.user.create({
    data: { name: "inactiveAdminRole", email: `${RUN_TAG}-inactiveAdminRole@example.invalid`, role: "PM" },
  });
  fx.userIds.push(inactiveAdminRole.id);
  await prisma.userRole.create({ data: { userId: inactiveAdminRole.id, role: "Admin", isActive: false } });
  await checkAsync(
    "[8c] 僅有 inactive Admin UserRole，不具有 admin.full",
    async () => !(await getUserHasCapability(inactiveAdminRole, "admin.full")),
  );

  // [8c-2] inactive User（User.isActive=false）即使具有 active Admin UserRole，也不得通過
  // getUserHasCapability／requireCapability／resolveGovernanceAccessContext——防禦性
  // fail-closed：不信任呼叫端是否已先經過 getCurrentUser，服務層直接呼叫也必須拒絕。
  const inactiveUserWithActiveAdminRole = await createUser("inactiveUserWithActiveAdminRole", "PM", false);
  fx.userIds.push(inactiveUserWithActiveAdminRole.id);
  await prisma.userRole.create({ data: { userId: inactiveUserWithActiveAdminRole.id, role: "Admin", isActive: true } });
  await checkAsync(
    "[8c-2a] inactive User 即使具有 active Admin UserRole，getUserHasCapability 仍回傳 false",
    async () => !(await getUserHasCapability(inactiveUserWithActiveAdminRole, "admin.full")),
  );
  await expectError(
    "[8c-2b] inactive User 即使具有 active Admin UserRole，requireCapability 仍拋出 PermissionDeniedError",
    () => requireCapability(inactiveUserWithActiveAdminRole, "admin.full"),
    (e) => e instanceof PermissionDeniedError,
  );
  const ctxInactiveUserWithActiveAdminRole = await resolveGovernanceAccessContext(inactiveUserWithActiveAdminRole.id);
  check(
    "[8c-2c] inactive User 即使具有 active Admin UserRole，resolveGovernanceAccessContext 仍判定 isActive=false 且所有治理管理能力為 false",
    ctxInactiveUserWithActiveAdminRole.isActive === false &&
      ctxInactiveUserWithActiveAdminRole.canManageSupervisors === false &&
      ctxInactiveUserWithActiveAdminRole.canManageTeamLeads === false &&
      ctxInactiveUserWithActiveAdminRole.canManageAnyDelegation === false &&
      ctxInactiveUserWithActiveAdminRole.canViewAllGovernance === false,
  );

  // [8c-3] 對照組：active User 具有 active Admin UserRole 時，才可通過（與 [8c-2] 唯一差異
  // 只有 User.isActive，證明是 isActive 而非其他因素造成拒絕）。
  const activeUserWithActiveAdminRole = await createUser("activeUserWithActiveAdminRole", "PM", true);
  fx.userIds.push(activeUserWithActiveAdminRole.id);
  await prisma.userRole.create({ data: { userId: activeUserWithActiveAdminRole.id, role: "Admin", isActive: true } });
  await checkAsync(
    "[8c-3a] active User 具有 active Admin UserRole，getUserHasCapability 回傳 true",
    async () => await getUserHasCapability(activeUserWithActiveAdminRole, "admin.full"),
  );
  await checkAsync(
    "[8c-3b] active User 具有 active Admin UserRole，requireCapability 不拋出",
    async () => {
      await requireCapability(activeUserWithActiveAdminRole, "admin.full");
      return true;
    },
  );

  // [8d] 多個 active UserRole → Capability 正確聯集
  const multiRoleUser = await prisma.user.create({
    data: { name: "multiRoleUser", email: `${RUN_TAG}-multiRoleUser@example.invalid`, role: "RD" },
  });
  fx.userIds.push(multiRoleUser.id);
  await prisma.userRole.create({ data: { userId: multiRoleUser.id, role: "RD", isActive: true } });
  await prisma.userRole.create({ data: { userId: multiRoleUser.id, role: "QA", isActive: true } });
  await checkAsync(
    "[8d] 多個 active UserRole（RD+QA）正確聯集：具有 issue.edit（來自 RD）與 issue.approve（來自 QA）",
    async () => (await getUserHasCapability(multiRoleUser, "issue.edit")) && (await getUserHasCapability(multiRoleUser, "issue.approve")),
  );

  // [8e] resolveGovernanceAccessContext：不讀 User.role，只讀 active UserRole
  const ctxAdminRoleNoActiveRole = await resolveGovernanceAccessContext(adminRoleNoActiveRole.id);
  check(
    "[8e-1] resolveGovernanceAccessContext：User.role=Admin 但無 active UserRole 時，所有治理管理能力均為 false（不讀 User.role）",
    ctxAdminRoleNoActiveRole.canManageSupervisors === false &&
      ctxAdminRoleNoActiveRole.canManageTeamLeads === false &&
      ctxAdminRoleNoActiveRole.canManageAnyDelegation === false &&
      ctxAdminRoleNoActiveRole.canViewAllGovernance === false,
  );
  const ctxNonAdminRoleActiveAdminRole = await resolveGovernanceAccessContext(nonAdminRoleActiveAdminRole.id);
  check(
    "[8e-2] resolveGovernanceAccessContext：User.role=PM 但具有 active Admin UserRole 時，取得完整治理管理能力（只讀 active UserRole）",
    ctxNonAdminRoleActiveAdminRole.canManageSupervisors === true &&
      ctxNonAdminRoleActiveAdminRole.canManageTeamLeads === true &&
      ctxNonAdminRoleActiveAdminRole.canManageAnyDelegation === true &&
      ctxNonAdminRoleActiveAdminRole.canViewAllGovernance === true,
  );

  // [8f] 資安推動小組：有 user.view／team.view，無 user.create／team.manageMembers 等管理能力
  const secTeamCaps = roleCapabilities("資安推動小組");
  check(
    "[8f] 資安推動小組：具有 user.view／team.view，不具有 user.create／user.update／user.activate／user.deactivate／user.assignRole／user.removeRole／team.manageMembers",
    secTeamCaps.has("user.view") &&
      secTeamCaps.has("team.view") &&
      !secTeamCaps.has("user.create") &&
      !secTeamCaps.has("user.update") &&
      !secTeamCaps.has("user.activate") &&
      !secTeamCaps.has("user.deactivate") &&
      !secTeamCaps.has("user.assignRole") &&
      !secTeamCaps.has("user.removeRole") &&
      !secTeamCaps.has("team.manageMembers"),
  );

  // [8g] 一般 RD／QA／OP／DMS主管：不自動取得任何新增人員管理能力
  const newUserManagementCaps = ["user.create", "user.update", "user.activate", "user.deactivate", "user.assignRole", "user.removeRole"] as const;
  for (const roleKey of ["RD", "QA", "OP", "DMS主管"] as const) {
    const caps = roleCapabilities(roleKey);
    check(
      `[8g] ${roleKey}：不取得任何新增人員管理能力（${newUserManagementCaps.join("/")}）`,
      newUserManagementCaps.every((cap) => !caps.has(cap)),
    );
  }
}

// ===========================================================================
// C1-B3／C1-B4／C1-B5：People／角色／Team／停用治理／row-level 驗證
// ===========================================================================
async function runPeopleServiceTests(fx: Fixtures) {
  console.log("\n=== C1-B3／C1-B4／C1-B5 驗證：People／角色／Team／停用治理／row-level ===");

  const admin = await createUser("peopleAdmin", "Admin");
  fx.userIds.push(admin.id);

  // -------------------------------------------------------------------------
  // People：createPerson
  // -------------------------------------------------------------------------
  const createdEmail = `${RUN_TAG}-created-person@example.invalid`;
  const created = await createPerson({
    name: "新建人員",
    email: createdEmail,
    department: "測試部",
    initialRole: "PM",
    actorId: admin.id,
    reasonCode: "TEST_CREATE",
  });
  fx.userIds.push(created.id);

  await checkAsync(
    "[P1] createPerson：同一 transaction 建立 User＋active UserRole＋UserRoleHistory(ASSIGNED)＋2 筆 AuditLog",
    async () => {
      const userRole = await prisma.userRole.findUnique({ where: { userId_role: { userId: created.id, role: "PM" } } });
      if (!userRole || !userRole.isActive) return false;
      const history = await prisma.userRoleHistory.findFirst({
        where: { userRoleId: userRole.id, eventType: "ASSIGNED", reasonCode: "TEST_CREATE" },
      });
      const userCreatedLog = await prisma.auditLog.findFirst({
        where: { entityType: "User", entityId: created.id, actionType: "UserCreated" },
      });
      const roleAssignedLog = await prisma.auditLog.findFirst({
        where: { entityType: "UserRole", entityId: userRole.id, actionType: "UserRoleAssigned" },
      });
      return !!history && !!userCreatedLog && !!roleAssignedLog && created.role === "PM" && created.isActive === true;
    },
  );

  await expectError(
    "[P2] createPerson：email 重複時拒絕，不留下半成品資料（transaction rollback）",
    () => createPerson({ name: "重複信箱", email: createdEmail, initialRole: "PM", actorId: admin.id, reasonCode: "TEST_DUP" }),
    (e) => e instanceof PeopleValidationError,
  );
  await checkAsync("[P2b] createPerson rollback 後，該 email 底下仍只有原本一筆 User", async () => {
    const usersWithEmail = await prisma.user.count({ where: { email: createdEmail } });
    return usersWithEmail === 1;
  });

  // updatePersonProfile：一般更新 + no-op
  await checkAsync("[P3] updatePersonProfile：更新 name／department 並寫入 UserUpdated AuditLog", async () => {
    const updated = await updatePersonProfile({
      userId: created.id,
      name: "更新後姓名",
      department: "新部門",
      actorId: admin.id,
      reasonCode: "TEST_UPDATE",
    });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "User", entityId: created.id, actionType: "UserUpdated" } });
    return updated.name === "更新後姓名" && updated.department === "新部門" && !!log;
  });
  await checkAsync("[P4] updatePersonProfile no-op（欄位值未變）不寫入新的 UserUpdated AuditLog", async () => {
    const before = await prisma.auditLog.count({ where: { entityType: "User", entityId: created.id, actionType: "UserUpdated" } });
    await updatePersonProfile({ userId: created.id, name: "更新後姓名", department: "新部門", actorId: admin.id, reasonCode: "TEST_NOOP" });
    const after = await prisma.auditLog.count({ where: { entityType: "User", entityId: created.id, actionType: "UserUpdated" } });
    return after === before;
  });

  // -------------------------------------------------------------------------
  // People：角色（assignSystemRole／updatePrimaryRole／removeSystemRole）
  // -------------------------------------------------------------------------
  const roleTester = await createUser("roleTester", "PM");
  fx.userIds.push(roleTester.id);

  await checkAsync("[P5] assignSystemRole：新增角色 RD，寫入 UserRole(active)＋History(ASSIGNED)＋AuditLog", async () => {
    const userRole = await assignSystemRole({ userId: roleTester.id, role: "RD", actorId: admin.id, reasonCode: "TEST_ASSIGN" });
    const history = await prisma.userRoleHistory.findFirst({
      where: { userRoleId: userRole.id, eventType: "ASSIGNED", reasonCode: "TEST_ASSIGN" },
    });
    return userRole.isActive === true && !!history;
  });

  await expectError(
    "[P5b] assignSystemRole：對已 active 的角色重複指派時拒絕（不重複寫 History）",
    () => assignSystemRole({ userId: roleTester.id, role: "RD", actorId: admin.id, reasonCode: "TEST_DUP_ASSIGN" }),
    (e) => e instanceof PeopleStateError,
  );

  await removeSystemRole({ userId: roleTester.id, role: "RD", actorId: admin.id, reasonCode: "TEST_REMOVE_FOR_REACTIVATE" });
  await checkAsync("[P6] assignSystemRole：對先前已移除（inactive）的角色重新啟用，重用同一筆 UserRole", async () => {
    const before = await prisma.userRole.findUnique({ where: { userId_role: { userId: roleTester.id, role: "RD" } } });
    const reactivated = await assignSystemRole({ userId: roleTester.id, role: "RD", actorId: admin.id, reasonCode: "TEST_REACTIVATE" });
    return before?.id === reactivated.id && reactivated.isActive === true;
  });

  await checkAsync("[P7] updatePrimaryRole：切換主要角色，寫入 PRIMARY_CHANGED History＋RoleChange AuditLog", async () => {
    const updated = await updatePrimaryRole({ userId: roleTester.id, role: "RD", actorId: admin.id, reasonCode: "TEST_PRIMARY" });
    const userRole = await prisma.userRole.findUnique({ where: { userId_role: { userId: roleTester.id, role: "RD" } } });
    const history = await prisma.userRoleHistory.findFirst({
      where: { userRoleId: userRole!.id, eventType: "PRIMARY_CHANGED", fromValue: "PM", toValue: "RD" },
    });
    const log = await prisma.auditLog.findFirst({
      where: { entityType: "User", entityId: roleTester.id, actionType: "RoleChange", fromValue: "PM", toValue: "RD" },
    });
    return updated.role === "RD" && !!history && !!log;
  });

  await expectError(
    "[P8] removeSystemRole：不得移除目前的主要角色（blocking）",
    () => removeSystemRole({ userId: roleTester.id, role: "RD", actorId: admin.id, reasonCode: "TEST_REMOVE_PRIMARY" }),
    (e) => e instanceof PeopleStateError,
  );

  // 「最後一個 active 角色」規則獨立於「主要角色」規則之外：構造 User.role 與唯一 active
  // UserRole 不一致的防禦性資料情境（無法透過本模組自身 API 產生，僅用於驗證防禦邏輯本身）。
  const inconsistentPrimaryUser = await prisma.user.create({
    data: { name: "inconsistentPrimaryUser", email: `${RUN_TAG}-inconsistentPrimaryUser@example.invalid`, role: "PM", isActive: true },
  });
  fx.userIds.push(inconsistentPrimaryUser.id);
  await prisma.userRole.create({ data: { userId: inconsistentPrimaryUser.id, role: "RD", isActive: true } });
  await expectError(
    "[P9] removeSystemRole：不得移除使用者最後一個 active 角色（即使該角色非主要角色顯示快取）",
    () => removeSystemRole({ userId: inconsistentPrimaryUser.id, role: "RD", actorId: admin.id, reasonCode: "TEST_LAST_ROLE" }),
    (e) => e instanceof PeopleStateError,
  );

  // 最後一位有效 Admin blocking：讓 admin 額外持有 PM 並切換為 primary，使 Admin 角色本身
  // 變成「非主要角色」，藉此單獨驗證「最後一位有效 Admin」規則（而非先被主要角色規則擋下）。
  // 上方 runDbDependentTests（C1-B2 情境 [8b]/[8c-3] 等）已在同一份 scratch DB 建立其他
  // active Admin UserRole 的測試使用者；為了讓本測試組真正隔離驗證「最後一位有效 Admin」，
  // 先將這些「與本測試組無關」的其他 active Admin UserRole 全部中性化（isActive=false）。
  // 這可能包含既存（非本次 fixture）使用者的 UserRole（例如 admin@example.com），
  // 因此明確記錄受影響的 UserRole id，於 cleanupFixtures 內還原為 isActive=true，
  // 不得讓既有 seed 資料的授權狀態永久遺失。
  {
    const toNeutralize = await prisma.userRole.findMany({
      where: { role: "Admin", isActive: true, userId: { not: admin.id } },
      select: { id: true },
    });
    fx.neutralizedAdminUserRoleIds.push(...toNeutralize.map((r) => r.id));
    if (toNeutralize.length > 0) {
      await prisma.userRole.updateMany({ where: { id: { in: toNeutralize.map((r) => r.id) } }, data: { isActive: false } });
    }
  }
  await assignSystemRole({ userId: admin.id, role: "PM", actorId: admin.id, reasonCode: "TEST_SETUP_SECOND_ROLE" });
  await updatePrimaryRole({ userId: admin.id, role: "PM", actorId: admin.id, reasonCode: "TEST_SETUP_PRIMARY_SWITCH" });
  await expectError(
    "[P10] removeSystemRole：不得移除最後一位有效 Admin 的角色（blocking）",
    () => removeSystemRole({ userId: admin.id, role: "Admin", actorId: admin.id, reasonCode: "TEST_LAST_ADMIN" }),
    (e) => e instanceof PeopleStateError,
  );

  // 測試隔離修復（原 [D6]／[D6b] 根因）：D6／D6b 驗證「唯一 active Break-glass Admin」時
  // blocking／deactivatePerson 行為，此前提不得依賴 scratch DB 是否已 seed——若 scratch DB
  // 複製自已 seed 過的 dev.db（或本身執行過 prisma/seed.ts），會已經存在一位既存的
  // isBreakGlassAdmin=true 使用者（例如 admin@example.com），導致下方建立的 breakGlassUser
  // 並非真正唯一。比照上方 [P10]／[D5] 已經採用的「暫時中性化＋不還原個別欄位」模式，但這裡
  // 明確記錄受影響的既存 User id 並於 cleanupFixtures 內還原，不得讓既存 seed 資料的
  // isBreakGlassAdmin 標記永久遺失。
  const preExistingBreakGlassUsers = await prisma.user.findMany({
    where: { isBreakGlassAdmin: true },
    select: { id: true },
  });
  fx.neutralizedBreakGlassAdminUserIds.push(...preExistingBreakGlassUsers.map((u) => u.id));
  if (preExistingBreakGlassUsers.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: preExistingBreakGlassUsers.map((u) => u.id) } },
      data: { isBreakGlassAdmin: false },
    });
  }

  // Break-glass Admin 的 Admin 角色不得移除（縱使還有其他有效 Admin，例如上方的 admin 本身）。
  const breakGlassUser = await createUser("breakGlassAdminUser", "Admin");
  fx.userIds.push(breakGlassUser.id);
  await prisma.user.update({ where: { id: breakGlassUser.id }, data: { isBreakGlassAdmin: true } });
  await assignSystemRole({ userId: breakGlassUser.id, role: "PM", actorId: admin.id, reasonCode: "TEST_SETUP_SECOND_ROLE" });
  await expectError(
    "[P11] removeSystemRole：Break-glass Admin 的 Admin 角色不得移除",
    () => removeSystemRole({ userId: breakGlassUser.id, role: "Admin", actorId: admin.id, reasonCode: "TEST_BREAK_GLASS" }),
    (e) => e instanceof PeopleStateError,
  );

  // -------------------------------------------------------------------------
  // People：activatePerson 完整性檢查
  // -------------------------------------------------------------------------
  const noRoleUser = await prisma.user.create({
    data: { name: "noRoleUser", email: `${RUN_TAG}-noRoleUser@example.invalid`, role: "PM", isActive: false },
  });
  fx.userIds.push(noRoleUser.id);
  await expectError(
    "[P12a] activatePerson：沒有任何 active UserRole 時不得啟用",
    () => activatePerson({ userId: noRoleUser.id, actorId: admin.id, reasonCode: "TEST_ACTIVATE" }),
    (e) => e instanceof PeopleStateError,
  );

  const mismatchRoleUser = await prisma.user.create({
    data: { name: "mismatchRoleUser", email: `${RUN_TAG}-mismatchRoleUser@example.invalid`, role: "RD", isActive: false },
  });
  fx.userIds.push(mismatchRoleUser.id);
  await prisma.userRole.create({ data: { userId: mismatchRoleUser.id, role: "PM", isActive: true } });
  await expectError(
    "[P12b] activatePerson：User.role 與 active UserRole 不一致時不得啟用（不自動修復）",
    () => activatePerson({ userId: mismatchRoleUser.id, actorId: admin.id, reasonCode: "TEST_ACTIVATE" }),
    (e) => e instanceof PeopleStateError,
  );

  const breakGlassNoAdminRoleUser = await prisma.user.create({
    data: {
      name: "breakGlassNoAdminRoleUser",
      email: `${RUN_TAG}-breakGlassNoAdminRoleUser@example.invalid`,
      role: "PM",
      isActive: false,
      isBreakGlassAdmin: true,
    },
  });
  fx.userIds.push(breakGlassNoAdminRoleUser.id);
  await prisma.userRole.create({ data: { userId: breakGlassNoAdminRoleUser.id, role: "PM", isActive: true } });
  await expectError(
    "[P12c] activatePerson：Break-glass Admin 沒有 active 的 Admin UserRole 時不得啟用",
    () => activatePerson({ userId: breakGlassNoAdminRoleUser.id, actorId: admin.id, reasonCode: "TEST_ACTIVATE" }),
    (e) => e instanceof PeopleStateError,
  );

  const consistentInactiveUser = await prisma.user.create({
    data: { name: "consistentInactiveUser", email: `${RUN_TAG}-consistentInactiveUser@example.invalid`, role: "PM", isActive: false },
  });
  fx.userIds.push(consistentInactiveUser.id);
  await prisma.userRole.create({ data: { userId: consistentInactiveUser.id, role: "PM", isActive: true } });
  await checkAsync("[P12d] activatePerson：狀態一致時成功啟用並寫入 UserActivated AuditLog", async () => {
    const activated = await activatePerson({ userId: consistentInactiveUser.id, actorId: admin.id, reasonCode: "TEST_ACTIVATE" });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "User", entityId: consistentInactiveUser.id, actionType: "UserActivated" } });
    return activated.isActive === true && !!log;
  });

  // -------------------------------------------------------------------------
  // Team：addTeamMember／removeTeamMember／LEAD History
  // -------------------------------------------------------------------------
  const teamA = await prisma.team.create({ data: { name: `${RUN_TAG}-teamA` } });
  fx.teamIds.push(teamA.id);
  const memberUser = await createUser("teamMemberUser", "RD");
  fx.userIds.push(memberUser.id);

  await checkAsync("[T1] addTeamMember：新增 MEMBER，寫入 TeamMembershipHistory(JOINED)＋TeamMemberAdded AuditLog", async () => {
    const membership = await addTeamMember({ teamId: teamA.id, userId: memberUser.id, actorId: admin.id, reasonCode: "TEST_JOIN" });
    const history = await prisma.teamMembershipHistory.findFirst({ where: { teamMemberId: membership.id, eventType: "JOINED" } });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "TeamMember", entityId: membership.id, actionType: "TeamMemberAdded" } });
    return membership.isActive === true && membership.membershipRole === "MEMBER" && !!history && !!log;
  });

  await checkAsync("[T2] removeTeamMember：移除 MEMBER，寫入 TeamMembershipHistory(REMOVED)＋TeamMemberRemoved AuditLog", async () => {
    const membership = await removeTeamMember({ teamId: teamA.id, userId: memberUser.id, actorId: admin.id, reasonCode: "TEST_REMOVE" });
    const history = await prisma.teamMembershipHistory.findFirst({ where: { teamMemberId: membership.id, eventType: "REMOVED" } });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "TeamMember", entityId: membership.id, actionType: "TeamMemberRemoved" } });
    return membership.isActive === false && !!history && !!log;
  });

  const leadUser = await createUser("teamLeadUserForRemoval", "RD");
  fx.userIds.push(leadUser.id);
  await addTeamMember({ teamId: teamA.id, userId: leadUser.id, actorId: admin.id, reasonCode: "TEST_JOIN_FOR_LEAD" });
  await assignTeamLead({ teamId: teamA.id, userId: leadUser.id, actorId: admin.id, reasonCode: "TEST_ASSIGN_LEAD" });
  await expectError(
    "[T3] removeTeamMember：LEAD 必須先透過 removeTeamLead 降級，不得直接移除",
    () => removeTeamMember({ teamId: teamA.id, userId: leadUser.id, actorId: admin.id, reasonCode: "TEST_REMOVE_LEAD_DIRECT" }),
    (e) => e instanceof PeopleStateError,
  );

  await checkAsync("[T4a] assignTeamLead：寫入 TeamMembershipHistory(ROLE_CHANGED, MEMBER→LEAD)", async () => {
    const membership = await prisma.teamMember.findFirst({ where: { teamId: teamA.id, userId: leadUser.id } });
    const history = await prisma.teamMembershipHistory.findFirst({
      where: { teamMemberId: membership!.id, eventType: "ROLE_CHANGED", fromMembershipRole: "MEMBER", toMembershipRole: "LEAD" },
    });
    return !!history;
  });
  await removeTeamLead({ teamId: teamA.id, userId: leadUser.id, actorId: admin.id, reasonCode: "TEST_REMOVE_LEAD" });
  await checkAsync("[T4b] removeTeamLead：寫入 TeamMembershipHistory(ROLE_CHANGED, LEAD→MEMBER)", async () => {
    const membership = await prisma.teamMember.findFirst({ where: { teamId: teamA.id, userId: leadUser.id } });
    const history = await prisma.teamMembershipHistory.findFirst({
      where: { teamMemberId: membership!.id, eventType: "ROLE_CHANGED", fromMembershipRole: "LEAD", toMembershipRole: "MEMBER" },
    });
    return !!history;
  });
  await removeTeamMember({ teamId: teamA.id, userId: leadUser.id, actorId: admin.id, reasonCode: "TEST_CLEANUP_MEMBER" });

  // candidate 歸零 blocking：removeTeamMember 移除的目標一律先前已排除 LEAD（見 [T3]），因此
  // 目前 eligibility 演算法下（僅 LEAD／其代理人構成候選人）一般 MEMBER 的移除不會影響任何
  // 待核准紀錄的候選人集合——這裡驗證檢查本身正確運作、且不會誤擋正常的成員移除。
  const teamF = await prisma.team.create({ data: { name: `${RUN_TAG}-teamF` } });
  fx.teamIds.push(teamF.id);
  const plainMemberForCandidateCheck = await createUser("plainMemberForCandidateCheck", "RD");
  fx.userIds.push(plainMemberForCandidateCheck.id);
  await addTeamMember({ teamId: teamF.id, userId: plainMemberForCandidateCheck.id, actorId: admin.id, reasonCode: "TEST_JOIN" });
  const leadForCandidateCheck = await createUser("leadForCandidateCheck", "RD");
  fx.userIds.push(leadForCandidateCheck.id);
  await addTeamMember({ teamId: teamF.id, userId: leadForCandidateCheck.id, actorId: admin.id, reasonCode: "TEST_JOIN" });
  await assignTeamLead({ teamId: teamF.id, userId: leadForCandidateCheck.id, actorId: admin.id, reasonCode: "TEST_ASSIGN_LEAD" });
  const requesterForCandidateCheck = await createUser("requesterForCandidateCheck", "PM");
  fx.userIds.push(requesterForCandidateCheck.id);
  const issueForCandidateCheck = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-CANDCHECK`,
      issueType: "Hotfix",
      title: "verify candidate check",
      workflowStatus: "rdInProgress",
      assignedTeamId: teamF.id,
    },
  });
  fx.issueIds.push(issueForCandidateCheck.id);
  const pendingForCandidateCheck = await createPendingRecord({
    issueId: issueForCandidateCheck.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: "pendingRdLeadApproval",
    requestedByUserId: requesterForCandidateCheck.id,
    approverTeamId: teamF.id,
  });
  fx.approvalRecordIdsNewestFirst.push(pendingForCandidateCheck.id);
  await checkAsync(
    "[T5] removeTeamMember：一般 MEMBER（非候選人）移除不受待核准紀錄候選人歸零檢查影響，正常成功",
    async () => {
      const membership = await removeTeamMember({
        teamId: teamF.id,
        userId: plainMemberForCandidateCheck.id,
        actorId: admin.id,
        reasonCode: "TEST_REMOVE_NON_CANDIDATE",
      });
      return membership.isActive === false;
    },
  );

  // -------------------------------------------------------------------------
  // Deactivation：blocking／warning／pending approval 候選人模擬
  // -------------------------------------------------------------------------

  // LEAD blocking
  const teamG = await prisma.team.create({ data: { name: `${RUN_TAG}-teamG` } });
  fx.teamIds.push(teamG.id);
  const leadForDeactivation = await createUser("leadForDeactivation", "RD");
  fx.userIds.push(leadForDeactivation.id);
  await addTeamMember({ teamId: teamG.id, userId: leadForDeactivation.id, actorId: admin.id, reasonCode: "TEST_JOIN" });
  await assignTeamLead({ teamId: teamG.id, userId: leadForDeactivation.id, actorId: admin.id, reasonCode: "TEST_ASSIGN_LEAD" });
  await checkAsync("[D1] getUserDeactivationImpact：active Team LEAD 為 blocking 項目", async () => {
    const impact = await getUserDeactivationImpact({ userId: leadForDeactivation.id, actorId: admin.id });
    return impact.some((i) => i.category === "teamLead" && i.blocking);
  });
  await expectError(
    "[D1b] deactivatePerson：active Team LEAD 整筆拒絕（blocking）",
    () => deactivatePerson({ userId: leadForDeactivation.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE" }),
    (e) => e instanceof PeopleStateError,
  );
  await checkAsync("[D1c] deactivatePerson blocking 後，User 仍為 active（transaction rollback，未留半成品狀態）", async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: leadForDeactivation.id } });
    const membership = await prisma.teamMember.findFirstOrThrow({ where: { teamId: teamG.id, userId: leadForDeactivation.id } });
    const teamMemberRemovedLog = await prisma.auditLog.findFirst({
      where: { entityType: "TeamMember", entityId: membership.id, actionType: "TeamMemberRemoved" },
    });
    return row.isActive === true && membership.isActive === true && !teamMemberRemovedLog;
  });

  // supervisor blocking
  const supervisorForDeactivation = await createUser("supervisorForDeactivation", "DMS主管");
  const superviseeForDeactivation = await createUser("superviseeForDeactivation", "PM");
  fx.userIds.push(supervisorForDeactivation.id, superviseeForDeactivation.id);
  const assignmentForDeactivation = await prisma.userSupervisorAssignment.create({
    data: {
      userId: superviseeForDeactivation.id,
      supervisorUserId: supervisorForDeactivation.id,
      validFrom: new Date(Date.now() - 30 * DAY),
      isPrimary: true,
      createdByUserId: admin.id,
    },
  });
  fx.assignmentIds.push(assignmentForDeactivation.id);
  await expectError(
    "[D2] deactivatePerson：active 直屬主管整筆拒絕（blocking）",
    () => deactivatePerson({ userId: supervisorForDeactivation.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE" }),
    (e) => e instanceof PeopleStateError,
  );

  // delegation delegator blocking
  const delegatorForDeactivation = await createUser("delegatorForDeactivation", "DMS主管");
  const delegateOfDeactivatingDelegator = await createUser("delegateOfDeactivatingDelegator", "PM");
  fx.userIds.push(delegatorForDeactivation.id, delegateOfDeactivatingDelegator.id);
  const delegationFromDeactivating = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: delegatorForDeactivation.id,
      delegateUserId: delegateOfDeactivatingDelegator.id,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(Date.now() - DAY),
      validUntil: new Date(Date.now() + 30 * DAY),
      createdByUserId: admin.id,
    },
  });
  fx.delegationIds.push(delegationFromDeactivating.id);
  await expectError(
    "[D3] deactivatePerson：active 代理委任來源（delegator）整筆拒絕（blocking）",
    () => deactivatePerson({ userId: delegatorForDeactivation.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE" }),
    (e) => e instanceof PeopleStateError,
  );

  // delegation delegate blocking
  await expectError(
    "[D4] deactivatePerson：active 代理人（delegate）整筆拒絕（blocking）",
    () => deactivatePerson({ userId: delegateOfDeactivatingDelegator.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE" }),
    (e) => e instanceof PeopleStateError,
  );

  // last Admin blocking（deactivatePerson）：沿用 admin 本身目前是唯一有效 Admin。
  // breakGlassUser（[P11]）建立時也持有 active 的 Admin UserRole，必須再次中性化其他
  // active Admin UserRole（不影響 breakGlassUser 的 isBreakGlassAdmin 標記本身，[D6]／[D6b]
  // 測試的是獨立的 User.isBreakGlassAdmin 規則，不受此處影響），才能真正孤立驗證本規則。
  // 同樣記錄受影響的既存 UserRole id，供 cleanupFixtures 還原。
  {
    const toNeutralize = await prisma.userRole.findMany({
      where: { role: "Admin", isActive: true, userId: { not: admin.id } },
      select: { id: true },
    });
    fx.neutralizedAdminUserRoleIds.push(...toNeutralize.map((r) => r.id));
    if (toNeutralize.length > 0) {
      await prisma.userRole.updateMany({ where: { id: { in: toNeutralize.map((r) => r.id) } }, data: { isActive: false } });
    }
  }
  await expectError(
    "[D5] deactivatePerson：不得停用最後一位有效 Admin",
    () => deactivatePerson({ userId: admin.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE_LAST_ADMIN" }),
    (e) => e instanceof PeopleStateError,
  );

  // last Break-glass Admin blocking
  await checkAsync("[D6] getUserDeactivationImpact：唯一 active Break-glass Admin 為 blocking 項目", async () => {
    const impact = await getUserDeactivationImpact({ userId: breakGlassUser.id, actorId: admin.id });
    return impact.some((i) => i.category === "lastBreakGlassAdmin" && i.blocking);
  });
  await expectError(
    "[D6b] deactivatePerson：不得停用唯一 active 的 Break-glass Admin",
    () => deactivatePerson({ userId: breakGlassUser.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE" }),
    (e) => e instanceof PeopleStateError,
  );

  // 雙重有效 Break-glass Admin 情境：確認「唯一」規則不會誤傷「非唯一」情況——
  // 存在兩位 active Break-glass Admin 時，停用其中一位不應被 lastBreakGlassAdmin 規則
  // 擋下（因為停用後仍有另一位）。避免只驗證單一情境、未來被誤解成「一律 blocking」。
  const breakGlassDual1 = await createUser("breakGlassDualOne", "Admin");
  const breakGlassDual2 = await createUser("breakGlassDualTwo", "Admin");
  fx.userIds.push(breakGlassDual1.id, breakGlassDual2.id);
  await prisma.user.updateMany({
    where: { id: { in: [breakGlassDual1.id, breakGlassDual2.id] } },
    data: { isBreakGlassAdmin: true },
  });
  await checkAsync(
    "[D6c] getUserDeactivationImpact：存在兩位 active Break-glass Admin 時，任一位皆不產生 lastBreakGlassAdmin blocking",
    async () => {
      const impact = await getUserDeactivationImpact({ userId: breakGlassDual1.id, actorId: admin.id });
      return !impact.some((i) => i.category === "lastBreakGlassAdmin" && i.blocking);
    },
  );
  await checkAsync(
    "[D6d] deactivatePerson：存在兩位 active Break-glass Admin 時，停用其中一位成功執行（不被 lastBreakGlassAdmin 擋下）",
    async () => {
      const deactivated = await deactivatePerson({
        userId: breakGlassDual1.id,
        actorId: admin.id,
        reasonCode: "TEST_DEACTIVATE_DUAL_BREAK_GLASS",
      });
      return deactivated.isActive === false;
    },
  );
  await checkAsync(
    "[D6e] 停用其中一位 Break-glass Admin 後，另一位仍為有效 Break-glass Admin（isActive=true 且 isBreakGlassAdmin=true）",
    async () => {
      const remaining = await prisma.user.findUniqueOrThrow({ where: { id: breakGlassDual2.id } });
      return remaining.isActive === true && remaining.isBreakGlassAdmin === true;
    },
  );

  // pending ApprovalRecord 候選人模擬：leadForDeactivation 同時也是某筆待核准紀錄目前唯一
  // 合法核准人（與 [D1] 的 teamLead blocking 同時成立，驗證兩種 blocking 類別都被偵測到）。
  const issueForPendingImpact = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-PENDIMPACT`,
      issueType: "Hotfix",
      title: "verify pending approval impact",
      workflowStatus: "rdInProgress",
      assignedTeamId: teamG.id,
    },
  });
  fx.issueIds.push(issueForPendingImpact.id);
  const requesterForPendingImpact = await createUser("requesterForPendingImpact", "PM");
  fx.userIds.push(requesterForPendingImpact.id);
  const pendingForImpact = await createPendingRecord({
    issueId: issueForPendingImpact.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: "pendingRdLeadApproval",
    requestedByUserId: requesterForPendingImpact.id,
    approverTeamId: teamG.id,
  });
  fx.approvalRecordIdsNewestFirst.push(pendingForImpact.id);
  await checkAsync(
    "[D7] getUserDeactivationImpact：此人是待核准紀錄目前唯一合法核准人時，包含 pendingApproval blocking 項目",
    async () => {
      const impact = await getUserDeactivationImpact({ userId: leadForDeactivation.id, actorId: admin.id });
      return impact.some((i) => i.category === "pendingApproval" && i.blocking && i.relatedEntityId === pendingForImpact.id);
    },
  );

  // 多候選人仍可停用：與此人完全無關的其他待核准紀錄（其他候選人）存在時，不影響一般
  // 無治理身分人員的停用。
  const uninvolvedUser = await createUser("uninvolvedUserForDeactivation", "PM");
  fx.userIds.push(uninvolvedUser.id);
  await checkAsync("[D8] deactivatePerson：與現有待核准紀錄無關的一般人員，停用不受影響（多候選人／無關候選人仍可停用）", async () => {
    const impactBefore = await getUserDeactivationImpact({ userId: uninvolvedUser.id, actorId: admin.id });
    if (impactBefore.some((i) => i.blocking)) return false;
    const deactivated = await deactivatePerson({ userId: uninvolvedUser.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE_UNINVOLVED" });
    return deactivated.isActive === false;
  });

  // MEMBER 自動結束 membership
  const teamH = await prisma.team.create({ data: { name: `${RUN_TAG}-teamH` } });
  fx.teamIds.push(teamH.id);
  const memberForAutoEnd = await createUser("memberForAutoEnd", "RD");
  fx.userIds.push(memberForAutoEnd.id);
  await addTeamMember({ teamId: teamH.id, userId: memberForAutoEnd.id, actorId: admin.id, reasonCode: "TEST_JOIN" });
  await checkAsync(
    "[D9] deactivatePerson：一般 MEMBER 身分自動結束，寫入 TeamMembershipHistory(REMOVED)＋TeamMemberRemoved AuditLog",
    async () => {
      await deactivatePerson({ userId: memberForAutoEnd.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE" });
      const membership = await prisma.teamMember.findFirst({ where: { teamId: teamH.id, userId: memberForAutoEnd.id } });
      const history = await prisma.teamMembershipHistory.findFirst({ where: { teamMemberId: membership!.id, eventType: "REMOVED" } });
      const log = await prisma.auditLog.findFirst({
        where: { entityType: "TeamMember", entityId: membership!.id, actionType: "TeamMemberRemoved" },
      });
      return membership!.isActive === false && !!history && !!log;
    },
  );

  // Issue owner／reporter warning（不 blocking）
  const issueOwnerWarningUser = await createUser("issueOwnerWarningUser", "RD");
  fx.userIds.push(issueOwnerWarningUser.id);
  const unclosedIssueForWarning = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-WARN`,
      issueType: "Hotfix",
      title: "verify issue owner warning",
      workflowStatus: "rdInProgress",
      ownerUserId: issueOwnerWarningUser.id,
      reporterUserId: issueOwnerWarningUser.id,
    },
  });
  fx.issueIds.push(unclosedIssueForWarning.id);
  await checkAsync("[D10] getUserDeactivationImpact：未結案 Issue owner／reporter 為 warning（非 blocking）項目", async () => {
    const impact = await getUserDeactivationImpact({ userId: issueOwnerWarningUser.id, actorId: admin.id });
    const ownerItem = impact.find((i) => i.category === "issueOwner");
    const reporterItem = impact.find((i) => i.category === "issueReporter");
    return !!ownerItem && !ownerItem.blocking && ownerItem.severity === "warning" && !!reporterItem && !reporterItem.blocking;
  });
  await checkAsync("[D10b] deactivatePerson：僅有 warning 項目時仍可正常停用", async () => {
    const deactivated = await deactivatePerson({ userId: issueOwnerWarningUser.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE" });
    return deactivated.isActive === false;
  });

  // -------------------------------------------------------------------------
  // Audit：preview 不寫 ImpactChecked／明確 impact check 可寫
  // -------------------------------------------------------------------------
  const impactAuditUser = await createUser("impactAuditUser", "PM");
  fx.userIds.push(impactAuditUser.id);
  await checkAsync("[A1] getUserDeactivationImpact（預覽）不寫入 UserDeactivationImpactChecked AuditLog", async () => {
    const before = await prisma.auditLog.count({
      where: { entityType: "User", entityId: impactAuditUser.id, actionType: "UserDeactivationImpactChecked" },
    });
    await getUserDeactivationImpact({ userId: impactAuditUser.id, actorId: admin.id });
    const after = await prisma.auditLog.count({
      where: { entityType: "User", entityId: impactAuditUser.id, actionType: "UserDeactivationImpactChecked" },
    });
    return after === before && before === 0;
  });
  await checkAsync("[A2] checkUserDeactivationImpact（明確檢查）寫入 UserDeactivationImpactChecked AuditLog", async () => {
    await checkUserDeactivationImpact({ userId: impactAuditUser.id, actorId: admin.id });
    const log = await prisma.auditLog.findFirst({
      where: { entityType: "User", entityId: impactAuditUser.id, actionType: "UserDeactivationImpactChecked" },
    });
    return !!log;
  });

  // -------------------------------------------------------------------------
  // Row-level：Admin／資安推動小組／Team LEAD／一般使用者／非授權直接服務呼叫
  // -------------------------------------------------------------------------
  const teamI = await prisma.team.create({ data: { name: `${RUN_TAG}-teamI` } });
  fx.teamIds.push(teamI.id);
  const rowLeadUser = await createUser("rowLeadUser", "RD");
  const rowMemberUser = await createUser("rowMemberUser", "RD");
  const rowOutsiderUser = await createUser("rowOutsiderUser", "RD");
  const rowPlainUser = await createUser("rowPlainUser", "PM");
  const rowSecTeamUser = await createUser("rowSecTeamUser", "資安推動小組");
  fx.userIds.push(rowLeadUser.id, rowMemberUser.id, rowOutsiderUser.id, rowPlainUser.id, rowSecTeamUser.id);
  await addTeamMember({ teamId: teamI.id, userId: rowLeadUser.id, actorId: admin.id, reasonCode: "TEST_JOIN" });
  await assignTeamLead({ teamId: teamI.id, userId: rowLeadUser.id, actorId: admin.id, reasonCode: "TEST_ASSIGN_LEAD" });
  await addTeamMember({ teamId: teamI.id, userId: rowMemberUser.id, actorId: admin.id, reasonCode: "TEST_JOIN" });

  await checkAsync("[R1] listPeopleForActor：Admin 可看見全部人員", async () => {
    const list = await listPeopleForActor(admin.id);
    return list.some((u) => u.id === rowOutsiderUser.id) && list.some((u) => u.id === rowPlainUser.id);
  });
  await checkAsync("[R2] listPeopleForActor：資安推動小組（user.view）可看見全部人員，但唯讀（無 user.assignRole 能力）", async () => {
    const list = await listPeopleForActor(rowSecTeamUser.id);
    const canSeeAll = list.some((u) => u.id === rowOutsiderUser.id);
    let writeDenied = false;
    try {
      await assignSystemRole({ userId: rowOutsiderUser.id, role: "QA", actorId: rowSecTeamUser.id, reasonCode: "TEST_SEC_TEAM_WRITE" });
    } catch (e) {
      writeDenied = e instanceof PeopleAccessDeniedError;
    }
    return canSeeAll && writeDenied;
  });
  await checkAsync("[R3] listPeopleForActor：Team LEAD 只看得到自己所屬（LEAD）Team 範圍內的成員", async () => {
    const list = await listPeopleForActor(rowLeadUser.id);
    const ids = new Set(list.map((u) => u.id));
    return ids.has(rowLeadUser.id) && ids.has(rowMemberUser.id) && !ids.has(rowOutsiderUser.id);
  });
  await expectError(
    "[R3b] getPersonDetailForActor：Team LEAD 查詢範圍外的人員遭拒絕",
    () => getPersonDetailForActor(rowLeadUser.id, rowOutsiderUser.id),
    (e) => e instanceof PeopleAccessDeniedError,
  );
  await checkAsync("[R4] listPeopleForActor：一般使用者只看得到自己", async () => {
    const list = await listPeopleForActor(rowPlainUser.id);
    return list.length === 1 && list[0].id === rowPlainUser.id;
  });
  await checkAsync("[R5] listTeamsForActor／getTeamDetailForActor：Admin 與 team.view 可見全部；一般使用者僅見自己所屬 Team", async () => {
    const adminTeams = await listTeamsForActor(admin.id);
    const secTeams = await listTeamsForActor(rowSecTeamUser.id);
    const plainTeams = await listTeamsForActor(rowPlainUser.id);
    const detail = await getTeamDetailForActor(admin.id, teamI.id);
    return (
      adminTeams.some((t) => t.id === teamI.id) &&
      secTeams.some((t) => t.id === teamI.id) &&
      plainTeams.length === 0 &&
      detail?.id === teamI.id
    );
  });
  await expectError(
    "[R5b] getTeamDetailForActor：非成員查詢無關 Team 遭拒絕",
    () => getTeamDetailForActor(rowPlainUser.id, teamI.id),
    (e) => e instanceof PeopleAccessDeniedError,
  );

  await expectError(
    "[R6] 非授權直接服務呼叫：一般使用者呼叫 assignSystemRole 遭拒絕（deny-by-default）",
    () => assignSystemRole({ userId: rowOutsiderUser.id, role: "QA", actorId: rowPlainUser.id, reasonCode: "TEST_UNAUTHORIZED" }),
    (e) => e instanceof PeopleAccessDeniedError,
  );
  await expectError(
    "[R6b] 非授權直接服務呼叫：一般使用者呼叫 addTeamMember 遭拒絕（deny-by-default）",
    () => addTeamMember({ teamId: teamI.id, userId: rowOutsiderUser.id, actorId: rowPlainUser.id, reasonCode: "TEST_UNAUTHORIZED" }),
    (e) => e instanceof PeopleAccessDeniedError,
  );
  await expectError(
    "[R6c] 非授權直接服務呼叫：一般使用者呼叫 deactivatePerson 遭拒絕（deny-by-default）",
    () => deactivatePerson({ userId: rowOutsiderUser.id, actorId: rowPlainUser.id, reasonCode: "TEST_UNAUTHORIZED" }),
    (e) => e instanceof PeopleAccessDeniedError,
  );
}

async function cleanupFixtures(fx: Fixtures) {
  try {
    // [D6]／[D6b] 測試隔離修復：還原測試前被暫時中性化的既存 isBreakGlassAdmin=true
    // 使用者（例如 admin@example.com），無論上方測試成功或中途拋錯都必須執行，
    // 不得讓既有 seed 資料的 isBreakGlassAdmin 標記永久遺失。
    if (fx.neutralizedBreakGlassAdminUserIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: fx.neutralizedBreakGlassAdminUserIds } },
        data: { isBreakGlassAdmin: true },
      });
    }
  } catch (e) {
    console.warn("cleanup 還原 isBreakGlassAdmin 失敗：", e);
  }
  try {
    // [P10]／[D5] 中性化還原：還原測試前被暫時中性化的既存 active Admin UserRole
    // （例如 admin@example.com 的 UserRole），確保執行前後基準 DB 的穩定資料不受影響。
    if (fx.neutralizedAdminUserRoleIds.length > 0) {
      await prisma.userRole.updateMany({
        where: { id: { in: fx.neutralizedAdminUserRoleIds } },
        data: { isActive: true },
      });
    }
  } catch (e) {
    console.warn("cleanup 還原 Admin UserRole 中性化失敗：", e);
  }
  try {
    await prisma.userRoleHistory.deleteMany({ where: { userId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup UserRoleHistory 失敗：", e);
  }
  try {
    await prisma.userRole.deleteMany({ where: { userId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup UserRole 失敗：", e);
  }
  for (const id of fx.approvalRecordIdsNewestFirst) {
    try {
      await prisma.approvalRecord.delete({ where: { id } });
    } catch (e) {
      console.warn(`cleanup ApprovalRecord ${id} 失敗：`, e);
    }
  }
  try {
    await prisma.approvalRecord.deleteMany({ where: { issueId: { in: fx.issueIds } } });
  } catch (e) {
    console.warn("cleanup 殘留 ApprovalRecord 失敗：", e);
  }
  try {
    await prisma.approvalDelegation.deleteMany({ where: { id: { in: fx.delegationIds } } });
  } catch (e) {
    console.warn("cleanup ApprovalDelegation 失敗：", e);
  }
  try {
    // C1-B3／C1-B4 新增：TeamMembershipHistory 對 TeamMember 為 onDelete: Restrict，
    // 必須先於 TeamMember 刪除。
    await prisma.teamMembershipHistory.deleteMany({ where: { teamId: { in: fx.teamIds } } });
  } catch (e) {
    console.warn("cleanup TeamMembershipHistory 失敗：", e);
  }
  try {
    await prisma.teamMember.deleteMany({ where: { teamId: { in: fx.teamIds } } });
  } catch (e) {
    console.warn("cleanup TeamMember 失敗：", e);
  }
  try {
    await prisma.userSupervisorAssignment.deleteMany({ where: { id: { in: fx.assignmentIds } } });
  } catch (e) {
    console.warn("cleanup UserSupervisorAssignment 失敗：", e);
  }
  try {
    await prisma.issue.deleteMany({ where: { id: { in: fx.issueIds } } });
  } catch (e) {
    console.warn("cleanup Issue 失敗：", e);
  }
  try {
    await prisma.team.deleteMany({ where: { id: { in: fx.teamIds } } });
  } catch (e) {
    console.warn("cleanup Team 失敗：", e);
  }
  try {
    // C1-B3／C1-B4 新增：本檔新增的 People／Team 測試會透過 peopleService／teamLeadService
    // 寫入 AuditLog（entityType User／UserRole／TeamMember），一律以 actorUserId 收斂清除。
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup AuditLog 失敗：", e);
  }
  try {
    // C1-B4 新增：User.disabledByUserId 為 self-relation（onDelete: Restrict），
    // deactivatePerson 會把它指向 actorId（通常也是 fx.userIds 內的測試使用者），刪除順序
    // 不保證安全，刪除前先整批清空，避免刪除順序造成 FK 違規。
    await prisma.user.updateMany({ where: { id: { in: fx.userIds } }, data: { disabledByUserId: null } });
  } catch (e) {
    console.warn("cleanup User.disabledByUserId 失敗：", e);
  }
  try {
    await prisma.user.deleteMany({ where: { id: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup User 失敗：", e);
  }
}

// C1-B2 情境 9：requireAdmin（src/lib/auth.ts）與 Nav 管理入口（src/components/Nav.tsx）
// 靜態原始碼檢查——Server Component／cookies() 需要真實 request 情境，本腳本無法直接呼叫
// requireAdmin()／render Nav()，改以靜態檢查確認兩者都已改用 admin.full Capability、
// 不再出現 `role === "Admin"`／`role !== "Admin"` 字串判斷；共用的 getUserHasCapability
// 函式行為則已由上方 [8a]-[8d] 實際呼叫驗證。不依賴資料庫，必定執行。
function runAuthSourceStaticChecks() {
  console.log("\n=== C1-B2 驗證：requireAdmin／Nav 管理入口改用 admin.full（靜態原始碼檢查，必定執行） ===");

  // 檢查對象是「實際程式碼」，逐行剔除 // 開頭的整行註解（本檔與這兩支檔案本身都可能在
  // 說明文字裡提到舊寫法），避免文件註解被誤判為仍存在的程式碼判斷式。
  const stripLineComments = (src: string) =>
    src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

  const authTsPath = path.resolve(__dirname, "..", "src", "lib", "auth.ts");
  const navTsxPath = path.resolve(__dirname, "..", "src", "components", "Nav.tsx");
  const authSrc = stripLineComments(fs.readFileSync(authTsPath, "utf8"));
  const navSrc = stripLineComments(fs.readFileSync(navTsxPath, "utf8"));

  check(
    '[9a] src/lib/auth.ts 不再出現 role === "Admin" 或 role !== "Admin" 字串判斷',
    !/role\s*===\s*"Admin"/.test(authSrc) && !/role\s*!==\s*"Admin"/.test(authSrc),
  );
  check(
    '[9b] src/components/Nav.tsx 不再出現 role === "Admin" 或 role !== "Admin" 字串判斷',
    !/role\s*===\s*"Admin"/.test(navSrc) && !/role\s*!==\s*"Admin"/.test(navSrc),
  );
  check(
    '[9c] src/lib/auth.ts requireAdmin 改用 getUserHasCapability(..., "admin.full")',
    /getUserHasCapability\([^)]*"admin\.full"\)/.test(authSrc),
  );
  check(
    '[9d] src/components/Nav.tsx 管理入口改用 getUserHasCapability(..., "admin.full")（與 requireAdmin 同一 Capability 來源）',
    /getUserHasCapability\([^)]*"admin\.full"\)/.test(navSrc),
  );
}

async function main() {
  console.log("=== M1.5-C1-B 驗證：C1-B1（inactive candidate 過濾）＋ C1-B2（Active UserRole 授權來源切換） ===");

  runAuthSourceStaticChecks();

  console.log("\n=== 資料庫相依檢查（需 Migration 已套用；未套用時 SKIPPED，不嘗試自動套用） ===");

  let migrationApplied = false;
  try {
    await prisma.approvalRecord.count();
    migrationApplied = true;
  } catch {
    migrationApplied = false;
  }

  if (!migrationApplied) {
    skip(
      "核准資格解析排除 inactive User（C1-B1）＋ Active UserRole 授權來源切換（C1-B2）DB 相依實測",
      "資料表尚未建立，等待 Migration 套用至測試資料庫後才能驗證，本輪不對任何資料庫套用 Migration",
    );
  } else {
    const fx: Fixtures = {
      userIds: [],
      teamIds: [],
      issueIds: [],
      assignmentIds: [],
      delegationIds: [],
      approvalRecordIdsNewestFirst: [],
      neutralizedBreakGlassAdminUserIds: [],
      neutralizedAdminUserRoleIds: [],
    };
    try {
      await runDbDependentTests(fx);
      await runPeopleServiceTests(fx);
    } finally {
      await cleanupFixtures(fx);
    }
  }

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  await prisma.$disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("m1_5_c1_b-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
