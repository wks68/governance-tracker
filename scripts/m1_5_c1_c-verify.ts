// M1.5-C1-C 驗證腳本
//
// C1-C 是建構在 C1-B 已完成、已測試的 peopleService／teamLeadService 之上的 UI 層
// （Server Component 頁面＋Server Action＋Client 表單元件）。C1-B 的 78 項測試已完整
// 涵蓋這些服務本身的授權、blocking／warning、transaction 邊界與 row-level 規則，本腳本
// 不重新複製那些測試，而是聚焦在 C1-C 這一層新增的東西：
//
//   1. Server Action 統一錯誤轉換（toActionResult）：純邏輯測試，不需要資料庫，也不需要
//      Next.js request context（Server Action 本身呼叫 requireCurrentUser() 需要
//      next/headers 的 cookies()，離開真實 request 情境無法直接呼叫，因此無法在本腳本
//      內直接呼叫 src/app/**/actions.ts 匯出的函式——這點與 C1-B 測試「服務層」而非
//      「Server Action」本身是同一個道理）。
//   2. C1-C 為了新表單新增的服務層欄位（loginIdentifier）與新匯出（hasPeopleCapability）：
//      DB 相依測試，沿用既有 scratch DB pattern。
//   3. 舊入口淘汰與模組邊界：source-level 靜態檢查（UserRoleActions.tsx 已刪除、
//      /admin/users 改為重導、Action 檔案不直接 import Prisma、UI 不深入 import
//      src/lib/people/* 內部模組、Nav 含新入口等）。
//
// Fail-closed：本檔第一行 import 為 assertSafeTestDatabase，若呼叫端未顯式設定
// DATABASE_URL，或其解析後（含 symlink／device+inode 比對）指向正式 prisma/dev.db，
// 一律立即 process.exit(1)，不建立 Prisma Client、不寫入任何資料。

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  createPerson,
  updatePersonProfile,
  hasPeopleCapability,
  PeopleValidationError,
  PeopleStateError,
  PeopleAccessDeniedError,
  PeopleNotFoundError,
} from "../src/lib/peopleService";
import {
  GovernanceValidationError,
  GovernanceStateError,
  GovernanceAccessDeniedError,
  GovernanceNotFoundError,
} from "../src/lib/supervisorAssignmentService";
import { actionOk, toActionResult } from "../src/lib/actionResult";

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

const RUN_TAG = `m15c1cv${Date.now()}`;

// ===========================================================================
// 1. toActionResult：純邏輯測試，不需要資料庫
// ===========================================================================
function runActionResultTests() {
  console.log("\n=== C1-C 驗證：toActionResult 錯誤轉換（純邏輯，必定執行） ===");

  check("[AR1] actionOk：預設 data 為 undefined，ok=true，訊息保留原樣", (() => {
    const r = actionOk("成功訊息");
    return r.ok === true && r.data === undefined && r.message === "成功訊息";
  })());

  check("[AR2] actionOk：可帶入 data", (() => {
    const r = actionOk("成功", { id: "x" });
    return r.ok === true && r.data?.id === "x";
  })());

  const knownCases: { name: string; err: Error }[] = [
    { name: "PeopleValidationError", err: new PeopleValidationError(["issue-a"]) },
    { name: "PeopleStateError", err: new PeopleStateError("state message") },
    { name: "PeopleAccessDeniedError", err: new PeopleAccessDeniedError("access message") },
    { name: "PeopleNotFoundError", err: new PeopleNotFoundError("not found message") },
    { name: "GovernanceValidationError", err: new GovernanceValidationError(["gov-issue"]) },
    { name: "GovernanceStateError", err: new GovernanceStateError("gov state message") },
    { name: "GovernanceAccessDeniedError", err: new GovernanceAccessDeniedError("gov access message") },
    { name: "GovernanceNotFoundError", err: new GovernanceNotFoundError("gov not found message") },
  ];
  for (const { name, err } of knownCases) {
    check(`[AR3] toActionResult：已知領域錯誤 ${name} 轉為 ok=false，code=${name}，message 與原始 .message 相同`, (() => {
      const r = toActionResult(err);
      return r.ok === false && r.code === name && r.message === err.message;
    })());
  }

  check("[AR4] toActionResult：未知錯誤（例如可能包含 DB 路徑／內部細節的例外）不得洩漏原始 message，改用固定通用訊息", (() => {
    const leaking = new Error("SQLITE_ERROR: file:/workspaces/governance-tracker/prisma/dev.db unique constraint failed");
    const r = toActionResult(leaking, "操作失敗，請稍後再試");
    return r.ok === false && r.code === "UNKNOWN_ERROR" && r.message === "操作失敗，請稍後再試" && !r.message.includes("dev.db");
  })());

  check("[AR5] toActionResult：非 Error 物件（例如字串）同樣視為未知錯誤，不得洩漏內容", (() => {
    const r = toActionResult("raw string thrown", "fallback");
    return r.ok === false && r.code === "UNKNOWN_ERROR" && r.message === "fallback";
  })());
}

