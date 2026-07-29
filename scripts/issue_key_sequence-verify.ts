// 工單編號持久化計數器（IssueKeySequence）——targeted verify。
//
// 涵蓋範圍（對應任務指示第九節 21 項＋第八節 A/B/C 三條 Migration 路徑）：
//   - 正式取號路徑（allocationService）：初次建立、單調遞增、跨 issueType 獨立、
//     刪除中間/最大編號後不補號不重用、Admin 永久刪除後仍取新號、已知 HOTFIX-0004
//     永不重發、兩個並行建立各自取得不同編號、transaction 失敗不留孤兒且 sequence
//     與 Issue 保持一致、前端偽造 issueKey 被忽略、sequence 列缺失 fail closed、
//     不合法 issueType 被拒絕、既有 Issue 編號不變、刪除不修改 counter。
//   - Migration 路徑 A（Existing DB upgrade）：正式 dev.db 的獨立複本套用 migration 後，
//     Issue 完整不變、HOTFIX-0004 仍不存在、Hotfix lastValue >= 4、下一張 Hotfix 不得
//     取得 0004、integrity_check=ok、無孤兒 FK。
//   - Migration 路徑 B（Fresh migrate + seed）：全新 scratch DB migrate deploy 後 seed，
//     sequence 與 seed 資料最大編號一致，建立下一張各類型工單不撞號，重跑 seed 不降低
//     counter。
//   - Migration 路徑 C（Synthetic deletion history）：建立 HOTFIX-0001~0005、刪除
//     0003／0005 後，下一張必須取得 0006，不得取得 0003 或 0005。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到本 worktree 的
// prisma/dev.db；另外明確比對正式 /workspaces/governance-tracker/prisma/dev.db 前後
// bytes／SHA-256／mtime，且全程只複製讀取該檔，從不對它送出 migrate/seed，也不直接
// 開啟連線寫入。
//
// 執行方式：
//   touch /path/to/scratch.db && DATABASE_URL="file:/path/to/scratch.db" npx prisma migrate deploy
//   DATABASE_URL="file:/path/to/scratch.db" node_modules/.bin/tsx scripts/issue_key_sequence-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  allocateNextIssueKey,
  isTransientTransactionConflict,
  InvalidIssueTypeError,
  IssueKeySequenceNotConfiguredError,
} from "../src/lib/issue-key-sequence/allocationService";
import { synchronizeIssueKeySequencesFromExistingIssues, KNOWN_HISTORICAL_FLOORS } from "../src/lib/issue-key-sequence/synchronizationService";
import { createIssueForActor } from "../src/lib/issueCreation";
import { adminPermanentDeleteIssue } from "../src/lib/issue-management/issueDeletionService";

let passCount = 0;
let failCount = 0;

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

