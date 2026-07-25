// M1.5-B1 驗證腳本
//
// 目的：驗證 M1.5-B1 核准治理設定服務層（主管指派／Team LEAD／核准代理／健康檢查）
// 的邏輯正確性，並在 Migration 已套用的資料庫上（僅限測試資料庫，例如
// prisma/dev-m1-5b-test.db）實測服務層信任邊界、row-level 授權與 DB 約束。
//
// - 純邏輯測試（permissions.ts 新增函式）：不依賴資料庫，必定執行。
// - DB 相依測試：若治理資料表尚未建立，標記為 SKIPPED，不視為失敗，也不會嘗試自動
//   套用 Migration。若資料表已存在，建立臨時測試資料（獨立 email/id，不觸碰既有
//   User／Issue／Team 業務資料），測試結束後於 finally 區塊清除。
//
// 執行方式：
//   node_modules/.bin/tsx scripts/m1_5b-verify.ts                                     （對 .env 指定的資料庫，DB 區塊通常 SKIP）
//   DATABASE_URL="file:./dev-m1-5b-test.db" node_modules/.bin/tsx scripts/m1_5b-verify.ts （對測試資料庫，Migration 套用後 DB 區塊應完整執行）

import {
  findSupervisorCyclesByTimeWindow,
  wouldCreateSupervisorCycleInWindow,
  isCurrentPrimarySupervisorOfAnyone,
} from "../src/lib/permissions";
import {
  createSupervisorAssignment,
  endSupervisorAssignment,
  cancelScheduledSupervisorAssignment,
  replaceSupervisorAssignment,
  listSupervisorHistory,
  listCurrentSupervisors,
  GovernanceValidationError,
  GovernanceNotFoundError,
  GovernanceStateError,
  GovernanceAccessDeniedError,
} from "../src/lib/supervisorAssignmentService";
import { assignTeamLead, removeTeamLead, listTeamLeads, listTeamsWithoutLead } from "../src/lib/teamLeadService";
import {
  createApprovalDelegation,
  revokeApprovalDelegation,
  listDelegations,
  delegatorHasOriginalAuthority,
} from "../src/lib/approvalDelegationService";
import { getApprovalGovernanceHealth } from "../src/lib/approvalGovernanceHealthService";
import { prisma } from "../src/lib/prisma";

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
    console.log(`  FAIL  ${name} (未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)})`);
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
  console.log(`  SKIP  ${name} (${reason})`);
}

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-07-25T00:00:00.000Z");

// ---------------------------------------------------------------------------
// 純邏輯測試（永遠執行）
// ---------------------------------------------------------------------------