// ===========================================================================
// 2. 舊入口淘汰與模組邊界：source-level 靜態檢查
// ===========================================================================
const REPO_ROOT = path.resolve(__dirname, "..");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

function listFilesRecursive(relDir: string): string[] {
  const absDir = path.join(REPO_ROOT, relDir);
  if (!fs.existsSync(absDir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const relEntryPath = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(relEntryPath));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      results.push(relEntryPath);
    }
  }
  return results;
}

function runStructuralChecks() {
  console.log("\n=== C1-C 驗證：舊入口淘汰與模組邊界（靜態原始碼檢查，必定執行） ===");

  check("[S1] src/components/UserRoleActions.tsx 已刪除", !fileExists("src/components/UserRoleActions.tsx"));

  const adminUsersSrc = readSource("src/app/admin/users/page.tsx");
  check('[S2] src/app/admin/users/page.tsx 改為重導至 "/admin/people"', /redirect\(\s*["']\/admin\/people["']\s*\)/.test(adminUsersSrc));
  check(
    "[S2b] src/app/admin/users/page.tsx 不再 import Prisma 或已刪除的 UserRoleActions",
    !/@\/lib\/prisma/.test(adminUsersSrc) && !/UserRoleActions/.test(adminUsersSrc),
  );

  const legacyActionsSrc = readSource("src/lib/actions.ts");
  check(
    "[S3] src/lib/actions.ts 不再定義 assignUserRoleAction／setUserActiveAction",
    !/function\s+assignUserRoleAction/.test(legacyActionsSrc) && !/function\s+setUserActiveAction/.test(legacyActionsSrc),
  );
  check(
    "[S3b] src/lib/actions.ts 不存在直接寫入 User.role／isActive 的舊路徑",
    !/prisma\.user\.update/.test(legacyActionsSrc),
  );

  for (const actionsFile of ["src/app/admin/people/actions.ts", "src/app/admin/teams/actions.ts"]) {
    const src = readSource(actionsFile);
    check(
      `[S4] ${actionsFile} 不直接 import Prisma（一律只呼叫 peopleService／teamLeadService）`,
      !/@prisma\/client/.test(src) && !/@\/lib\/prisma["']/.test(src),
    );
    check(`[S4b] ${actionsFile} 不直接 import src/lib/people 內部模組（一律經 peopleService facade）`, !/@\/lib\/people\//.test(src));
  }

  const uiDirs = ["src/app/admin/people", "src/app/admin/teams", "src/components/people", "src/components/teams"];
  let deepImportViolation: string | null = null;
  let clientPrismaViolation: string | null = null;
  for (const dir of uiDirs) {
    for (const file of listFilesRecursive(dir)) {
      const src = readSource(file);
      if (/@\/lib\/people\//.test(src)) deepImportViolation = file;
      const isClientComponent = /^["']use client["'];?/m.test(src);
      if (isClientComponent && (/@prisma\/client/.test(src) || /@\/lib\/prisma["']/.test(src))) clientPrismaViolation = file;
    }
  }
  check("[S5] 人員／Team UI 範圍內沒有任何檔案直接深入 import src/lib/people 內部模組", deepImportViolation === null);
  check("[S6] 人員／Team UI 範圍內沒有任何 Client Component 直接 import Prisma", clientPrismaViolation === null);

  const navSrc = readSource("src/components/Nav.tsx");
  check("[S7] Nav.tsx 含「人員」入口（/admin/people）", /\/admin\/people/.test(navSrc));
  check("[S7b] Nav.tsx 含「Team」入口（/admin/teams）", /\/admin\/teams/.test(navSrc));
  check(
    '[S7c] Nav.tsx 仍未使用 role === "Admin" 字串判斷（延續 C1-B2 檢查）',
    !/role\s*===\s*"Admin"/.test(navSrc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")),
  );

  const reasonFieldSrc = readSource("src/components/people/ReasonCodeField.tsx");
  check("[S8] ReasonCodeField 一律 required（不得選填）", /<textarea[^>]*\brequired\b/.test(reasonFieldSrc));

  const personDetailSrc = readSource("src/app/admin/people/[userId]/page.tsx");
  check(
    "[S9] 人員明細頁對 PeopleAccessDeniedError 呼叫 notFound()（不洩漏存在與否的差異）",
    /PeopleAccessDeniedError/.test(personDetailSrc) && /notFound\(\)/.test(personDetailSrc),
  );
  const teamDetailSrc = readSource("src/app/admin/teams/[teamId]/page.tsx");
  check(
    "[S9b] Team 明細頁對 PeopleAccessDeniedError 呼叫 notFound()",
    /PeopleAccessDeniedError/.test(teamDetailSrc) && /notFound\(\)/.test(teamDetailSrc),
  );

  const peopleListSrc = readSource("src/app/admin/people/page.tsx");
  check("[S10] 人員清單頁使用 listPeopleForActor（不得自行拼接 row-level 條件）", /listPeopleForActor/.test(peopleListSrc));
  const teamListSrc = readSource("src/app/admin/teams/page.tsx");
  check("[S10b] Team 清單頁使用 listTeamsForActor（不得自行拼接 row-level 條件）", /listTeamsForActor/.test(teamListSrc));
}

// ===========================================================================
// 3. C1-C 新增服務層欄位（loginIdentifier）與新匯出（hasPeopleCapability）：DB 相依
// ===========================================================================

interface Fixtures {
  userIds: string[];
}

async function createAdmin(name: string): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role: "Admin", isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role: "Admin", isActive: true } });
  return user;
}

async function runDbDependentTests(fx: Fixtures) {
  const admin = await createAdmin("c1cAdmin");
  fx.userIds.push(admin.id);

  const loginId = `${RUN_TAG}-login-a`;
  const created = await createPerson({
    name: "登入識別碼測試",
    email: `${RUN_TAG}-loginid-a@example.invalid`,
    initialRole: "PM",
    loginIdentifier: loginId,
    actorId: admin.id,
    reasonCode: "TEST_LOGIN_ID",
  });
  fx.userIds.push(created.id);

  await checkAsync("[L1] createPerson：loginIdentifier 有填寫時正確寫入", async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    return row.loginIdentifier === loginId;
  });

  await expectError(
    "[L2] createPerson：loginIdentifier 重複時拒絕，不建立半成品資料",
    () =>
      createPerson({
        name: "重複登入識別碼",
        email: `${RUN_TAG}-loginid-b@example.invalid`,
        initialRole: "PM",
        loginIdentifier: loginId,
        actorId: admin.id,
        reasonCode: "TEST_DUP_LOGIN_ID",
      }),
    (e) => e instanceof PeopleValidationError,
  );

  const withoutLoginId = await createPerson({
    name: "無登入識別碼",
    email: `${RUN_TAG}-noLoginId@example.invalid`,
    initialRole: "PM",
    actorId: admin.id,
    reasonCode: "TEST_NO_LOGIN_ID",
  });
  fx.userIds.push(withoutLoginId.id);

  await checkAsync("[L3] updatePersonProfile：可補上先前未填寫的 loginIdentifier", async () => {
    const updated = await updatePersonProfile({
      userId: withoutLoginId.id,
      loginIdentifier: `${RUN_TAG}-login-c`,
      actorId: admin.id,
      reasonCode: "TEST_SET_LOGIN_ID",
    });
    return updated.loginIdentifier === `${RUN_TAG}-login-c`;
  });

  await checkAsync("[L4] updatePersonProfile：loginIdentifier 傳入空字串視為清除為 null", async () => {
    const updated = await updatePersonProfile({
      userId: withoutLoginId.id,
      loginIdentifier: "",
      actorId: admin.id,
      reasonCode: "TEST_CLEAR_LOGIN_ID",
    });
    return updated.loginIdentifier === null;
  });

  await expectError(
    "[L5] updatePersonProfile：loginIdentifier 改成他人已使用的值時拒絕",
    () =>
      updatePersonProfile({
        userId: withoutLoginId.id,
        loginIdentifier: loginId,
        actorId: admin.id,
        reasonCode: "TEST_CONFLICT_LOGIN_ID",
      }),
    (e) => e instanceof PeopleValidationError,
  );

  const plainUser = await prisma.user.create({
    data: { name: "plainUser", email: `${RUN_TAG}-plainUser@example.invalid`, role: "PM", isActive: true },
  });
  await prisma.userRole.create({ data: { userId: plainUser.id, role: "PM", isActive: true } });
  fx.userIds.push(plainUser.id);

  await checkAsync("[H1] hasPeopleCapability：Admin 具有 user.create", async () => hasPeopleCapability(admin.id, "user.create"));
  await checkAsync("[H2] hasPeopleCapability：一般 PM 不具有 user.create", async () => !(await hasPeopleCapability(plainUser.id, "user.create")));
  await checkAsync("[H3] hasPeopleCapability：一般 PM 不具有 team.manageMembers", async () => !(await hasPeopleCapability(plainUser.id, "team.manageMembers")));
}

async function cleanupFixtures(fx: Fixtures) {
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
  try {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup AuditLog 失敗：", e);
  }
  try {
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

async function main() {
  console.log("=== M1.5-C1-C 驗證：人員／Team 管理介面 ===");

  runActionResultTests();
  runStructuralChecks();

  console.log("\n=== 資料庫相依檢查（需 Migration 已套用；未套用時 SKIPPED，不嘗試自動套用） ===");

  let migrationApplied = false;
  try {
    await prisma.userRole.count();
    migrationApplied = true;
  } catch {
    migrationApplied = false;
  }

  if (!migrationApplied) {
    skip("loginIdentifier／hasPeopleCapability DB 相依實測", "資料表尚未建立，等待 Migration 套用至測試資料庫後才能驗證，本輪不對任何資料庫套用 Migration");
  } else {
    const fx: Fixtures = { userIds: [] };
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
  console.error("m1_5_c1_c-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
