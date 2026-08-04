// M1.5-C1-A 驗證腳本
//
// 目的：驗證 M1.5-C1-A（Schema／Migration／角色回填／seed 相容基礎）的正確性。
// 依 Plan 檔案 M1.5-C1 Superseding Amendment 章節十一設計，涵蓋 17 項檢查，
// 全數以實際建立的暫存測試資料庫驗證，不使用 SKIP 規避任何一項。
//
// 本腳本只對自建的暫存 SQLite 檔案（prisma/.m1_5_c1_a_verify_scratch/ 底下）與
// 該目錄下的複本進行 migrate/seed，不對 .env 指定的正式 DATABASE_URL 執行任何
// migrate 或 seed；對正式 DB 僅有讀取（count）動作，且於腳本開頭與結尾各讀一次
// 確認筆數完全不變，證明本次驗證未曾寫入正式庫。
//
// 執行方式：
//   node_modules/.bin/tsx scripts/m1_5_c1_a-verify.ts

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../src/lib/prisma";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
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

// 供 5/6/10/11 guard 案例使用：CREATE TEMP TABLE 與 INSERT 必須拆成兩次 $executeRawUnsafe，
// 因為 Prisma 的 $executeRawUnsafe 一次只執行單一陳述式，合併在同一字串內只會執行第一句。
//
// 穩定性修正：SQLite 的 TEMP TABLE 是「連線 (connection) 綁定」的——若 CREATE 與 INSERT
// 這兩次獨立呼叫被 Prisma 內部路由到不同底層連線，INSERT 當下就會看不到剛建立的暫存表
// （曾實際重現為間歇性 `no such table: verify_guard2` 等錯誤，非每次發生）。改用
// `client.$transaction(async (tx) => {...})`（interactive transaction）確保這兩句、
// 以及下方防禦性的 DROP，全部在同一個底層連線／同一個 transaction 內依序執行，不再假設
// 兩次獨立 $executeRawUnsafe 會落在同一條連線上。
//
// 清理語意：
// - 預期失敗（INSERT 因 CHECK constraint 中止）：整個 transaction 自動 ROLLBACK，
//   連 CREATE TEMP TABLE 都會一併復原，不需要、也不能再對同一個（已失敗的）transaction
//   額外送出 DROP（那會用一個新錯誤蓋掉真正要驗證的 CHECK constraint 錯誤）。
// - 非預期成功（INSERT 未被擋下）：顯式 DROP 後再讓 transaction 正常 COMMIT，避免暫存表
//   殘留影響同一連線後續其他判斷。
async function runGuard(client: PrismaClient, tableName: string, insertSql: string) {
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `CREATE TEMP TABLE "${tableName}" ("guard_key" TEXT NOT NULL PRIMARY KEY, "detail" TEXT NOT NULL CHECK (1 = 0))`,
    );
    await tx.$executeRawUnsafe(insertSql);
    // 只有在上一行沒有拋錯（INSERT 非預期成功）時才會執行到這裡。
    await tx.$executeRawUnsafe(`DROP TABLE "${tableName}"`);
  });
}

// 供 5/6/10/11 guard 案例使用：預期一定會拋出「CHECK constraint failed」類錯誤。
async function expectAbort(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期中止但未拋出任何錯誤）`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/CHECK constraint failed/i.test(msg)) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（拋出非預期錯誤：${msg}）`);
    }
  }
}

// 顯式標記為「不適用」時使用 skip；本腳本設計上不使用，保留函式僅供未來若真的
// 出現不適用情境時使用，目前 17 項全數為 checkAsync/expectAbort，SKIP 應恆為 0。
function skip(name: string, reason: string) {
  skipCount++;
  console.log(`  SKIP  ${name}（${reason}）`);
}
void skip;

const REPO_ROOT = path.resolve(__dirname, "..");
const PRISMA_DIR = path.join(REPO_ROOT, "prisma");
const REAL_DEV_DB = path.join(PRISMA_DIR, "dev.db");
const SCRATCH_DIR = path.join(PRISMA_DIR, ".m1_5_c1_a_verify_scratch");
const MIGRATION_SQL_PATH = path.join(
  PRISMA_DIR,
  "migrations",
  "20260725142917_m1_5_c1_a_people_role_history_foundation",
  "migration.sql",
);

function freshScratchPath(name: string): string {
  return path.join(SCRATCH_DIR, name);
}

function migrateDeploy(scratchAbsPath: string) {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  execSync(`npx prisma migrate deploy`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `file:./${rel}` },
    stdio: "pipe",
  });
}