function runPureLogicTests() {
  console.log("=== M1.5-B1 驗證：findSupervisorCyclesByTimeWindow（純邏輯） ===");

  const D0 = new Date("2026-01-01T00:00:00.000Z");
  const D1 = new Date("2026-02-01T00:00:00.000Z");
  const D2 = new Date("2026-03-01T00:00:00.000Z");

  // 單一無邊界區段內的簡單雙人環
  const simpleCycleAssignments = [
    { id: "a1", userId: "a", supervisorUserId: "b", validFrom: D0, validUntil: null, isPrimary: true, isActive: true },
    { id: "a2", userId: "b", supervisorUserId: "a", validFrom: D0, validUntil: null, isPrimary: true, isActive: true },
  ];
  const simpleResult = findSupervisorCyclesByTimeWindow(simpleCycleAssignments);
  check(
    "findSupervisorCyclesByTimeWindow：簡單雙人環正確偵測，overlapFrom=D0、overlapUntil=null",
    simpleResult.length === 1 &&
      simpleResult[0].userIds.length === 2 &&
      simpleResult[0].userIds.includes("a") &&
      simpleResult[0].userIds.includes("b") &&
      simpleResult[0].overlapFrom.getTime() === D0.getTime() &&
      simpleResult[0].overlapUntil === null,
  );

  const chainNoCycleAssignments = [
    { id: "b1", userId: "a", supervisorUserId: "b", validFrom: D0, validUntil: null, isPrimary: true, isActive: true },
    { id: "b2", userId: "b", supervisorUserId: "c", validFrom: D0, validUntil: null, isPrimary: true, isActive: true },
  ];
  check(
    "findSupervisorCyclesByTimeWindow：鏈狀但未成環時回傳空陣列",
    findSupervisorCyclesByTimeWindow(chainNoCycleAssignments).length === 0,
  );

  check(
    "findSupervisorCyclesByTimeWindow：只看 isPrimary && isActive，非 primary 或已停用的邊不構成環",
    findSupervisorCyclesByTimeWindow([
      { id: "c1", userId: "a", supervisorUserId: "b", validFrom: D0, validUntil: null, isPrimary: false, isActive: true },
      { id: "c2", userId: "b", supervisorUserId: "a", validFrom: D0, validUntil: null, isPrimary: true, isActive: false },
    ]).length === 0,
  );

  // 關鍵測試：第一段有環、中間有落差沒有環、後段又有環 → 必須是兩筆獨立 finding，不得合併
  const gapAssignments = [
    { id: "g1", userId: "x", supervisorUserId: "y", validFrom: D0, validUntil: D1, isPrimary: true, isActive: true },
    { id: "g2", userId: "y", supervisorUserId: "x", validFrom: D0, validUntil: D1, isPrimary: true, isActive: true },
    { id: "g3", userId: "x", supervisorUserId: "y", validFrom: D2, validUntil: null, isPrimary: true, isActive: true },
    { id: "g4", userId: "y", supervisorUserId: "x", validFrom: D2, validUntil: null, isPrimary: true, isActive: true },
  ];
  const gapResult = findSupervisorCyclesByTimeWindow(gapAssignments);
  check(
    "findSupervisorCyclesByTimeWindow：中間有落差時回傳兩筆獨立 finding，不得合併成單一涵蓋空隙的區間",
    gapResult.length === 2,
  );
  const sortedByStart = [...gapResult].sort((a, b) => a.overlapFrom.getTime() - b.overlapFrom.getTime());
  check(
    "findSupervisorCyclesByTimeWindow：第一筆 finding 為 [D0,D1)，第二筆為 [D2,∞)，中間空窗未被誤標異常",
    sortedByStart.length === 2 &&
      sortedByStart[0].overlapFrom.getTime() === D0.getTime() &&
      sortedByStart[0].overlapUntil !== null &&
      sortedByStart[0].overlapUntil!.getTime() === D1.getTime() &&
      sortedByStart[1].overlapFrom.getTime() === D2.getTime() &&
      sortedByStart[1].overlapUntil === null,
  );

  // 跨相鄰、無落差的區段應合併成一筆
  const adjacentAssignments = [
    { id: "h1", userId: "p", supervisorUserId: "q", validFrom: D0, validUntil: D1, isPrimary: true, isActive: true },
    { id: "h2", userId: "q", supervisorUserId: "p", validFrom: D0, validUntil: null, isPrimary: true, isActive: true },
    { id: "h3", userId: "p", supervisorUserId: "q", validFrom: D1, validUntil: null, isPrimary: true, isActive: true },
  ];
  const adjacentResult = findSupervisorCyclesByTimeWindow(adjacentAssignments);
  check(
    "findSupervisorCyclesByTimeWindow：跨相鄰、無落差的區段合併成一筆 finding（overlapUntil=null）",
    adjacentResult.length === 1 && adjacentResult[0].overlapFrom.getTime() === D0.getTime() && adjacentResult[0].overlapUntil === null,
  );

  console.log("\n=== M1.5-B1 驗證：wouldCreateSupervisorCycleInWindow（純邏輯） ===");

  const existingChain = [
    { id: "i1", userId: "u1", supervisorUserId: "u2", validFrom: D0, validUntil: null, isPrimary: true, isActive: true },
  ];
  check(
    "wouldCreateSupervisorCycleInWindow：新增 u2→u1 會與既有 u1→u2 形成環，應阻擋",
    wouldCreateSupervisorCycleInWindow(existingChain, { userId: "u2", supervisorUserId: "u1", validFrom: D0, validUntil: null }),
  );
  check(
    "wouldCreateSupervisorCycleInWindow：新增 u2→u3（不涉及既有鏈）不形成環，不應阻擋",
    !wouldCreateSupervisorCycleInWindow(existingChain, { userId: "u2", supervisorUserId: "u3", validFrom: D0, validUntil: null }),
  );
  check(
    "wouldCreateSupervisorCycleInWindow：自己指派自己恆視為循環",
    wouldCreateSupervisorCycleInWindow(existingChain, { userId: "u9", supervisorUserId: "u9", validFrom: D0, validUntil: null }),
  );

  // 既有資料本身已有一個無關的舊循環，新增一筆不參與該循環的邊不應被誤擋
  const preExistingUnrelatedCycle = [
    { id: "j1", userId: "m", supervisorUserId: "n", validFrom: D0, validUntil: null, isPrimary: true, isActive: true },
    { id: "j2", userId: "n", supervisorUserId: "m", validFrom: D0, validUntil: null, isPrimary: true, isActive: true },
  ];
  check(
    "wouldCreateSupervisorCycleInWindow：既有無關的舊循環不得誤擋新增的不相關邊",
    !wouldCreateSupervisorCycleInWindow(preExistingUnrelatedCycle, { userId: "p", supervisorUserId: "q", validFrom: D0, validUntil: null }),
  );
  // 未來排程才成環的情境
  const futureOnly = [
    { id: "k1", userId: "r", supervisorUserId: "s", validFrom: new Date(now.getTime() + 30 * DAY), validUntil: null, isPrimary: true, isActive: true },
  ];
  check(
    "wouldCreateSupervisorCycleInWindow：未來才生效的提案若與既有未來排程同時重疊成環，仍應阻擋",
    wouldCreateSupervisorCycleInWindow(futureOnly, {
      userId: "s",
      supervisorUserId: "r",
      validFrom: new Date(now.getTime() + 30 * DAY),
      validUntil: null,
    }),
  );

  console.log("\n=== M1.5-B1 驗證：isCurrentPrimarySupervisorOfAnyone（純邏輯） ===");

  const supervisorAssignments = [
    { id: "l1", userId: "emp1", supervisorUserId: "sup1", validFrom: new Date(now.getTime() - DAY), validUntil: null, isPrimary: true, isActive: true },
  ];
  check("isCurrentPrimarySupervisorOfAnyone：目前是有效 primary 主管時回傳 true", isCurrentPrimarySupervisorOfAnyone(supervisorAssignments, "sup1", now));
  check("isCurrentPrimarySupervisorOfAnyone：非 primary 不算", !isCurrentPrimarySupervisorOfAnyone([{ ...supervisorAssignments[0], isPrimary: false }], "sup1", now));
  check(
    "isCurrentPrimarySupervisorOfAnyone：已過期不算",
    !isCurrentPrimarySupervisorOfAnyone([{ ...supervisorAssignments[0], validUntil: new Date(now.getTime() - DAY) }], "sup1", now),
  );
  check("isCurrentPrimarySupervisorOfAnyone：不相關的 userId 回傳 false", !isCurrentPrimarySupervisorOfAnyone(supervisorAssignments, "someone-else", now));
}

// ---------------------------------------------------------------------------
// DB 相依測試
// ---------------------------------------------------------------------------

const RUN_TAG = `m15bv${Date.now()}`;

interface Fixtures {
  userIds: string[];
  teamIds: string[];
  assignmentIds: string[];
  delegationIds: string[];
}

async function createUser(name: string, role: string, isActive = true) {
  return prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive } });
}

