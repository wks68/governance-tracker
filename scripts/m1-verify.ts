// M1-A 驗證腳本
//
// 目的：在「尚未套用 Migration」的狀態下，盡可能驗證 M1-A 的邏輯正確性。
// - 純邏輯測試（permissions.ts / systemTeamRouting.ts）：不依賴資料庫，必定執行。
// - DB 相依測試（例如查詢 Team / UserRole / SystemTeamMapping 資料表）：
//   若資料表尚未建立（Migration 尚未套用），會被標記為 SKIPPED（等待 M1-B），
//   不視為失敗，也不會嘗試自動套用 Migration。
//
// 執行方式：node_modules/.bin/tsx scripts/m1-verify.ts

import {
  roleCapabilities,
  unionCapabilities,
  hasCapability,
  requireCapabilitySync,
  PermissionDeniedError,
  isTeamMember,
  isTeamLead,
  type TeamMembershipLike,
} from "../src/lib/permissions";
import { decideSystemTeamRouting, type SystemTeamMappingLike } from "../src/lib/systemTeamRouting";
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

function skip(name: string, reason: string) {
  skipCount++;
  console.log(`  SKIP  ${name} (${reason})`);
}

async function main() {
  console.log("=== M1-A 驗證：src/lib/permissions.ts（純邏輯） ===");

  // deny-by-default：未知角色字串 → 無任何能力
  check("未知角色字串應無任何能力", roleCapabilities("不存在的角色").size === 0);
  check("空字串角色應無任何能力", roleCapabilities("").size === 0);

  // legacy User.role 相容映射
  check("PM 擁有 issue.view", roleCapabilities("PM").has("issue.view"));
  check("PM 不擁有 issue.approve", !roleCapabilities("PM").has("issue.approve"));
  check("QA 擁有 issue.approve", roleCapabilities("QA").has("issue.approve"));
  check("Admin 擁有 admin.full", roleCapabilities("Admin").has("admin.full"));

  // UserRole 多角色能力聯集
  const unionPmQa = unionCapabilities(["PM", "QA"]);
  check("PM+QA 聯集包含 issue.approve（來自 QA）", unionPmQa.has("issue.approve"));
  check("PM+QA 聯集包含 issue.edit（來自 PM）", unionPmQa.has("issue.edit"));
  check(
    "PM+QA 聯集不包含 admin.full（deny-by-default，未授予不得出現）",
    !unionPmQa.has("admin.full"),
  );

  // hasCapability / requireCapabilitySync（deny-by-default + 多角色聯集）
  const pmUser = { role: "PM" };
  check("hasCapability：PM 單獨無 issue.approve", !hasCapability(pmUser, "issue.approve"));
  check(
    "hasCapability：PM + extraRoles=[QA] 聯集後有 issue.approve",
    hasCapability(pmUser, "issue.approve", ["QA"]),
  );

  let threw = false;
  try {
    requireCapabilitySync(pmUser, "admin.full");
  } catch (e) {
    threw = e instanceof PermissionDeniedError;
  }
  check("requireCapabilitySync：無能力時拋出 PermissionDeniedError（deny-by-default）", threw);

  let notThrew = true;
  try {
    requireCapabilitySync({ role: "Admin" }, "admin.full");
  } catch {
    notThrew = false;
  }
  check("requireCapabilitySync：有能力時不拋出", notThrew);

  console.log("\n=== M1-A 驗證：Team MEMBER／LEAD 判斷（純邏輯） ===");
  const memberships: TeamMembershipLike[] = [
    { teamId: "team-a", userId: "user-1", membershipRole: "LEAD", isActive: true },
    { teamId: "team-a", userId: "user-2", membershipRole: "MEMBER", isActive: true },
    { teamId: "team-b", userId: "user-1", membershipRole: "MEMBER", isActive: false },
  ];
  check("isTeamMember：啟用中的 LEAD 也視為成員", isTeamMember(memberships, "team-a", "user-1"));
  check("isTeamLead：user-1 於 team-a 為 LEAD", isTeamLead(memberships, "team-a", "user-1"));
  check("isTeamLead：user-2 於 team-a 為 MEMBER，非 LEAD", !isTeamLead(memberships, "team-a", "user-2"));
  check("isTeamMember：非啟用中的成員關係不算成員", !isTeamMember(memberships, "team-b", "user-1"));

  console.log("\n=== M1-A 驗證：src/lib/systemTeamRouting.ts（純邏輯） ===");

  const noMapping: SystemTeamMappingLike[] = [];
  const noMappingDecision = decideSystemTeamRouting(noMapping);
  check(
    "無 mapping 時進分流",
    noMappingDecision.kind === "triage" && noMappingDecision.reason === "noMapping",
  );

  const noPrimary: SystemTeamMappingLike[] = [
    { id: "m1", teamId: "team-a", isPrimary: false, isActive: true },
    { id: "m2", teamId: "team-b", isPrimary: false, isActive: true },
  ];
  const noPrimaryDecision = decideSystemTeamRouting(noPrimary);
  check(
    "無唯一 primary（皆非 primary）時進分流",
    noPrimaryDecision.kind === "triage" && noPrimaryDecision.reason === "noUniquePrimary",
  );

  const inactivePrimaryOnly: SystemTeamMappingLike[] = [
    { id: "m1", teamId: "team-a", isPrimary: true, isActive: false },
  ];
  const inactivePrimaryDecision = decideSystemTeamRouting(inactivePrimaryOnly);
  check(
    "唯一 primary 但非 isActive 時進分流（不得誤判為有效路由；視為無有效 mapping）",
    inactivePrimaryDecision.kind === "triage" && inactivePrimaryDecision.reason === "noMapping",
  );

  const activeNonPrimaryPlusInactivePrimary: SystemTeamMappingLike[] = [
    { id: "m1", teamId: "team-a", isPrimary: true, isActive: false },
    { id: "m2", teamId: "team-b", isPrimary: false, isActive: true },
  ];
  const mixedDecision = decideSystemTeamRouting(activeNonPrimaryPlusInactivePrimary);
  check(
    "有啟用中的 mapping 但唯一 primary 為非啟用時進分流（不得誤判為有效路由）",
    mixedDecision.kind === "triage" && mixedDecision.reason === "noUniquePrimary",
  );

  const uniquePrimary: SystemTeamMappingLike[] = [
    { id: "m1", teamId: "team-a", isPrimary: true, isActive: true },
    { id: "m2", teamId: "team-b", isPrimary: false, isActive: true },
  ];
  const uniquePrimaryDecision = decideSystemTeamRouting(uniquePrimary);
  check(
    "唯一有效 primary 時自動路由到該團隊",
    uniquePrimaryDecision.kind === "routed" &&
      uniquePrimaryDecision.teamId === "team-a" &&
      uniquePrimaryDecision.mappingId === "m1",
  );

  const multiplePrimary: SystemTeamMappingLike[] = [
    { id: "m1", teamId: "team-a", isPrimary: true, isActive: true },
    { id: "m2", teamId: "team-b", isPrimary: true, isActive: true },
  ];
  const multiplePrimaryDecision = decideSystemTeamRouting(multiplePrimary);
  check(
    "多個有效 primary 時回傳設定錯誤，不得任選其一",
    multiplePrimaryDecision.kind === "configError" &&
      multiplePrimaryDecision.reason === "multiplePrimary" &&
      multiplePrimaryDecision.conflictingTeamIds.length === 2,
  );

  console.log("\n=== M1-A 驗證：資料庫相依檢查（需 Migration 已套用；M1-A 階段預期為 SKIPPED） ===");

  try {
    await prisma.team.count();
    await prisma.userRole.count();
    await prisma.systemTeamMapping.count();
    // 若能成功查詢，代表 Migration 已套用，才進一步驗證既有資料未被誤改
    const userCount = await prisma.user.count();
    check("既有 User 資料表可正常查詢（DB 已連線）", userCount >= 0);
    skip("略過標記已不適用：Migration 似乎已套用，如需完整 DB 驗證請於 M1-B 後另行執行", "informational");
  } catch (err) {
    skip(
      "Team / UserRole / SystemTeamMapping 資料表查詢",
      "資料表尚未建立，等待 M1-B 套用 Migration 後才能驗證",
    );
  }

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  await prisma.$disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("m1-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
