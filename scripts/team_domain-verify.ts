// Team.domain（RD/QA/OP/BUSINESS/OTHER 領域分類）驗證腳本。
//
// 涵蓋範圍：
//   - Team.domain 新增後預設 null，既有／新建 Team 不被自動猜測分類。
//   - setTeamDomain（src/lib/team-applicant/teamManagementService.ts）僅 "team.manageDomain"
//     能力持有者（目前僅 Admin）可設定，reasonCode 必填，寫入 AuditLog（fromValue/toValue/
//     reasonCode），可設回 null（清除分類），同值重複設定不重寫 AuditLog。
//   - 停用中的 Admin（User.isActive=false）不得因仍保留 UserRole="Admin" 而繞過授權。
//   - 靜態檢查：teamManagementService.ts／constants.ts 內都沒有依團隊名稱字串猜測領域的邏輯
//     （不得出現 name.includes("RD") 等樣式）。
//   - 正式 /workspaces/governance-tracker/prisma/dev.db 全程未被本腳本觸碰（前後 hash 一致）。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到本 worktree 的 prisma/dev.db。
//
// 執行方式：
//   touch /path/to/scratch.db && npx prisma migrate deploy（DATABASE_URL 指向該 scratch db）
//   DATABASE_URL="file:/path/to/scratch.db" node_modules/.bin/tsx scripts/team_domain-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { setTeamDomain, TeamManagementAccessDeniedError, TeamManagementValidationError, TeamManagementStateError } from "../src/lib/team-applicant/teamManagementService";

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

async function expectError(name: string, fn: () => Promise<unknown>, ErrCtor: new (...args: any[]) => Error) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期拋出 ${ErrCtor.name}，但實際成功）`);
  } catch (err) {
    if (err instanceof ErrCtor) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（預期 ${ErrCtor.name}，實際 ${err instanceof Error ? err.name : String(err)}）`);
    }
  }
}

// ---------------------------------------------------------------------------
// A. 靜態檢查：不得依團隊名稱字串猜測領域
// ---------------------------------------------------------------------------

function runStaticNameGuessChecks() {
  console.log("\n=== A. 靜態檢查：不得依團隊名稱猜測領域 ===");
  const files = ["src/lib/team-applicant/teamManagementService.ts", "src/lib/constants.ts"];
  const forbiddenPatterns = [/name\.includes\(/i, /name\.startsWith\(/i, /contains\(["']RD["']\)/i, /contains\(["']QA["']\)/i, /contains\(["']OP["']\)/i];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const hasForbidden = forbiddenPatterns.some((p) => p.test(content));
    check(`${file} 未依名稱字串猜測領域`, !hasForbidden);
  }
}

// ---------------------------------------------------------------------------
// B. DB 整合測試
// ---------------------------------------------------------------------------

interface Fixtures {
  userIds: string[];
  teamIds: string[];
}

async function cleanupFixtures(fx: Fixtures) {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["AuditLog", () => prisma.auditLog.deleteMany({ where: { entityType: "Team", entityId: { in: fx.teamIds } } })],
    ["Team", () => prisma.team.deleteMany({ where: { id: { in: fx.teamIds } } })],
    ["UserRole", () => prisma.userRole.deleteMany({ where: { userId: { in: fx.userIds } } })],
    ["User", () => prisma.user.deleteMany({ where: { id: { in: fx.userIds } } })],
  ];
  for (const [label, fn] of steps) {
    try {
      await fn();
    } catch (e) {
      console.warn(`cleanup ${label} 失敗：`, e);
    }
  }
}