async function runDbDependentTests(fx: Fixtures) {
  // --- 使用者 fixtures ---
  const reporterA = await createUser("reporterA", "PM");
  const reporterB = await createUser("reporterB", "PM");
  const reporterC = await createUser("reporterC", "PM");
  const supervisorX = await createUser("supervisorX", "DMS主管");
  const supervisorY = await createUser("supervisorY", "DMS主管");
  const adminUser = await createUser("adminUser", "Admin");
  const secTeamUser = await createUser("secTeamUser", "資安推動小組");
  const leadAlpha1 = await createUser("leadAlpha1", "RD");
  const leadAlpha2 = await createUser("leadAlpha2", "RD");
  const memberAlpha = await createUser("memberAlpha", "RD");
  const delegateA = await createUser("delegateA", "PM");
  const outsider = await createUser("outsider", "PM");
  const inactiveUser = await createUser("inactiveUser", "PM", false);
  fx.userIds.push(
    reporterA.id,
    reporterB.id,
    reporterC.id,
    supervisorX.id,
    supervisorY.id,
    adminUser.id,
    secTeamUser.id,
    leadAlpha1.id,
    leadAlpha2.id,
    memberAlpha.id,
    delegateA.id,
    outsider.id,
    inactiveUser.id,
  );

  // --- Team fixtures ---
  const teamAlpha = await prisma.team.create({ data: { name: `${RUN_TAG}-team-alpha` } });
  const teamBeta = await prisma.team.create({ data: { name: `${RUN_TAG}-team-beta` } }); // 空 Team：無成員
  const teamGamma = await prisma.team.create({ data: { name: `${RUN_TAG}-team-gamma` } }); // 有成員但無 LEAD
  fx.teamIds.push(teamAlpha.id, teamBeta.id, teamGamma.id);
  await prisma.teamMember.create({ data: { teamId: teamAlpha.id, userId: leadAlpha1.id, membershipRole: "LEAD" } });
  await prisma.teamMember.create({ data: { teamId: teamAlpha.id, userId: leadAlpha2.id, membershipRole: "MEMBER" } }); // 尚未升級為 LEAD
  await prisma.teamMember.create({ data: { teamId: teamAlpha.id, userId: memberAlpha.id, membershipRole: "MEMBER" } });
  await prisma.teamMember.create({ data: { teamId: teamGamma.id, userId: memberAlpha.id, membershipRole: "MEMBER" } });

  console.log("\n=== M1.5-B1 驗證：新表可查詢 ===");
  check("UserSupervisorAssignment 可查詢", (await prisma.userSupervisorAssignment.count()) >= 0);
  check("ApprovalDelegation 可查詢", (await prisma.approvalDelegation.count()) >= 0);

  // =========================================================================
  // 主管指派
  // =========================================================================
  console.log("\n=== M1.5-B1 驗證：createSupervisorAssignment ===");

  await expectError(
    "createSupervisorAssignment：一般使用者（非 Admin）呼叫被拒",
    () =>
      createSupervisorAssignment({
        userId: reporterA.id,
        supervisorUserId: supervisorX.id,
        validFrom: new Date(now.getTime() - DAY),
        actorId: reporterA.id,
        reasonCode: "test",
      }),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await expectError(
    "createSupervisorAssignment：資安推動小組呼叫被拒（角色本身不構成管理權）",
    () =>
      createSupervisorAssignment({
        userId: reporterA.id,
        supervisorUserId: supervisorX.id,
        validFrom: new Date(now.getTime() - DAY),
        actorId: secTeamUser.id,
        reasonCode: "test",
      }),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await expectError(
    "createSupervisorAssignment：reasonCode 空白時被拒（Admin-only 操作一律必填）",
    () =>
      createSupervisorAssignment({
        userId: reporterA.id,
        supervisorUserId: supervisorX.id,
        validFrom: new Date(now.getTime() - DAY),
        actorId: adminUser.id,
        reasonCode: "  ",
      }),
    (e) => e instanceof GovernanceValidationError,
  );
  await expectError(
    "createSupervisorAssignment：自己指派自己被拒",
    () =>
      createSupervisorAssignment({
        userId: reporterA.id,
        supervisorUserId: reporterA.id,
        validFrom: new Date(now.getTime() - DAY),
        actorId: adminUser.id,
        reasonCode: "test",
      }),
    (e) => e instanceof GovernanceValidationError,
  );

  const assignment1 = await createSupervisorAssignment({
    userId: reporterA.id,
    supervisorUserId: supervisorX.id,
    validFrom: new Date(now.getTime() - 30 * DAY),
    actorId: adminUser.id,
    reasonCode: "初始指派",
  });
  fx.assignmentIds.push(assignment1.id);
  check(
    "createSupervisorAssignment：成功建立，isPrimary 預設 true、isActive true",
    assignment1.isPrimary === true && assignment1.isActive === true && assignment1.supervisorUserId === supervisorX.id,
  );

  await expectError(
    "createSupervisorAssignment：同一使用者重疊的 primary 指派被拒（含涵蓋既有整段）",
    () =>
      createSupervisorAssignment({
        userId: reporterA.id,
        supervisorUserId: supervisorY.id,
        validFrom: new Date(now.getTime() - 40 * DAY),
        actorId: adminUser.id,
        reasonCode: "test",
      }),
    (e) => e instanceof GovernanceStateError,
  );

  // 純未來排定，彼此重疊
  const futureA = new Date(now.getTime() + 60 * DAY);
  const futureB = new Date(now.getTime() + 90 * DAY);
  const scheduled1 = await createSupervisorAssignment({
    userId: reporterB.id,
    supervisorUserId: supervisorX.id,
    validFrom: futureA,
    validUntil: futureB,
    actorId: adminUser.id,
    reasonCode: "排定未來",
  });
  fx.assignmentIds.push(scheduled1.id);
  await expectError(
    "createSupervisorAssignment：兩筆純未來排程互相重疊時被拒",
    () =>
      createSupervisorAssignment({
        userId: reporterB.id,
        supervisorUserId: supervisorY.id,
        validFrom: new Date(futureA.getTime() + 10 * DAY),
        validUntil: new Date(futureB.getTime() + 10 * DAY),
        actorId: adminUser.id,
        reasonCode: "test",
      }),
    (e) => e instanceof GovernanceStateError,
  );

  // 循環：reporterA 目前主管是 supervisorX；若指派 supervisorX 的主管為 reporterA 會成環
  await expectError(
    "createSupervisorAssignment：會形成主管循環時被拒",
    () =>
      createSupervisorAssignment({
        userId: supervisorX.id,
        supervisorUserId: reporterA.id,
        validFrom: new Date(now.getTime() - 30 * DAY),
        actorId: adminUser.id,
        reasonCode: "test",
      }),
    (e) => e instanceof GovernanceStateError,
  );

  console.log("\n=== M1.5-B1 驗證：endSupervisorAssignment ===");

  await expectError(
    "endSupervisorAssignment：尚未生效的指派不得終止（須用取消排程）",
    () =>
      endSupervisorAssignment({
        assignmentId: scheduled1.id,
        endAt: new Date(futureA.getTime() + DAY),
        actorId: adminUser.id,
        reasonCode: "test",
        now,
      }),
    (e) => e instanceof GovernanceStateError,
  );

  const endAt1 = new Date(now.getTime() - DAY);
  const ended1 = await endSupervisorAssignment({
    assignmentId: assignment1.id,
    endAt: endAt1,
    actorId: adminUser.id,
    reasonCode: "更換主管",
    now,
  });
  check("endSupervisorAssignment：成功終止已生效指派，validUntil 設定正確", ended1.validUntil?.getTime() === endAt1.getTime());
  await checkAsync("endSupervisorAssignment：歷史紀錄仍查得到（未刪除）", async () => {
    const row = await prisma.userSupervisorAssignment.findUnique({ where: { id: assignment1.id } });
    return row !== null && row.isActive === true;
  });

  console.log("\n=== M1.5-B1 驗證：cancelScheduledSupervisorAssignment ===");

  await expectError(
    "cancelScheduledSupervisorAssignment：已生效的指派不得取消",
    () =>
      cancelScheduledSupervisorAssignment({
        assignmentId: assignment1.id,
        actorId: adminUser.id,
        reasonCode: "test",
        now,
      }),
    (e) => e instanceof GovernanceStateError,
  );

  const scheduled2 = await createSupervisorAssignment({
    userId: reporterA.id,
    supervisorUserId: supervisorY.id,
    validFrom: new Date(now.getTime() + 10 * DAY),
    actorId: adminUser.id,
    reasonCode: "排定新主管",
  });
  fx.assignmentIds.push(scheduled2.id);
  const cancelled = await cancelScheduledSupervisorAssignment({
    assignmentId: scheduled2.id,
    actorId: adminUser.id,
    reasonCode: "計畫變更",
    now,
  });
  check("cancelScheduledSupervisorAssignment：成功取消，isActive=false", cancelled.isActive === false);
  check("cancelScheduledSupervisorAssignment：不改動 validFrom/validUntil", cancelled.validFrom.getTime() === scheduled2.validFrom.getTime());

  console.log("\n=== M1.5-B1 驗證：replaceSupervisorAssignment（區分已生效/未生效＋transaction 完整性） ===");

  // 情況 A：已生效指派 → 半開無縫交接（用 reporterC，避免與 reporterB 既有的未來排程 scheduled1 重疊）
  const currentAssign = await createSupervisorAssignment({
    userId: reporterC.id,
    supervisorUserId: supervisorX.id,
    validFrom: new Date(now.getTime() - 5 * DAY),
    actorId: adminUser.id,
    reasonCode: "現職主管",
  });
  fx.assignmentIds.push(currentAssign.id);
  const replaceEffectiveAt = new Date(now.getTime() + 3 * DAY);
  const replaced = await replaceSupervisorAssignment({
    oldAssignmentId: currentAssign.id,
    newSupervisorUserId: supervisorY.id,
    effectiveAt: replaceEffectiveAt,
    actorId: adminUser.id,
    reasonCode: "調整組織",
    now,
  });
  fx.assignmentIds.push(replaced.id);
  await checkAsync("replaceSupervisorAssignment（已生效分支）：舊指派 validUntil 設為 effectiveAt", async () => {
    const old = await prisma.userSupervisorAssignment.findUnique({ where: { id: currentAssign.id } });
    return old?.validUntil?.getTime() === replaceEffectiveAt.getTime() && old.isActive === true;
  });
  check("replaceSupervisorAssignment（已生效分支）：新指派 validFrom=effectiveAt", replaced.validFrom.getTime() === replaceEffectiveAt.getTime());
  await checkAsync("replaceSupervisorAssignment（已生效分支）：兩筆 AuditLog（Ended＋Created）使用同一 reasonCode", async () => {
    // 注意：currentAssign 本身建立時也會有一筆 SupervisorAssignmentCreated（reasonCode="現職主管"），
    // 這裡只看 replace 這次操作實際新寫入的兩筆（Ended 於 currentAssign／Created 於 replaced）。
    const endedLog = await prisma.auditLog.findFirst({
      where: { entityId: currentAssign.id, entityType: "UserSupervisorAssignment", actionType: "SupervisorAssignmentEnded" },
    });
    const createdLog = await prisma.auditLog.findFirst({
      where: { entityId: replaced.id, entityType: "UserSupervisorAssignment", actionType: "SupervisorAssignmentCreated" },
    });
    return endedLog?.reasonCode === "調整組織" && createdLog?.reasonCode === "調整組織";
  });

  // 情況 B：尚未生效指派 → 取消排程 + 新建，且不得把舊 validUntil 設成 <= validFrom
  const scheduledOld = await createSupervisorAssignment({
    userId: outsider.id,
    supervisorUserId: supervisorX.id,
    validFrom: new Date(now.getTime() + 20 * DAY),
    actorId: adminUser.id,
    reasonCode: "先排定",
  });
  fx.assignmentIds.push(scheduledOld.id);
  const replaceEffectiveAt2 = new Date(now.getTime() + 25 * DAY);
  const replaced2 = await replaceSupervisorAssignment({
    oldAssignmentId: scheduledOld.id,
    newSupervisorUserId: supervisorY.id,
    effectiveAt: replaceEffectiveAt2,
    actorId: adminUser.id,
    reasonCode: "改派",
    now,
  });
  fx.assignmentIds.push(replaced2.id);
  await checkAsync("replaceSupervisorAssignment（未生效分支）：舊指派 isActive=false（取消排程，非設定 validUntil）", async () => {
    const old = await prisma.userSupervisorAssignment.findUnique({ where: { id: scheduledOld.id } });
    return old?.isActive === false && old.validUntil === null;
  });
  check("replaceSupervisorAssignment（未生效分支）：新指派 validFrom=effectiveAt", replaced2.validFrom.getTime() === replaceEffectiveAt2.getTime());

  // Transaction 完整性：新指派建立失敗時，舊指派的終止/取消必須一併 rollback，AuditLog 也不得殘留
  const rollbackTarget = await createSupervisorAssignment({
    userId: memberAlpha.id,
    supervisorUserId: supervisorX.id,
    validFrom: new Date(now.getTime() - 2 * DAY),
    actorId: adminUser.id,
    reasonCode: "待替換",
  });
  fx.assignmentIds.push(rollbackTarget.id);
  await expectError(
    "replaceSupervisorAssignment：新指派驗證失敗（自我指派）時整個 transaction rollback",
    () =>
      replaceSupervisorAssignment({
        oldAssignmentId: rollbackTarget.id,
        newSupervisorUserId: memberAlpha.id, // 與 userId 相同 → createSupervisorAssignmentTx 會拒絕
        effectiveAt: new Date(now.getTime() + DAY),
        actorId: adminUser.id,
        reasonCode: "test",
        now,
      }),
    (e) => e instanceof GovernanceValidationError,
  );
  await checkAsync("replaceSupervisorAssignment rollback：舊指派完全未被改動（validUntil 仍為 null、isActive 仍為 true）", async () => {
    const old = await prisma.userSupervisorAssignment.findUnique({ where: { id: rollbackTarget.id } });
    return old?.validUntil === null && old.isActive === true;
  });
  await checkAsync("replaceSupervisorAssignment rollback：沒有殘留任何新的 AuditLog（transaction 內的稽核紀錄也一併回滾）", async () => {
    const logs = await prisma.auditLog.findMany({ where: { entityId: rollbackTarget.id, entityType: "UserSupervisorAssignment" } });
    return logs.length === 1 && logs[0].actionType === "SupervisorAssignmentCreated";
  });
  await checkAsync("replaceSupervisorAssignment rollback：沒有建立任何新指派紀錄", async () => {
    const count = await prisma.userSupervisorAssignment.count({ where: { userId: memberAlpha.id, supervisorUserId: memberAlpha.id } });
    return count === 0;
  });

  // =========================================================================
  // Row-level authorization：主管查詢
  // =========================================================================
  console.log("\n=== M1.5-B1 驗證：listSupervisorHistory／listCurrentSupervisors row-level authorization ===");

  await expectError(
    "listSupervisorHistory：一般使用者查他人歷史被拒",
    () => listSupervisorHistory(reporterA.id, reporterB.id),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await checkAsync("listSupervisorHistory：一般使用者查自己成功", async () => {
    const rows = await listSupervisorHistory(reporterA.id, reporterA.id);
    return Array.isArray(rows) && rows.length > 0;
  });
  await checkAsync("listSupervisorHistory：Admin 查他人成功（canViewAllGovernance）", async () => {
    const rows = await listSupervisorHistory(adminUser.id, reporterA.id);
    return Array.isArray(rows) && rows.length > 0;
  });

  await checkAsync("listCurrentSupervisors：一般使用者只回自己一筆", async () => {
    const rows = await listCurrentSupervisors(reporterA.id, now);
    return rows.length === 1 && rows[0].userId === reporterA.id;
  });
  await checkAsync("listCurrentSupervisors：Admin 回全部使用者", async () => {
    const rows = await listCurrentSupervisors(adminUser.id, now);
    return rows.length >= fx.userIds.length;
  });
  await checkAsync("listCurrentSupervisors：資安推動小組回全部使用者（canViewAllGovernance）", async () => {
    const rows = await listCurrentSupervisors(secTeamUser.id, now);
    return rows.length >= fx.userIds.length;
  });

  // =========================================================================
  // Team LEAD
  // =========================================================================
  console.log("\n=== M1.5-B1 驗證：assignTeamLead／removeTeamLead ===");

  await expectError(
    "assignTeamLead：一般使用者呼叫被拒",
    () => assignTeamLead({ teamId: teamAlpha.id, userId: leadAlpha2.id, actorId: memberAlpha.id, reasonCode: "test" }),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await expectError(
    "assignTeamLead：目標非該 Team 啟用中成員時被拒（不會順便建立成員關係）",
    () => assignTeamLead({ teamId: teamAlpha.id, userId: outsider.id, actorId: adminUser.id, reasonCode: "test" }),
    (e) => e instanceof GovernanceStateError,
  );

  const leadAssign = await assignTeamLead({ teamId: teamAlpha.id, userId: leadAlpha2.id, actorId: adminUser.id, reasonCode: "擴編 LEAD" });
  check("assignTeamLead：成功將既有成員升級為 LEAD", leadAssign.membershipRole === "LEAD");
  await checkAsync("assignTeamLead：同一 Team 允許多位 LEAD（leadAlpha1 與 leadAlpha2 皆為 LEAD）", async () => {
    const leads = await prisma.teamMember.findMany({ where: { teamId: teamAlpha.id, membershipRole: "LEAD", isActive: true } });
    return leads.length === 2;
  });

  await expectError(
    "assignTeamLead：已是 LEAD 時重複設定被拒",
    () => assignTeamLead({ teamId: teamAlpha.id, userId: leadAlpha1.id, actorId: adminUser.id, reasonCode: "test" }),
    (e) => e instanceof GovernanceStateError,
  );

  const leadRemoved = await removeTeamLead({ teamId: teamAlpha.id, userId: leadAlpha2.id, actorId: adminUser.id, reasonCode: "調整" });
  check("removeTeamLead：成功降級為 MEMBER（未刪除成員關係）", leadRemoved.membershipRole === "MEMBER");
  await checkAsync("removeTeamLead：成員關係仍存在", async () => {
    const row = await prisma.teamMember.findUnique({ where: { id: leadRemoved.id } });
    return row !== null && row.isActive === true;
  });

  console.log("\n=== M1.5-B1 驗證：listTeamLeads／listTeamsWithoutLead row-level authorization ===");

  await expectError(
    "listTeamLeads：一般使用者查非自己所屬 Team 被拒",
    () => listTeamLeads(outsider.id, teamAlpha.id),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await checkAsync("listTeamLeads：Team 成員可查自己所屬 Team 的 LEAD", async () => {
    const rows = await listTeamLeads(memberAlpha.id, teamAlpha.id);
    return rows.length === 1 && rows[0].userId === leadAlpha1.id;
  });
  await checkAsync("listTeamLeads：Admin 查全部", async () => {
    const rows = await listTeamLeads(adminUser.id);
    return rows.some((r) => r.userId === leadAlpha1.id);
  });

  await expectError(
    "listTeamsWithoutLead：一般使用者被拒（整體治理視角，非個人資料）",
    () => listTeamsWithoutLead(memberAlpha.id),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await expectError(
    "listTeamsWithoutLead：Team LEAD 本人也被拒",
    () => listTeamsWithoutLead(leadAlpha1.id),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await checkAsync("listTeamsWithoutLead：Admin 成功，teamBeta／teamGamma 皆在無 LEAD 清單中", async () => {
    const teams = await listTeamsWithoutLead(adminUser.id);
    const ids = teams.map((t) => t.id);
    return ids.includes(teamBeta.id) && ids.includes(teamGamma.id) && !ids.includes(teamAlpha.id);
  });

  // =========================================================================
  // 核准代理
  // =========================================================================
  console.log("\n=== M1.5-B1 驗證：delegatorHasOriginalAuthority ===");

  await checkAsync("delegatorHasOriginalAuthority：BUSINESS_APPROVAL，delegator 目前確實是主管時回傳 true", () =>
    prisma.$transaction((tx) =>
      delegatorHasOriginalAuthority(tx, { approvalType: "BUSINESS_APPROVAL", teamId: null, delegatorUserId: supervisorX.id, now }),
    ),
  );
  await checkAsync("delegatorHasOriginalAuthority：BUSINESS_APPROVAL，delegator 不是任何人的主管時回傳 false", () =>
    prisma
      .$transaction((tx) =>
        delegatorHasOriginalAuthority(tx, { approvalType: "BUSINESS_APPROVAL", teamId: null, delegatorUserId: outsider.id, now }),
      )
      .then((r) => !r),
  );
  await checkAsync("delegatorHasOriginalAuthority：技術類型，delegator 目前是該 Team 的 LEAD 時回傳 true", () =>
    prisma.$transaction((tx) =>
      delegatorHasOriginalAuthority(tx, { approvalType: "RD_LEAD_APPROVAL", teamId: teamAlpha.id, delegatorUserId: leadAlpha1.id, now }),
    ),
  );
  await checkAsync("delegatorHasOriginalAuthority：技術類型，delegator 不是該 Team 的 LEAD 時回傳 false", () =>
    prisma
      .$transaction((tx) =>
        delegatorHasOriginalAuthority(tx, { approvalType: "RD_LEAD_APPROVAL", teamId: teamAlpha.id, delegatorUserId: memberAlpha.id, now }),
      )
      .then((r) => !r),
  );

  console.log("\n=== M1.5-B1 驗證：createApprovalDelegation ===");

  await expectError(
    "createApprovalDelegation：delegator 目前不具備原始資格時被拒（含 Admin 代建也擋）",
    () =>
      createApprovalDelegation({
        delegatorUserId: outsider.id,
        delegateUserId: delegateA.id,
        approvalType: "BUSINESS_APPROVAL",
        validFrom: new Date(now.getTime() - DAY),
        validUntil: new Date(now.getTime() + 30 * DAY),
        actorId: adminUser.id,
        reasonCode: "Admin 代建",
      }),
    (e) => e instanceof GovernanceStateError,
  );
  await expectError(
    "createApprovalDelegation：一般使用者代他人建立（非自己是 delegator）被拒",
    () =>
      createApprovalDelegation({
        delegatorUserId: supervisorX.id,
        delegateUserId: delegateA.id,
        approvalType: "BUSINESS_APPROVAL",
        validFrom: new Date(now.getTime() - DAY),
        validUntil: new Date(now.getTime() + 30 * DAY),
        actorId: outsider.id,
        reasonCode: null,
      }),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await expectError(
    "createApprovalDelegation：Admin 代他人建立但 reasonCode 空白時被拒",
    () =>
      createApprovalDelegation({
        delegatorUserId: supervisorX.id,
        delegateUserId: delegateA.id,
        approvalType: "BUSINESS_APPROVAL",
        validFrom: new Date(now.getTime() - DAY),
        validUntil: new Date(now.getTime() + 30 * DAY),
        actorId: adminUser.id,
        reasonCode: null,
      }),
    (e) => e instanceof GovernanceValidationError,
  );
  await expectError(
    "createApprovalDelegation：不得自行代理給自己",
    () =>
      createApprovalDelegation({
        delegatorUserId: supervisorX.id,
        delegateUserId: supervisorX.id,
        approvalType: "BUSINESS_APPROVAL",
        validFrom: new Date(now.getTime() - DAY),
        validUntil: new Date(now.getTime() + 30 * DAY),
        actorId: supervisorX.id,
      }),
    (e) => e instanceof GovernanceValidationError,
  );
  await expectError(
    "createApprovalDelegation：技術核准代理未指定 teamId 時被拒",
    () =>
      createApprovalDelegation({
        delegatorUserId: leadAlpha1.id,
        delegateUserId: delegateA.id,
        approvalType: "RD_LEAD_APPROVAL",
        teamId: null,
        validFrom: new Date(now.getTime() - DAY),
        validUntil: new Date(now.getTime() + 30 * DAY),
        actorId: leadAlpha1.id,
      }),
    (e) => e instanceof GovernanceValidationError,
  );

  const businessDelegation = await createApprovalDelegation({
    delegatorUserId: supervisorX.id,
    delegateUserId: delegateA.id,
    approvalType: "BUSINESS_APPROVAL",
    validFrom: new Date(now.getTime() - DAY),
    validUntil: new Date(now.getTime() + 30 * DAY),
    actorId: supervisorX.id, // 自助建立
  });
  fx.delegationIds.push(businessDelegation.id);
  check("createApprovalDelegation：自助建立成功（reasonCode 選填）", businessDelegation.delegateUserId === delegateA.id);

  const technicalDelegation = await createApprovalDelegation({
    delegatorUserId: leadAlpha1.id,
    delegateUserId: memberAlpha.id,
    approvalType: "RD_LEAD_APPROVAL",
    teamId: teamAlpha.id,
    validFrom: new Date(now.getTime() - DAY),
    validUntil: new Date(now.getTime() + 30 * DAY),
    actorId: leadAlpha1.id, // Team LEAD 自助建立
  });
  fx.delegationIds.push(technicalDelegation.id);
  check("createApprovalDelegation：Team LEAD 為自己領導的 Team 建立技術代理成功", technicalDelegation.teamId === teamAlpha.id);

  await expectError(
    "createApprovalDelegation：重疊期間的同範圍代理被拒",
    () =>
      createApprovalDelegation({
        delegatorUserId: supervisorX.id,
        delegateUserId: outsider.id,
        approvalType: "BUSINESS_APPROVAL",
        validFrom: new Date(now.getTime() + 5 * DAY),
        validUntil: new Date(now.getTime() + 15 * DAY),
        actorId: supervisorX.id,
      }),
    (e) => e instanceof GovernanceStateError,
  );
  await expectError(
    "createApprovalDelegation：代理人再次轉代理（循環代理鏈）被拒",
    () =>
      createApprovalDelegation({
        delegatorUserId: delegateA.id,
        delegateUserId: outsider.id,
        approvalType: "BUSINESS_APPROVAL",
        validFrom: new Date(now.getTime() + 40 * DAY),
        validUntil: new Date(now.getTime() + 50 * DAY),
        actorId: delegateA.id,
      }),
    (e) => e instanceof GovernanceAccessDeniedError || e instanceof GovernanceStateError,
  );

  console.log("\n=== M1.5-B1 驗證：revokeApprovalDelegation（Team LEAD 撤銷範圍收斂） ===");

  await expectError(
    "revokeApprovalDelegation：revocationReason 空白時被拒（一律必填）",
    () => revokeApprovalDelegation({ delegationId: businessDelegation.id, actorId: supervisorX.id, revocationReason: "" }),
    (e) => e instanceof GovernanceValidationError,
  );

  // 關鍵測試：同 Team 另一位 LEAD 不得撤銷 leadAlpha1 建立的技術代理
  await expectError(
    "revokeApprovalDelegation：同 Team 另一位 LEAD 不得撤銷別人建立的代理（write path 僅限 delegatorUserId===自己或 Admin）",
    () => revokeApprovalDelegation({ delegationId: technicalDelegation.id, actorId: leadAlpha2.id, revocationReason: "我覺得該撤銷" }),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await expectError(
    "revokeApprovalDelegation：完全無關的使用者撤銷被拒",
    () => revokeApprovalDelegation({ delegationId: businessDelegation.id, actorId: outsider.id, revocationReason: "test" }),
    (e) => e instanceof GovernanceAccessDeniedError,
  );

  const revoked = await revokeApprovalDelegation({
    delegationId: technicalDelegation.id,
    actorId: leadAlpha1.id, // 本人（delegator）撤銷自己建立的代理
    revocationReason: "任務結束",
  });
  check(
    "revokeApprovalDelegation：delegator 本人可撤銷自己建立的代理，撤銷欄位完整",
    revoked.isActive === false && revoked.revokedByUserId === leadAlpha1.id && revoked.revocationReason === "任務結束" && revoked.revokedAt !== null,
  );

  const revokedByAdmin = await revokeApprovalDelegation({
    delegationId: businessDelegation.id,
    actorId: adminUser.id,
    revocationReason: "Admin 代為撤銷",
  });
  check("revokeApprovalDelegation：Admin 可代任何 delegator 撤銷", revokedByAdmin.isActive === false);

  await expectError(
    "revokeApprovalDelegation：已撤銷的代理不得重複撤銷",
    () => revokeApprovalDelegation({ delegationId: businessDelegation.id, actorId: adminUser.id, revocationReason: "again" }),
    (e) => e instanceof GovernanceStateError,
  );

  console.log("\n=== M1.5-B1 驗證：listDelegations row-level authorization ===");

  const businessDelegation2 = await createApprovalDelegation({
    delegatorUserId: supervisorX.id,
    delegateUserId: outsider.id,
    approvalType: "BUSINESS_APPROVAL",
    validFrom: new Date(now.getTime() + 5 * DAY),
    validUntil: new Date(now.getTime() + 15 * DAY),
    actorId: supervisorX.id,
  });
  fx.delegationIds.push(businessDelegation2.id);

  await expectError(
    "listDelegations：一般使用者試圖指定他人 delegatorUserId 被拒（不得靜默收斂，直接拒絕）",
    () => listDelegations(outsider.id, { delegatorUserId: supervisorX.id }),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await checkAsync("listDelegations：一般使用者不帶 filter 時只看得到自己是 delegator 或 delegate 的紀錄", async () => {
    const rows = await listDelegations(supervisorX.id);
    return rows.length > 0 && rows.every((r) => r.delegatorUserId === supervisorX.id || r.delegateUserId === supervisorX.id);
  });
  await checkAsync("listDelegations：Admin 可查全部", async () => {
    const rows = await listDelegations(adminUser.id);
    return rows.some((r) => r.id === businessDelegation2.id);
  });
  await checkAsync("listDelegations：資安推動小組可查全部（唯讀）", async () => {
    const rows = await listDelegations(secTeamUser.id);
    return rows.some((r) => r.id === businessDelegation2.id);
  });

  // =========================================================================
  // 健康檢查
  // =========================================================================
  console.log("\n=== M1.5-B1 驗證：getApprovalGovernanceHealth row-level authorization ===");

  await expectError(
    "getApprovalGovernanceHealth：一般使用者被拒",
    () => getApprovalGovernanceHealth(memberAlpha.id),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await expectError(
    "getApprovalGovernanceHealth：Team LEAD 也被拒",
    () => getApprovalGovernanceHealth(leadAlpha1.id),
    (e) => e instanceof GovernanceAccessDeniedError,
  );
  await checkAsync("getApprovalGovernanceHealth：Admin 成功", async () => {
    const report = await getApprovalGovernanceHealth(adminUser.id, { now });
    return report.findings.length === 12;
  });
  await checkAsync("getApprovalGovernanceHealth：資安推動小組成功", async () => {
    const report = await getApprovalGovernanceHealth(secTeamUser.id, { now });
    return report.findings.length === 12;
  });

  console.log("\n=== M1.5-B1 驗證：健康檢查 12 項內容（不誤判） ===");

  const report = await getApprovalGovernanceHealth(adminUser.id, { now, expiringWithinDays: 7 });
  const byKey = new Map(report.findings.map((f) => [f.checkKey, f]));

  check("健康檢查：outsider 沒有有效主管，出現在 usersWithoutPrimarySupervisor", byKey.get("usersWithoutPrimarySupervisor")?.items.some((i) => i.id === outsider.id) ?? false);
  check("健康檢查：teamBeta（空 Team）出現在 teamsWithoutLead", byKey.get("teamsWithoutLead")?.items.some((i) => i.id === teamBeta.id) ?? false);
  check("健康檢查：teamGamma（有成員無 LEAD）出現在 teamsWithoutLead", byKey.get("teamsWithoutLead")?.items.some((i) => i.id === teamGamma.id) ?? false);
  check("健康檢查：teamAlpha（有 LEAD）不出現在 teamsWithoutLead", !(byKey.get("teamsWithoutLead")?.items.some((i) => i.id === teamAlpha.id) ?? false));
  check("健康檢查：teamGamma（無 LEAD，僅有一般成員）出現在 teamsWithoutEligibleApprover", byKey.get("teamsWithoutEligibleApprover")?.items.some((i) => i.id === teamGamma.id) ?? false);
  check("健康檢查：teamAlpha（有 LEAD）不出現在 teamsWithoutEligibleApprover", !(byKey.get("teamsWithoutEligibleApprover")?.items.some((i) => i.id === teamAlpha.id) ?? false));
  check("健康檢查：teamBeta（空 Team）出現在 teamsWithoutActiveMember", byKey.get("teamsWithoutActiveMember")?.items.some((i) => i.id === teamBeta.id) ?? false);
  check("健康檢查：teamGamma（有成員）不出現在 teamsWithoutActiveMember", !(byKey.get("teamsWithoutActiveMember")?.items.some((i) => i.id === teamGamma.id) ?? false));

  console.log("\n=== M1.5-B1 驗證：健康檢查第 5 項（isActive 與撤銷欄位一致性，不得誤判自然到期） ===");

  const expiredButActiveDelegation = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: supervisorX.id,
      delegateUserId: outsider.id,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(now.getTime() - 60 * DAY),
      validUntil: new Date(now.getTime() - 30 * DAY), // 自然過期
      isActive: true, // 正常歷史紀錄，未撤銷
      createdByUserId: adminUser.id,
    },
  });
  fx.delegationIds.push(expiredButActiveDelegation.id);

  const inconsistentRevokedButActive = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: supervisorX.id,
      delegateUserId: memberAlpha.id,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(now.getTime() - 20 * DAY),
      validUntil: new Date(now.getTime() + 20 * DAY),
      isActive: true, // 不一致：已有撤銷資訊卻仍標示有效
      revokedAt: new Date(now.getTime() - 5 * DAY),
      revokedByUserId: adminUser.id,
      revocationReason: "資料異常樣本",
      createdByUserId: adminUser.id,
    },
  });
  fx.delegationIds.push(inconsistentRevokedButActive.id);

  const inconsistentInactiveNoTrail = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: supervisorX.id,
      delegateUserId: leadAlpha2.id,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(now.getTime() - 20 * DAY),
      validUntil: new Date(now.getTime() + 20 * DAY),
      isActive: false, // 不一致：停用卻缺撤銷留痕
      createdByUserId: adminUser.id,
    },
  });
  fx.delegationIds.push(inconsistentInactiveNoTrail.id);

  const reportAfterFixtures = await getApprovalGovernanceHealth(adminUser.id, { now, expiringWithinDays: 7 });
  const byKeyAfter = new Map(reportAfterFixtures.findings.map((f) => [f.checkKey, f]));
  const item5 = byKeyAfter.get("delegationActiveRevocationInconsistency");

  check(
    "健康檢查第 5 項：自然到期但 isActive=true、無撤銷資訊 → 正常歷史紀錄，不得列入異常",
    !(item5?.items.some((i) => i.id === expiredButActiveDelegation.id) ?? true),
  );
  check(
    "健康檢查第 5 項：revokedAt 已存在但 isActive=true → 列為異常",
    item5?.items.some((i) => i.id === inconsistentRevokedButActive.id) ?? false,
  );
  check(
    "健康檢查第 5 項：isActive=false 但撤銷留痕不完整 → 列為異常",
    item5?.items.some((i) => i.id === inconsistentInactiveNoTrail.id) ?? false,
  );

  console.log("\n=== M1.5-B1 驗證：健康檢查其餘項目（到期提醒／重疊／停用使用者／委託人喪失資格） ===");

  // 用 leadAlpha1（仍是 teamAlpha 的有效 LEAD，且先前建立的 technicalDelegation 已撤銷、無重疊風險）
  // 而非 supervisorX（其 BUSINESS_APPROVAL 範圍已被上方健康檢查第 5 項的 fixture
  // inconsistentRevokedButActive 佔用 -20d..+20d 的 isActive=true 區間，會誤觸重疊檢查）。
  const expiringSoonDelegation = await createApprovalDelegation({
    delegatorUserId: leadAlpha1.id,
    delegateUserId: reporterB.id,
    approvalType: "RD_LEAD_APPROVAL",
    teamId: teamAlpha.id,
    validFrom: new Date(now.getTime() - DAY),
    validUntil: new Date(now.getTime() + 3 * DAY), // 7 天內到期
    actorId: leadAlpha1.id,
  });
  fx.delegationIds.push(expiringSoonDelegation.id);
  const reportExpiring = await getApprovalGovernanceHealth(adminUser.id, { now, expiringWithinDays: 7 });
  check(
    "健康檢查第 6 項：N 天內到期的代理正確列出",
    reportExpiring.findings.find((f) => f.checkKey === "delegationsExpiringSoon")?.items.some((i) => i.id === expiringSoonDelegation.id) ?? false,
  );

  // 停用使用者仍有有效主管關係（inactiveUser 作為 supervisorUserId）
  const inactiveSupervisorAssignment = await prisma.userSupervisorAssignment.create({
    data: {
      userId: outsider.id,
      supervisorUserId: inactiveUser.id,
      validFrom: new Date(now.getTime() - DAY),
      isPrimary: false, // 避免與既有 primary 重疊，只測 isActive 使用者一致性檢查
      isActive: true,
      createdByUserId: adminUser.id,
    },
  });
  fx.assignmentIds.push(inactiveSupervisorAssignment.id);
  const reportInactive = await getApprovalGovernanceHealth(adminUser.id, { now });
  check(
    "健康檢查第 11 項：已停用使用者仍是有效主管指派的一方時列入異常",
    reportInactive.findings.find((f) => f.checkKey === "inactiveUsersWithActiveSettings")?.items.some((i) => i.id === `assignment-${inactiveSupervisorAssignment.id}-supervisor`) ?? false,
  );

  // 委託人喪失原始資格：leadAlpha2 建立技術代理後被移除 LEAD 資格
  await assignTeamLead({ teamId: teamGamma.id, userId: memberAlpha.id, actorId: adminUser.id, reasonCode: "臨時測試" });
  const staleDelegatorDelegation = await createApprovalDelegation({
    delegatorUserId: memberAlpha.id,
    delegateUserId: outsider.id,
    approvalType: "RD_LEAD_APPROVAL",
    teamId: teamGamma.id,
    validFrom: new Date(now.getTime() - DAY),
    validUntil: new Date(now.getTime() + 30 * DAY),
    actorId: memberAlpha.id,
  });
  fx.delegationIds.push(staleDelegatorDelegation.id);
  await removeTeamLead({ teamId: teamGamma.id, userId: memberAlpha.id, actorId: adminUser.id, reasonCode: "移除測試 LEAD" });
  const reportStale = await getApprovalGovernanceHealth(adminUser.id, { now });
  check(
    "健康檢查第 12 項：委託人已不再具有原始核准資格（LEAD 資格被移除後）正確列出",
    reportStale.findings.find((f) => f.checkKey === "delegatorsWithoutOriginalAuthority")?.items.some((i) => i.id === staleDelegatorDelegation.id) ?? false,
  );
}

async function cleanupFixtures(fx: Fixtures) {
  try {
    await prisma.approvalDelegation.deleteMany({ where: { id: { in: fx.delegationIds } } });
  } catch (e) {
    console.warn("cleanup ApprovalDelegation 失敗：", e);
  }
  try {
    await prisma.userSupervisorAssignment.deleteMany({ where: { id: { in: fx.assignmentIds } } });
  } catch (e) {
    console.warn("cleanup UserSupervisorAssignment 失敗：", e);
  }
  try {
    await prisma.teamMember.deleteMany({ where: { teamId: { in: fx.teamIds } } });
  } catch (e) {
    console.warn("cleanup TeamMember 失敗：", e);
  }
  try {
    await prisma.team.deleteMany({ where: { id: { in: fx.teamIds } } });
  } catch (e) {
    console.warn("cleanup Team 失敗：", e);
  }
  try {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup AuditLog（actor）失敗：", e);
  }
  try {
    await prisma.user.deleteMany({ where: { id: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup User 失敗：", e);
  }
}

async function main() {
  runPureLogicTests();

  console.log("\n=== 資料庫相依檢查（需 Migration 已套用；未套用時 SKIPPED，不嘗試自動套用） ===");

  let migrationApplied = false;
  try {
    await prisma.userSupervisorAssignment.count();
    migrationApplied = true;
  } catch {
    migrationApplied = false;
  }

  if (!migrationApplied) {
    skip(
      "核准治理設定服務層＋row-level authorization＋健康檢查實測",
      "資料表尚未建立，等待 Migration 套用至測試資料庫後才能驗證，本輪不對任何資料庫套用 Migration",
    );
  } else {
    const fx: Fixtures = { userIds: [], teamIds: [], assignmentIds: [], delegationIds: [] };
    try {
      await runDbDependentTests(fx);
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
  console.error("m1_5b-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