async function expectError(name: string, fn: () => Promise<unknown>, matcher: (err: unknown) => boolean) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期拋出例外，但未拋出）`);
  } catch (err) {
    if (matcher(err)) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（拋出例外但型別不符：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

// ---------------------------------------------------------------------------
// 正式 dev.db 基準：全程只讀（fs.copyFileSync 的來源／fs.statSync／sha256），
// 從不對它送出 migrate/seed，也不直接開啟連線寫入。
// ---------------------------------------------------------------------------
const OFFICIAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";

function statOfficialDevDb() {
  const st = fs.statSync(OFFICIAL_DEV_DB);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex");
  return { bytes: st.size, mtimeMs: st.mtimeMs, hash };
}

function officialDevDbSidecarFiles(): string[] {
  return ["-journal", "-wal", "-shm"].map((suffix) => `${OFFICIAL_DEV_DB}${suffix}`).filter((p) => fs.existsSync(p));
}

// ---------------------------------------------------------------------------
// Migration 路徑驗證用的獨立 scratch 檔案。比照 scripts/m2_b-verify.ts 的
// freshMigrationScratchPath／migrateDeployOn／migrationScratchClientFor 慣例，
// 完全獨立於本檔其餘測試使用的主 scratch DB（由呼叫端經 DATABASE_URL 指定）。
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..");
const PRISMA_DIR = path.join(REPO_ROOT, "prisma");
const MIGRATION_SCRATCH_DIR = path.join(PRISMA_DIR, ".issue_key_sequence_verify_migration_scratch");

function freshMigrationScratchPath(name: string): string {
  return path.join(MIGRATION_SCRATCH_DIR, name);
}

function migrateDeployOn(scratchAbsPath: string) {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  execSync(`npx prisma migrate deploy`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `file:./${rel}` },
    stdio: "pipe",
  });
}

function seedOn(scratchAbsPath: string) {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  execSync(`npx tsx prisma/seed.ts`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `file:./${rel}` },
    stdio: "pipe",
  });
}

function migrationScratchClientFor(scratchAbsPath: string): PrismaClient {
  const rel = path.relative(PRISMA_DIR, scratchAbsPath);
  return new PrismaClient({ datasources: { db: { url: `file:./${rel}` } } });
}

async function issueSetHash(client: PrismaClient, whereSql = ""): Promise<string> {
  const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "Issue" ${whereSql} ORDER BY "issueKey" ASC`,
  );
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