async function runDbTests(fx: Fixtures) {
  console.log("\n=== B. DB 整合測試 ===");

  const admin = await prisma.user.create({ data: { name: `TDV-Admin-${Date.now()}`, email: `tdv-admin-${Date.now()}@example.com`, role: "Admin", isActive: true } });
  fx.userIds.push(admin.id);
  await prisma.userRole.create({ data: { userId: admin.id, role: "Admin", isActive: true } });

  const disabledAdmin = await prisma.user.create({
    data: { name: `TDV-DisabledAdmin-${Date.now()}`, email: `tdv-disabled-admin-${Date.now()}@example.com`, role: "Admin", isActive: false },
  });
  fx.userIds.push(disabledAdmin.id);
  await prisma.userRole.create({ data: { userId: disabledAdmin.id, role: "Admin", isActive: true } });

  const rdUser = await prisma.user.create({ data: { name: `TDV-RD-${Date.now()}`, email: `tdv-rd-${Date.now()}@example.com`, role: "RD", isActive: true } });
  fx.userIds.push(rdUser.id);
  await prisma.userRole.create({ data: { userId: rdUser.id, role: "RD", isActive: true } });

  const team = await prisma.team.create({ data: { name: `TDV-Team-${Date.now()}`, description: "" } });
  fx.teamIds.push(team.id);

  await checkAsync("[1] 新建 Team 預設 domain=null（不猜測分類）", async () => {
    const fresh = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    return fresh.domain === null;
  });

  await checkAsync("[2] Admin 設定 domain=RD 成功", async () => {
    const updated = await setTeamDomain({ teamId: team.id, domain: "RD", actorId: admin.id, reasonCode: "VERIFY_CLASSIFY_RD" });
    return updated.domain === "RD";
  });

  await checkAsync("[3] AuditLog 正確記錄 fromValue/toValue/reasonCode", async () => {
    const log = await prisma.auditLog.findFirst({
      where: { entityType: "Team", entityId: team.id, actionType: "TeamDomainChanged" },
      orderBy: { createdAt: "desc" },
    });
    return !!log && log.fromValue === null && log.toValue === "RD" && log.reasonCode === "VERIFY_CLASSIFY_RD" && log.actorUserId === admin.id;
  });

  await expectError(
    "[4] 非 Admin（RD 角色）設定 domain 被拒絕",
    () => setTeamDomain({ teamId: team.id, domain: "QA", actorId: rdUser.id, reasonCode: "SHOULD_FAIL" }),
    TeamManagementAccessDeniedError,
  );

  await expectError(
    "[5] 已停用 Admin（User.isActive=false）不得繞過授權",
    () => setTeamDomain({ teamId: team.id, domain: "QA", actorId: disabledAdmin.id, reasonCode: "SHOULD_FAIL" }),
    TeamManagementAccessDeniedError,
  );

  await expectError(
    "[6] 空白 reasonCode 被拒絕",
    () => setTeamDomain({ teamId: team.id, domain: "QA", actorId: admin.id, reasonCode: "" }),
    TeamManagementValidationError,
  );

  await expectError(
    "[7] 非法 domain 值被拒絕",
    () => setTeamDomain({ teamId: team.id, domain: "FOO" as any, actorId: admin.id, reasonCode: "SHOULD_FAIL" }),
    TeamManagementValidationError,
  );

  await expectError(
    "[8] 不存在的 teamId 被拒絕",
    () => setTeamDomain({ teamId: "nonexistent-team-id", domain: "RD", actorId: admin.id, reasonCode: "SHOULD_FAIL" }),
    TeamManagementStateError,
  );

  await checkAsync("[9] 重複設定同值不新增 AuditLog", async () => {
    const before = await prisma.auditLog.count({ where: { entityType: "Team", entityId: team.id, actionType: "TeamDomainChanged" } });
    await setTeamDomain({ teamId: team.id, domain: "RD", actorId: admin.id, reasonCode: "NO_OP_CHECK" });
    const after = await prisma.auditLog.count({ where: { entityType: "Team", entityId: team.id, actionType: "TeamDomainChanged" } });
    return before === after;
  });

  await checkAsync("[10] 可設回 null（清除分類），並寫入 AuditLog", async () => {
    const before = await prisma.auditLog.count({ where: { entityType: "Team", entityId: team.id, actionType: "TeamDomainChanged" } });
    const updated = await setTeamDomain({ teamId: team.id, domain: null, actorId: admin.id, reasonCode: "CLEAR_CLASSIFICATION" });
    const after = await prisma.auditLog.count({ where: { entityType: "Team", entityId: team.id, actionType: "TeamDomainChanged" } });
    const log = await prisma.auditLog.findFirst({
      where: { entityType: "Team", entityId: team.id, actionType: "TeamDomainChanged" },
      orderBy: { createdAt: "desc" },
    });
    return updated.domain === null && after === before + 1 && log?.fromValue === "RD" && log?.toValue === null;
  });

  await checkAsync("[11] Team_domain_idx 索引可用（依 domain 查詢不報錯）", async () => {
    const rows = await prisma.team.findMany({ where: { domain: "RD" } });
    return Array.isArray(rows);
  });
}

async function main() {
  console.log("=== Team.domain 驗證 ===");

  const officialDevDb = "/workspaces/governance-tracker/prisma/dev.db";
  const beforeHash = fs.existsSync(officialDevDb) ? crypto.createHash("sha256").update(fs.readFileSync(officialDevDb)).digest("hex") : null;

  runStaticNameGuessChecks();

  const fx: Fixtures = { userIds: [], teamIds: [] };
  try {
    await runDbTests(fx);
  } finally {
    await cleanupFixtures(fx);
  }

  const afterHash = fs.existsSync(officialDevDb) ? crypto.createHash("sha256").update(fs.readFileSync(officialDevDb)).digest("hex") : null;
  check("[12] 正式 /workspaces/governance-tracker/prisma/dev.db 全程未被本腳本觸碰", beforeHash === afterHash, `before=${beforeHash} after=${afterHash}`);

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} ===`);

  await prisma.$disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("team_domain-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