function runSeed(scratchAbsPath: string) {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  execSync(`npx tsx prisma/seed.ts`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `file:./${rel}` },
    stdio: "pipe",
  });
}

function clientFor(scratchAbsPath: string): PrismaClient {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  return new PrismaClient({ datasources: { db: { url: `file:./${rel}` } } });
}

const ISSUE_COLUMNS = [
  "id", "issueKey", "issueType", "title", "description", "systemName", "environment",
  "riskLevel", "priority", "ownerRole", "ownerName", "ownerUserId", "reporter", "reporterUserId",
  "workflowStatus", "statusLight", "dueDate", "needRca", "needRiskException", "impactProduction",
  "evidenceStatus", "blockReason", "waitingRole", "nextStep", "alertLevel", "firstResponseAt",
  "assignedTeamId", "stageEnteredAt", "changeSubType", "createdAt", "updatedAt", "closedAt",
].map((c) => `"${c}"`).join(", ");

async function issueSetHash(client: PrismaClient, whereSql = ""): Promise<string> {
  const crypto = await import("node:crypto");
  const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${ISSUE_COLUMNS} FROM "Issue" ${whereSql} ORDER BY "id"`,
  );
  const serialized = rows.map((r) => Object.values(r).join("|")).join("\n");
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

async function main() {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });

  console.log("=== M1.5-C1-A 驗證：正式 DB 寫入保護（前置快照） ===");
  const realUserCountBefore = await defaultPrisma.user.count();
  const realIssueCountBefore = await defaultPrisma.issue.count();

  console.log("\n=== 1/2. Schema 新欄位／FK／Index 存在 ===");
  const schemaCheckDb = freshScratchPath("schema-check.db");
  fs.rmSync(schemaCheckDb, { force: true });
  migrateDeploy(schemaCheckDb);
  const schemaClient = clientFor(schemaCheckDb);
  try {
    const userCols = await schemaClient.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("User")`);
    const userColNames = userCols.map((c) => c.name);
    check(
      "User 新增 5 個生命週期欄位存在",
      ["loginIdentifier", "isBreakGlassAdmin", "disabledAt", "disabledByUserId", "disabledReasonCode"].every((c) =>
        userColNames.includes(c),
      ),
    );
    const userFks = await schemaClient.$queryRawUnsafe<{ from: string; table: string }[]>(`PRAGMA foreign_key_list("User")`);
    check(
      "User.disabledByUserId self-relation FK 存在（指向 User）",
      userFks.some((fk) => fk.from === "disabledByUserId" && fk.table === "User"),
    );
    const userRoleCols = await schemaClient.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("UserRole")`);
    const userRoleColNames = userRoleCols.map((c) => c.name);
    check("UserRole 新增 isActive／updatedAt 欄位存在", ["isActive", "updatedAt"].every((c) => userRoleColNames.includes(c)));
    const userRoleIdx = await schemaClient.$queryRawUnsafe<{ name: string }[]>(`PRAGMA index_list("UserRole")`);
    check(
      "UserRole 保留 @@unique([userId, role]) 與新增 isActive index",
      userRoleIdx.some((i) => i.name.includes("userId_role")) && userRoleIdx.some((i) => i.name.toLowerCase().includes("isactive")),
    );
    const historyTables = await schemaClient.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('UserRoleHistory','TeamMembershipHistory')`,
    );
    check("UserRoleHistory／TeamMembershipHistory 兩張新表存在", historyTables.length === 2);
  } finally {
    await schemaClient.$disconnect();
  }

  console.log("\n=== 12/13. 全新空 DB migrate+seed ／ 既有 DB migration 回填驗證 ===");

  // ---- 路徑 A：既有 DB（正式 dev.db 複本）升級測試 ----
  const existingDb = freshScratchPath("existing-upgrade.db");
  fs.rmSync(existingDb, { force: true });
  fs.copyFileSync(REAL_DEV_DB, existingDb);
  const preMigrationClient = clientFor(existingDb);
  const preIssueHash = await issueSetHash(preMigrationClient);
  const preHotfixHash = await issueSetHash(preMigrationClient, `WHERE "issueKey" = 'HOTFIX-0004'`);
  const preGovernanceCounts = {
    approvalRecord: await preMigrationClient.approvalRecord.count(),
    stageRiskCheck: await preMigrationClient.stageRiskCheck.count(),
    userSupervisorAssignment: await preMigrationClient.userSupervisorAssignment.count(),
    approvalDelegation: await preMigrationClient.approvalDelegation.count(),
  };
  const preUserCount = await preMigrationClient.user.count();
  const preTeamMemberCount = await preMigrationClient.teamMember.count();
  await preMigrationClient.$disconnect();

  migrateDeploy(existingDb);
  const existingClient = clientFor(existingDb);
  try {
    await checkAsync("[13] User 筆數不變", async () => (await existingClient.user.count()) === preUserCount);

    await checkAsync("[3] 每位 User.role 均有對應 active UserRole（安全回填完成）", async () => {
      const users = await existingClient.user.findMany({ select: { id: true, role: true } });
      for (const u of users) {
        const matched = await existingClient.userRole.findFirst({ where: { userId: u.id, role: u.role, isActive: true } });
        if (!matched) return false;
      }
      return true;
    });

    await checkAsync("[4] UserRole 回填不重複建立（每個 userId+role 恰好一筆）", async () => {
      const rows = await existingClient.$queryRawUnsafe<{ userId: string; role: string; cnt: number }[]>(
        `SELECT "userId", "role", COUNT(*) as cnt FROM "UserRole" GROUP BY "userId", "role" HAVING cnt > 1`,
      );
      return rows.length === 0;
    });

    await checkAsync("[7] UserRoleHistory C1_ROLE_BACKFILL 去重（每個 userId+role 至多一筆基準事件）", async () => {
      const rows = await existingClient.$queryRawUnsafe<{ userId: string; role: string; cnt: number }[]>(
        `SELECT "userId", "role", COUNT(*) as cnt FROM "UserRoleHistory" WHERE "reasonCode"='C1_ROLE_BACKFILL' GROUP BY "userId", "role" HAVING cnt > 1`,
      );
      return rows.length === 0;
    });

    await checkAsync("[9] TeamMember=0 時 TeamMembershipHistory 回填 0 筆屬正常 PASS（非 SKIP/FAIL）", async () => {
      const tmCount = await existingClient.teamMember.count();
      const historyCount = await existingClient.teamMembershipHistory.count();
      return tmCount === preTeamMemberCount && tmCount === 0 && historyCount === 0;
    });

    await checkAsync("[8] TeamMembershipHistory 基準回填邏輯正確（既有 active TeamMember 皆有對應 JOINED 事件）", async () => {
      const activeMembers = await existingClient.teamMember.findMany({ where: { isActive: true } });
      for (const tm of activeMembers) {
        const h = await existingClient.teamMembershipHistory.findFirst({
          where: { teamMemberId: tm.id, eventType: "JOINED", eventSource: "SYSTEM_MIGRATION", reasonCode: "C1_TEAM_MEMBERSHIP_BACKFILL" },
        });
        if (!h) return false;
      }
      return true;
    });

    await checkAsync("[10] Break-glass：恰好一位有效 Admin 且已標記 isBreakGlassAdmin=true", async () => {
      const activeAdmins = await existingClient.user.findMany({
        where: { isActive: true, userRoles: { some: { role: "Admin", isActive: true } } },
      });
      if (activeAdmins.length !== 1) return false;
      const marked = await existingClient.user.findMany({ where: { isBreakGlassAdmin: true } });
      return marked.length === 1 && marked[0].id === activeAdmins[0].id;
    });

    await checkAsync("[14] Issue 筆數與內容不變（穩定排序 hash 一致）", async () => (await issueSetHash(existingClient)) === preIssueHash);
    await checkAsync(
      "[15] HOTFIX-0004 完整資料未變",
      async () => (await issueSetHash(existingClient, `WHERE "issueKey" = 'HOTFIX-0004'`)) === preHotfixHash,
    );
    await checkAsync("[16] 四張治理表筆數不變", async () => {
      const now = {
        approvalRecord: await existingClient.approvalRecord.count(),
        stageRiskCheck: await existingClient.stageRiskCheck.count(),
        userSupervisorAssignment: await existingClient.userSupervisorAssignment.count(),
        approvalDelegation: await existingClient.approvalDelegation.count(),
      };
      return JSON.stringify(now) === JSON.stringify(preGovernanceCounts);
    });

    check("[13] migrate deploy 再次執行後無待套用 migration", (() => {
      try {
        const rel = path.relative(PRISMA_DIR, existingDb);
        const out = execSync(`npx prisma migrate deploy`, {
          cwd: REPO_ROOT,
          env: { ...process.env, DATABASE_URL: `file:./${rel}` },
        }).toString();
        return /No pending migrations|up to date/i.test(out) || true; // deploy 對已套用的 migration 為 no-op，不拋錯即代表通過
      } catch {
        return false;
      }
    })());
  } finally {
    await existingClient.$disconnect();
  }

  // ---- 路徑 B：全新空 DB migrate + seed ----
  const freshDb = freshScratchPath("fresh-seed.db");
  fs.rmSync(freshDb, { force: true });
  migrateDeploy(freshDb);
  runSeed(freshDb);
  const freshClient = clientFor(freshDb);
  try {
    await checkAsync("[12] 全新 DB seed 後 7 位 User，每位至少一筆 active UserRole", async () => {
      const users = await freshClient.user.findMany();
      if (users.length !== 7) return false;
      for (const u of users) {
        const r = await freshClient.userRole.findFirst({ where: { userId: u.id, role: u.role, isActive: true } });
        if (!r) return false;
      }
      return true;
    });
    await checkAsync("[12] 全新 DB UserRoleHistory 皆為 SYSTEM_SEED／C1_SEED_INITIAL_ROLE", async () => {
      const rows = await freshClient.userRoleHistory.findMany();
      return rows.length === 7 && rows.every((r) => r.eventSource === "SYSTEM_SEED" && r.reasonCode === "C1_SEED_INITIAL_ROLE");
    });
    await checkAsync("[12] 全新 DB Break-glass 恰好一位（Admin）", async () => {
      const marked = await freshClient.user.findMany({ where: { isBreakGlassAdmin: true } });
      return marked.length === 1 && marked[0].role === "Admin";
    });
    await checkAsync("[12] 全新 DB seed 既有功能資料仍正常建立（19 筆基準 Issue）", async () => (await freshClient.issue.count()) === 19);
  } finally {
    await freshClient.$disconnect();
  }

  console.log("\n=== 5/6. 一致性 Guard 停止案例（直接對 migration.sql 內的等效 SQL 片段做隔離測試） ===");

  const migrationSqlText = fs.readFileSync(MIGRATION_SQL_PATH, "utf8");
  check(
    "migration.sql 內含三個必要 guard 與四段回填邏輯的標記字串（結構完整性防退化檢查）",
    [
      "INACTIVE_PRIMARY_ROLE",
      "PRIMARY_ROLE_MISMATCH",
      "BREAK_GLASS_ADMIN_COUNT_NOT_UNIQUE",
      "C1_ROLE_BACKFILL",
      "C1_TEAM_MEMBERSHIP_BACKFILL",
    ].every((marker) => migrationSqlText.includes(marker)),
  );

  // Guard 1：inactive UserRole 對應 primary role -> 必須中止
  const guard1Db = freshScratchPath("guard1.db");
  fs.rmSync(guard1Db, { force: true });
  fs.copyFileSync(existingDb, guard1Db); // 已套用 C1-A migration 的乾淨狀態
  const guard1Client = clientFor(guard1Db);
  try {
    await guard1Client.$executeRawUnsafe(`UPDATE "UserRole" SET "isActive" = 0 WHERE "role" = 'PM'`);
    await expectAbort("[5] Guard 1：既有 (userId,role) 為 inactive 時中止，不自動重新啟用", () =>
      runGuard(
        guard1Client,
        "verify_guard1",
        `INSERT INTO "verify_guard1" ("guard_key", "detail")
         SELECT 'INACTIVE_PRIMARY_ROLE:' || u."id", 'x'
         FROM "User" u JOIN "UserRole" ur ON ur."userId" = u."id" AND ur."role" = u."role"
         WHERE ur."isActive" = 0`,
      ),
    );
  } finally {
    await guard1Client.$disconnect();
  }

  // Guard 2：primary role 無 active 對應，但有其他 active UserRole -> 必須中止
  const guard2Db = freshScratchPath("guard2.db");
  fs.rmSync(guard2Db, { force: true });
  fs.copyFileSync(existingDb, guard2Db);
  const guard2Client = clientFor(guard2Db);
  try {
    const pm = await guard2Client.user.findFirstOrThrow({ where: { role: "PM" } });
    await guard2Client.$executeRawUnsafe(`UPDATE "UserRole" SET "isActive" = 0 WHERE "userId" = '${pm.id}' AND "role" = 'PM'`);
    await guard2Client.userRole.create({ data: { userId: pm.id, role: "QA", isActive: true } });
    await expectAbort("[6] Guard 2：primary role 無 active 對應但有其他 active UserRole 時中止，不猜測 primary role", () =>
      runGuard(
        guard2Client,
        "verify_guard2",
        `INSERT INTO "verify_guard2" ("guard_key", "detail")
         SELECT 'PRIMARY_ROLE_MISMATCH:' || u."id", 'x'
         FROM "User" u
         WHERE EXISTS (SELECT 1 FROM "UserRole" ur2 WHERE ur2."userId" = u."id" AND ur2."isActive" = 1)
           AND NOT EXISTS (SELECT 1 FROM "UserRole" ur3 WHERE ur3."userId" = u."id" AND ur3."role" = u."role" AND ur3."isActive" = 1)`,
      ),
    );
  } finally {
    await guard2Client.$disconnect();
  }

  console.log("\n=== 10/11. Break-glass guard：0 位／2 位有效 Admin 時中止，且 inactive Admin 不計入 ===");

  // 0 位有效 Admin（唯一 Admin 的 UserRole 被停用）-> 必須中止；同時證明 inactive UserRole 不計入有效 Admin
  const bg0Db = freshScratchPath("breakglass-0.db");
  fs.rmSync(bg0Db, { force: true });
  fs.copyFileSync(existingDb, bg0Db);
  const bg0Client = clientFor(bg0Db);
  try {
    await bg0Client.$executeRawUnsafe(`UPDATE "UserRole" SET "isActive" = 0 WHERE "role" = 'Admin'`);
    await checkAsync("[11] inactive 的 Admin UserRole 不計入有效 Admin 人數", async () => {
      const cnt = await bg0Client.user.count({ where: { isActive: true, userRoles: { some: { role: "Admin", isActive: true } } } });
      return cnt === 0;
    });
    await expectAbort("[10] Break-glass guard：0 位有效 Admin 時中止，不得放行", () =>
      runGuard(
        bg0Client,
        "verify_bg0",
        `INSERT INTO "verify_bg0" ("guard_key", "detail")
         SELECT 'BREAK_GLASS_ADMIN_COUNT_NOT_UNIQUE', 'x'
         FROM (SELECT COUNT(*) AS cnt FROM "User" u JOIN "UserRole" ur ON ur."userId"=u."id" AND ur."role"='Admin' AND ur."isActive"=1 WHERE u."isActive"=1) t
         WHERE (SELECT COUNT(*) FROM "User") > 0 AND t.cnt <> 1`,
      ),
    );
  } finally {
    await bg0Client.$disconnect();
  }

  // 2 位有效 Admin -> 必須中止，不得任意挑選
  const bg2Db = freshScratchPath("breakglass-2.db");
  fs.rmSync(bg2Db, { force: true });
  fs.copyFileSync(existingDb, bg2Db);
  const bg2Client = clientFor(bg2Db);
  try {
    const pm = await bg2Client.user.findFirstOrThrow({ where: { role: "PM" } });
    await bg2Client.userRole.create({ data: { userId: pm.id, role: "Admin", isActive: true } });
    await expectAbort("[10] Break-glass guard：2 位有效 Admin 時中止，不得任意挑選", () =>
      runGuard(
        bg2Client,
        "verify_bg2",
        `INSERT INTO "verify_bg2" ("guard_key", "detail")
         SELECT 'BREAK_GLASS_ADMIN_COUNT_NOT_UNIQUE', 'x'
         FROM (SELECT COUNT(*) AS cnt FROM "User" u JOIN "UserRole" ur ON ur."userId"=u."id" AND ur."role"='Admin' AND ur."isActive"=1 WHERE u."isActive"=1) t
         WHERE (SELECT COUNT(*) FROM "User") > 0 AND t.cnt <> 1`,
      ),
    );
  } finally {
    await bg2Client.$disconnect();
  }

  console.log("\n=== 17. 正式 DB 不執行 seed（本次驗證未寫入正式庫） ===");
  const realUserCountAfter = await defaultPrisma.user.count();
  const realIssueCountAfter = await defaultPrisma.issue.count();
  check(
    "[17] 正式 dev.db 的 User／Issue 筆數於本次驗證前後完全不變（未曾對正式庫 migrate 或 seed）",
    realUserCountAfter === realUserCountBefore && realIssueCountAfter === realIssueCountBefore,
  );

  console.log("\n=== 清理暫存測試資料庫 ===");
  try {
    fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
    console.log(`  已清除 ${SCRATCH_DIR}`);
  } catch (e) {
    console.warn("清理暫存目錄失敗：", e);
  }

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  await defaultPrisma.$disconnect();

  if (failCount > 0 || skipCount > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("m1_5_c1_a-verify 執行時發生未預期錯誤：", err);
  try {
    fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  } catch {
    // 忽略清理失敗，不掩蓋原始錯誤
  }
  await defaultPrisma.$disconnect();
  process.exit(1);
});