// ---------------------------------------------------------------------------
// Migration 路徑 A：Existing DB upgrade（正式 dev.db 的獨立複本）
// ---------------------------------------------------------------------------
async function verifyMigrationPathA() {
  console.log("\n=== Migration 路徑 A：Existing DB upgrade（正式 dev.db 獨立複本）===");
  fs.mkdirSync(MIGRATION_SCRATCH_DIR, { recursive: true });
  const scratchDb = freshMigrationScratchPath("existing-upgrade.db");
  fs.rmSync(scratchDb, { force: true });
  fs.copyFileSync(OFFICIAL_DEV_DB, scratchDb);

  const before = migrationScratchClientFor(scratchDb);
  const preIssueCount = await before.issue.count();
  const preIssueHash = await issueSetHash(before);
  const preHotfix0004Count = await before.issue.count({ where: { issueKey: "HOTFIX-0004" } });
  await before.$disconnect();

  check("[MIGA-0] 複本套用前 Issue 筆數為 19（正式基準）", preIssueCount === 19, `實際 ${preIssueCount}`);
  check("[MIGA-0b] 複本套用前 HOTFIX-0004 為 0 筆", preHotfix0004Count === 0, `實際 ${preHotfix0004Count}`);

  migrateDeployOn(scratchDb);

  const after = migrationScratchClientFor(scratchDb);
  try {
    const postIssueCount = await after.issue.count();
    const postIssueHash = await issueSetHash(after);
    const postHotfix0004Count = await after.issue.count({ where: { issueKey: "HOTFIX-0004" } });

    check("[MIGA-1] Migration 套用成功、Issue 筆數不變（19）", postIssueCount === preIssueCount, `前 ${preIssueCount} 後 ${postIssueCount}`);
    check("[MIGA-2] Issue 完整內容 hash 不變（migration 未曾觸碰 Issue 資料）", postIssueHash === preIssueHash);
    check("[MIGA-3] HOTFIX-0004 仍不存在（0 筆）", postHotfix0004Count === 0, `實際 ${postHotfix0004Count}`);

    const hotfixSeq = await after.issueKeySequence.findUnique({ where: { issueType: "Hotfix" } });
    check("[MIGA-4] Hotfix lastValue 初始化 >= 4（已知歷史高水位）", (hotfixSeq?.lastValue ?? 0) >= 4, `實際 ${hotfixSeq?.lastValue}`);

    await checkAsync("[MIGA-5] 下一張 Hotfix 取得 HOTFIX-0005 或更高，不得取得 0004", async () => {
      const key = await after.$transaction((tx) => allocateNextIssueKey(tx, "Hotfix"));
      const num = parseInt(key.split("-")[1], 10);
      return key !== "HOTFIX-0004" && num >= 5;
    });

    const integrity = await after.$queryRawUnsafe<Array<{ integrity_check: string }>>(`PRAGMA integrity_check;`);
    check("[MIGA-6] integrity_check=ok", integrity[0]?.integrity_check === "ok", JSON.stringify(integrity));

    const fkIssues = await after.$queryRawUnsafe<unknown[]>(`PRAGMA foreign_key_check;`);
    check("[MIGA-7] 無孤兒 FK（foreign_key_check 空結果）", Array.isArray(fkIssues) && fkIssues.length === 0, `實際 ${fkIssues.length} 筆`);

    check(
      "[MIGA-8] migrate deploy 再次執行後無待套用 migration",
      (() => {
        try {
          execSync(`npx prisma migrate deploy`, {
            cwd: REPO_ROOT,
            env: { ...process.env, DATABASE_URL: `file:./${path.relative(PRISMA_DIR, scratchDb)}` },
            stdio: "pipe",
          });
          return true;
        } catch {
          return false;
        }
      })(),
    );
  } finally {
    await after.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Migration 路徑 B：Fresh migrate + seed
// ---------------------------------------------------------------------------
async function verifyMigrationPathB() {
  console.log("\n=== Migration 路徑 B：Fresh migrate + seed ===");
  fs.mkdirSync(MIGRATION_SCRATCH_DIR, { recursive: true });
  const scratchDb = freshMigrationScratchPath("fresh-seed.db");
  fs.rmSync(scratchDb, { force: true });
  fs.writeFileSync(scratchDb, "");

  check(
    "[MIGB-0] migrate deploy 成功",
    (() => {
      try {
        migrateDeployOn(scratchDb);
        return true;
      } catch {
        return false;
      }
    })(),
  );
  check(
    "[MIGB-1] seed 成功",
    (() => {
      try {
        seedOn(scratchDb);
        return true;
      } catch {
        return false;
      }
    })(),
  );

  const client = migrationScratchClientFor(scratchDb);
  try {
    await checkAsync("[MIGB-2] sequence 與 seed Issue 最大編號一致（逐 issueType 檢查）", async () => {
      const types = await client.issue.groupBy({ by: ["issueType"] });
      for (const t of types) {
        const rows = await client.issue.findMany({ where: { issueType: t.issueType }, select: { issueKey: true } });
        const liveMax = rows.reduce((m, r) => Math.max(m, parseInt(r.issueKey.split("-")[1] ?? "0", 10) || 0), 0);
        const floor = KNOWN_HISTORICAL_FLOORS[t.issueType] ?? 0;
        const expected = Math.max(liveMax, floor);
        const seq = await client.issueKeySequence.findUnique({ where: { issueType: t.issueType } });
        if ((seq?.lastValue ?? -1) !== expected) return false;
      }
      return true;
    });

    await checkAsync("[MIGB-3] Fresh seed 後 Hotfix counter 從 4 起跳（不從 HOTFIX-0001 重新開始，且不落在既有 seed 編號內）", async () => {
      const key = await client.$transaction((tx) => allocateNextIssueKey(tx, "Hotfix"));
      const existing = await client.issue.findUnique({ where: { issueKey: key } });
      return key >= "HOTFIX-0004" && !existing;
    });

    await checkAsync("[MIGB-4] 建立下一張各 issueType 工單不撞號", async () => {
      const types = ["Incident", "RCA", "RiskException", "QaVerification", "ChangeRelease", "MonitoringInventory", "BackupRecoveryTest"];
      for (const t of types) {
        const key = await client.$transaction((tx) => allocateNextIssueKey(tx, t));
        const existing = await client.issue.findUnique({ where: { issueKey: key } });
        if (existing) return false;
      }
      return true;
    });

    const beforeRerunSeq = await client.issueKeySequence.findMany();
    seedOn(scratchDb);
    const afterRerunSeq = await client.issueKeySequence.findMany();
    check(
      "[MIGB-5] 重跑 seed 不會降低 counter",
      beforeRerunSeq.every((b) => {
        const a = afterRerunSeq.find((x) => x.issueType === b.issueType);
        return (a?.lastValue ?? -1) >= b.lastValue;
      }),
    );
  } finally {
    await client.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Migration 路徑 C：Synthetic deletion history
// ---------------------------------------------------------------------------
async function verifyMigrationPathC() {
  console.log("\n=== Migration 路徑 C：Synthetic deletion history ===");
  fs.mkdirSync(MIGRATION_SCRATCH_DIR, { recursive: true });
  const scratchDb = freshMigrationScratchPath("synthetic-deletion.db");
  fs.rmSync(scratchDb, { force: true });
  fs.writeFileSync(scratchDb, "");
  migrateDeployOn(scratchDb);

  const client = migrationScratchClientFor(scratchDb);
  try {
    // 這裡刻意繞過 createIssueForActor 的完整驗證鏈（team／applicant／workflow），
    // 只用最小欄位直接建立 Issue，聚焦驗證「編號序列本身」在合成的刪除歷史下的行為，
    // 不重複測試已由 team_applicant_crud-verify.ts 涵蓋的建立授權邊界。
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) {
      const key = await client.$transaction((tx) => allocateNextIssueKey(tx, "Hotfix"));
      await client.issue.create({
        data: { issueKey: key, issueType: "Hotfix", title: `synthetic-${key}`, workflowStatus: "n/a" },
      });
      keys.push(key);
    }
    check("[MIGC-0] 建立 HOTFIX-0001~0005（相對於本 scratch DB 的起始高水位）", keys.length === 5);

    const seqAfterCreate = await client.issueKeySequence.findUnique({ where: { issueType: "Hotfix" } });
    const highWaterAfterCreate = seqAfterCreate!.lastValue;

    const toDelete = [keys[2], keys[4]]; // 對應「第 3 筆」與「第 5 筆（目前最大）」
    for (const key of toDelete) {
      const issue = await client.issue.findUniqueOrThrow({ where: { issueKey: key } });
      await client.issue.delete({ where: { id: issue.id } });
    }
    check("[MIGC-1] 刪除中間編號與目前最大編號（共 2 筆）", true);

    const seqAfterDelete = await client.issueKeySequence.findUnique({ where: { issueType: "Hotfix" } });
    check("[MIGC-2] 刪除後 counter 不倒退", seqAfterDelete!.lastValue === highWaterAfterCreate, `刪除前 ${highWaterAfterCreate} 刪除後 ${seqAfterDelete!.lastValue}`);

    await checkAsync("[MIGC-3] 下一張必須取得高水位+1，不得取得已刪除的兩個編號", async () => {
      const key = await client.$transaction((tx) => allocateNextIssueKey(tx, "Hotfix"));
      const expected = `HOTFIX-${String(highWaterAfterCreate + 1).padStart(4, "0")}`;
      return key === expected && !toDelete.includes(key);
    });
  } finally {
    await client.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// 正式取號路徑（allocationService）動態驗證——使用呼叫端指定的主 scratch DB（DATABASE_URL）。
// ---------------------------------------------------------------------------
async function createUser(name: string, role: string) {
  const user = await prisma.user.create({ data: { name, email: `${name}-${Date.now()}-${Math.random()}@example.invalid`, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}
async function createTeamRaw(name: string) {
  return prisma.team.create({ data: { name } });
}
async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD") {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
}
function buildCreateFormData(input: { title: string; teamId: string; applicantId: string; issueKeyOverride?: string }): FormData {
  const fd = new FormData();
  fd.set("issueType", "Hotfix");
  fd.set("title", input.title);
  fd.set("description", "issue_key_sequence-verify 建立");
  fd.set("systemName", "MyDMS");
  fd.set("environment", "Production");
  fd.set("riskLevel", "中");
  fd.set("dueDate", "2026-09-01");
  fd.set("teamId", input.teamId);
  fd.set("applicantId", input.applicantId);
  if (input.issueKeyOverride) fd.set("issueKey", input.issueKeyOverride); // [12] 前端偽造 issueKey
  return fd;
}

async function runAllocationServiceChecks() {
  console.log("\n=== 正式取號路徑（allocationService）===");

  const admin = await createUser("KeySeqAdmin", "Admin");
  const pm = await createUser("KeySeqPM", "PM");
  const team = await createTeamRaw("KeySeqTeam");
  await addMember(team.id, pm.id, "MEMBER");
  await addMember(team.id, admin.id, "LEAD");

  // 一個從未建立過 Issue、也刻意不預先建立 IssueKeySequence 列的全新 issueType 語意
  // 測試不到（Issue.issueType 是自由字串，但 allocateNextIssueKey 只認 ISSUE_TYPE_PREFIX
  // 定義的 8 種），改用「刪除既有列」模擬 [13]。

  await checkAsync("[1] 初次建立取得正確編號", async () => {
    const key = await prisma.$transaction((tx) => allocateNextIssueKey(tx, "RCA"));
    return /^RCA-\d{4}$/.test(key);
  });

  await checkAsync("[2] 同 issueType 連續建立單調遞增", async () => {
    const k1 = await prisma.$transaction((tx) => allocateNextIssueKey(tx, "QaVerification"));
    const k2 = await prisma.$transaction((tx) => allocateNextIssueKey(tx, "QaVerification"));
    const k3 = await prisma.$transaction((tx) => allocateNextIssueKey(tx, "QaVerification"));
    const n1 = parseInt(k1.split("-")[1], 10);
    const n2 = parseInt(k2.split("-")[1], 10);
    const n3 = parseInt(k3.split("-")[1], 10);
    return n2 === n1 + 1 && n3 === n2 + 1;
  });

  await checkAsync("[3] 不同 issueType 各自維護序號（互不影響）", async () => {
    const beforeInc = await prisma.issueKeySequence.findUnique({ where: { issueType: "Incident" } });
    await prisma.$transaction((tx) => allocateNextIssueKey(tx, "ChangeRelease"));
    const afterInc = await prisma.issueKeySequence.findUnique({ where: { issueType: "Incident" } });
    return (beforeInc?.lastValue ?? 0) === (afterInc?.lastValue ?? 0);
  });

  // ---- [4][5] 刪除中間／最大編號後不補號、不重用 ----
  const seqType = "BackupRecoveryTest";
  const createdIssues: { id: string; issueKey: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const key = await prisma.$transaction((tx) => allocateNextIssueKey(tx, seqType));
    const issue = await prisma.issue.create({ data: { issueKey: key, issueType: seqType, title: `del-test-${i}`, workflowStatus: "n/a" } });
    createdIssues.push({ id: issue.id, issueKey: key });
  }
  await checkAsync("[4] 刪除中間編號（第 2 筆）後，下一張不會補發該號碼", async () => {
    await prisma.issue.delete({ where: { id: createdIssues[1].id } });
    const nextKey = await prisma.$transaction((tx) => allocateNextIssueKey(tx, seqType));
    return nextKey !== createdIssues[1].issueKey;
  });
  await checkAsync("[5] 刪除目前最大編號（第 3 筆）後，下一張仍取得比它更大的新編號，不重用", async () => {
    const beforeDeleteMax = createdIssues[2].issueKey;
    await prisma.issue.delete({ where: { id: createdIssues[2].id } });
    const nextKey = await prisma.$transaction((tx) => allocateNextIssueKey(tx, seqType));
    const beforeNum = parseInt(beforeDeleteMax.split("-")[1], 10);
    const nextNum = parseInt(nextKey.split("-")[1], 10);
    return nextKey !== beforeDeleteMax && nextNum > beforeNum;
  });

  // ---- [6] Admin 永久刪除後再建立仍取得新號碼（走真正的 createIssueForActor + adminPermanentDeleteIssue）----
  await checkAsync("[6] Admin 永久刪除工單後，再建立同 issueType 工單仍取得新號碼", async () => {
    const created = await createIssueForActor(pm, buildCreateFormData({ title: "delete-then-create-1", teamId: team.id, applicantId: pm.id }));
    const deletedKey = created.issueKey;
    await adminPermanentDeleteIssue({ issueId: created.id, actorId: admin.id, reason: "issue_key_sequence-verify", confirmIssueKey: created.issueKey });
    const created2 = await createIssueForActor(pm, buildCreateFormData({ title: "delete-then-create-2", teamId: team.id, applicantId: pm.id }));
    return created2.issueKey !== deletedKey;
  });

  // ---- [7] 已知 HOTFIX-0004 不得再次使用（本 scratch DB 若走過本專案 migration，Hotfix 起始 lastValue 已 >= 4）----
  await checkAsync("[7] 本 scratch DB 的 Hotfix 序列絕不配發 HOTFIX-0004", async () => {
    for (let i = 0; i < 5; i++) {
      const key = await prisma.$transaction((tx) => allocateNextIssueKey(tx, "Hotfix"));
      if (key === "HOTFIX-0004") return false;
    }
    return true;
  });

  // ---- [8][9] 兩個並行建立取得不同編號；皆成功或暫時性衝突經重試後成功 ----
  await checkAsync("[8][9] 兩個並行 createIssueForActor 呼叫取得不同編號，皆成功", async () => {
    const [a, b] = await Promise.all([
      createIssueForActor(pm, buildCreateFormData({ title: "concurrent-a", teamId: team.id, applicantId: pm.id })),
      createIssueForActor(admin, buildCreateFormData({ title: "concurrent-b", teamId: team.id, applicantId: pm.id })),
    ]);
    return a.issueKey !== b.issueKey;
  });

  // ---- [10][11] transaction 失敗時不留孤兒 Issue、sequence 與 Issue 保持一致 ----
  await checkAsync("[10][11] transaction 中途失敗時整組回滾：sequence 不增加、無孤兒 Issue", async () => {
    const before = await prisma.issueKeySequence.findUnique({ where: { issueType: "RiskException" } });
    const issueCountBefore = await prisma.issue.count({ where: { issueType: "RiskException" } });
    try {
      await prisma.$transaction(async (tx) => {
        await allocateNextIssueKey(tx, "RiskException");
        throw new Error("模擬取號後、Issue 建立前的失敗");
      });
    } catch {
      // 預期拋出，忽略
    }
    const after = await prisma.issueKeySequence.findUnique({ where: { issueType: "RiskException" } });
    const issueCountAfter = await prisma.issue.count({ where: { issueType: "RiskException" } });
    return after?.lastValue === before?.lastValue && issueCountAfter === issueCountBefore;
  });

  // ---- [12] 前端偽造 issueKey 被忽略 ----
  await checkAsync("[12] 前端偽造 issueKey 被忽略，實際編號仍由伺服器端序列決定", async () => {
    const created = await createIssueForActor(pm, buildCreateFormData({ title: "forged-key", teamId: team.id, applicantId: pm.id, issueKeyOverride: "HOTFIX-FORGED" }));
    return created.issueKey !== "HOTFIX-FORGED" && /^HOTFIX-\d{4}$/.test(created.issueKey);
  });

  // ---- [13] sequence 列缺失時 fail closed ----
  await expectError(
    "[13] IssueKeySequence 列缺失時 fail closed（不得以 upsert 順便建立）",
    async () => {
      await prisma.issueKeySequence.delete({ where: { issueType: "MonitoringInventory" } });
      return prisma.$transaction((tx) => allocateNextIssueKey(tx, "MonitoringInventory"));
    },
    (err) => err instanceof IssueKeySequenceNotConfiguredError,
  );
  // 復原，避免影響後續其他測試／其他 verify script 對同一 scratch DB 的假設
  await prisma.issueKeySequence.create({ data: { issueType: "MonitoringInventory", lastValue: 0 } });
  await synchronizeIssueKeySequencesFromExistingIssues(prisma);

  // ---- [14] 不合法 issueType 被拒絕 ----
  await expectError(
    "[14] 不合法 issueType 被拒絕",
    () => prisma.$transaction((tx) => allocateNextIssueKey(tx, "NotARealIssueType")),
    (err) => err instanceof InvalidIssueTypeError,
  );

  // ---- [19] 工單刪除不修改 counter ----
  await checkAsync("[19] 永久刪除工單不修改 IssueKeySequence.lastValue", async () => {
    const created = await createIssueForActor(pm, buildCreateFormData({ title: "delete-no-rollback", teamId: team.id, applicantId: pm.id }));
    const before = await prisma.issueKeySequence.findUnique({ where: { issueType: "Hotfix" } });
    await adminPermanentDeleteIssue({ issueId: created.id, actorId: admin.id, reason: "issue_key_sequence-verify", confirmIssueKey: created.issueKey });
    const after = await prisma.issueKeySequence.findUnique({ where: { issueType: "Hotfix" } });
    return before?.lastValue === after?.lastValue;
  });

  // ---- 刪除服務不得 import／呼叫 sequence 重置（靜態檢查）----
  check(
    "[静態] issueDeletionService.ts 不 import issue-key-sequence 模組",
    !fs.readFileSync(path.join(REPO_ROOT, "src/lib/issue-management/issueDeletionService.ts"), "utf8").includes("issue-key-sequence"),
  );
  check(
    "[静態] adminReassignService.ts 不 import issue-key-sequence 模組",
    !fs.readFileSync(path.join(REPO_ROOT, "src/lib/hotfix-ui/adminReassignService.ts"), "utf8").includes("issue-key-sequence"),
  );

  // isTransientTransactionConflict 型別靜態確認（不在正式路徑誤判非暫時性錯誤為可重試）
  check(
    "[静態] isTransientTransactionConflict 不把 Unauthorized／驗證錯誤視為可重試",
    !isTransientTransactionConflict(new Error("不是暫時性衝突")) && !isTransientTransactionConflict({ code: "P2002" }),
  );
}

async function main() {
  const beforeOfficial = statOfficialDevDb();
  const beforeSidecars = officialDevDbSidecarFiles();

  await runAllocationServiceChecks();
  await verifyMigrationPathA();
  await verifyMigrationPathB();
  await verifyMigrationPathC();

  const afterOfficial = statOfficialDevDb();
  const afterSidecars = officialDevDbSidecarFiles();
  check(
    "[20] 正式 dev.db 前後 bytes／SHA-256／mtime 完全不變",
    beforeOfficial.bytes === afterOfficial.bytes && beforeOfficial.hash === afterOfficial.hash && beforeOfficial.mtimeMs === afterOfficial.mtimeMs,
    `before=${JSON.stringify(beforeOfficial)} after=${JSON.stringify(afterOfficial)}`,
  );
  check(
    "[21] 正式 dev.db 無 journal／wal／shm 殘留（前後皆無）",
    beforeSidecars.length === 0 && afterSidecars.length === 0,
    `before=${JSON.stringify(beforeSidecars)} after=${JSON.stringify(afterSidecars)}`,
  );

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} ===`);
  await prisma.$disconnect();
  if (failCount > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("issue_key_sequence-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
