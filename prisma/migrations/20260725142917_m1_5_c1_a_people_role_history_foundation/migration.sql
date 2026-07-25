/*
  Warnings:

  - Added the required column `updatedAt` to the `UserRole` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "UserRoleHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userRoleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "actorUserId" TEXT,
    "eventSource" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "effectiveAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRoleHistory_userRoleId_fkey" FOREIGN KEY ("userRoleId") REFERENCES "UserRole" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "UserRoleHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "UserRoleHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "TeamMembershipHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamMemberId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromMembershipRole" TEXT,
    "toMembershipRole" TEXT,
    "actorUserId" TEXT,
    "eventSource" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "effectiveAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMembershipHistory_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "TeamMembershipHistory_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "TeamMembershipHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "TeamMembershipHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "loginIdentifier" TEXT,
    "isBreakGlassAdmin" BOOLEAN NOT NULL DEFAULT false,
    "disabledAt" DATETIME,
    "disabledByUserId" TEXT,
    "disabledReasonCode" TEXT,
    CONSTRAINT "User_disabledByUserId_fkey" FOREIGN KEY ("disabledByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
INSERT INTO "new_User" ("createdAt", "department", "email", "id", "isActive", "lastLoginAt", "name", "role", "updatedAt") SELECT "createdAt", "department", "email", "id", "isActive", "lastLoginAt", "name", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_loginIdentifier_key" ON "User"("loginIdentifier");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_isActive_idx" ON "User"("isActive");
CREATE TABLE "new_UserRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- 手動修正（重要）：Prisma 自動產生的 INSERT 只搬移 4 個舊欄位，
-- 對「本次新增且無 DEFAULT 的 updatedAt（NOT NULL）」完全沒有處理——若正式庫 UserRole 為空表，
-- 這個 INSERT ... SELECT 只是 0 筆操作，不會出錯；但在「其他環境已存在部分 UserRole」的情境，
-- 上游自動產生的寫法會因 updatedAt 缺乏預設值而以 NOT NULL constraint failed 中止。
-- 手動補上 isActive／updatedAt，既有列一律視為 isActive=true（沿用既有語意，未曾被停用過），
-- updatedAt 以該列既有 createdAt 作為最合理的既有時間戳記代理值（無其他可用資訊）。
INSERT INTO "new_UserRole" ("createdAt", "id", "role", "userId", "isActive", "updatedAt") SELECT "createdAt", "id", "role", "userId", true, "createdAt" FROM "UserRole";
DROP TABLE "UserRole";
ALTER TABLE "new_UserRole" RENAME TO "UserRole";
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");
CREATE INDEX "UserRole_isActive_idx" ON "UserRole"("isActive");
CREATE UNIQUE INDEX "UserRole_userId_role_key" ON "UserRole"("userId", "role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "UserRoleHistory_userRoleId_idx" ON "UserRoleHistory"("userRoleId");

-- CreateIndex
CREATE INDEX "UserRoleHistory_userId_idx" ON "UserRoleHistory"("userId");

-- CreateIndex
CREATE INDEX "UserRoleHistory_eventType_idx" ON "UserRoleHistory"("eventType");

-- CreateIndex
CREATE INDEX "UserRoleHistory_eventSource_idx" ON "UserRoleHistory"("eventSource");

-- CreateIndex
CREATE INDEX "TeamMembershipHistory_teamMemberId_idx" ON "TeamMembershipHistory"("teamMemberId");

-- CreateIndex
CREATE INDEX "TeamMembershipHistory_teamId_idx" ON "TeamMembershipHistory"("teamId");

-- CreateIndex
CREATE INDEX "TeamMembershipHistory_userId_idx" ON "TeamMembershipHistory"("userId");

-- CreateIndex
CREATE INDEX "TeamMembershipHistory_eventType_idx" ON "TeamMembershipHistory"("eventType");

-- CreateIndex
CREATE INDEX "TeamMembershipHistory_eventSource_idx" ON "TeamMembershipHistory"("eventSource");

-- ============================================================================
-- 手動追加（重要）：M1.5-C1-A 安全回填、一致性 guard 與 Break-glass 初始標記。
-- 依 Plan 檔案 M1.5-C1 Superseding Amendment 章節八～十一設計，全部以純 SQL
-- 表達，供 `prisma migrate deploy` 直接執行；同時支援「正式庫 UserRole=0」與
-- 「其他環境已存在部分 UserRole」兩種情境，且對任何不一致情況一律中止、
-- 不自動修正、不任意挑選。
--
-- 中止機制：SQLite 沒有可在一般陳述式中使用的 RAISE()（僅限 trigger 內），
-- 因此以「CHECK(1=0) 的暫存表 + 條件式 INSERT」達成同等效果——
-- 條件不成立時 INSERT 命中 0 筆、完全無副作用；條件成立時 INSERT 嘗試寫入
-- 任何一筆都會違反 CHECK 而丟出真正的 SQLite 錯誤，讓整個 migration
-- （SQLite 下以單一 transaction 執行）失敗並完整回滾，不會留下部分套用的狀態。
-- ============================================================================

-- ---- Guard 1：既有 (userId, role=User.role) 存在但 isActive=false ----
-- 對應規則：「若已有相同 (userId, role) 但 isActive=false，Migration 必須失敗並停止，
-- 不得自動重新啟用」。
CREATE TEMP TABLE "c1_guard_inactive_primary_role" (
  "guard_key" TEXT NOT NULL PRIMARY KEY,
  "detail" TEXT NOT NULL CHECK (1 = 0)
);

INSERT INTO "c1_guard_inactive_primary_role" ("guard_key", "detail")
SELECT 'INACTIVE_PRIMARY_ROLE:' || u."id",
       'User ' || u."id" || ' role=' || u."role" || ' 對應的 UserRole 已存在但 isActive=false'
FROM "User" u
JOIN "UserRole" ur ON ur."userId" = u."id" AND ur."role" = u."role"
WHERE ur."isActive" = false;

DROP TABLE "c1_guard_inactive_primary_role";

-- ---- Guard 2：User 已有其他 active UserRole，但沒有 active 的 User.role 對應 ----
-- 對應規則：「Migration 必須失敗並停止，不得自行增加、替換或猜測 primary role」。
CREATE TEMP TABLE "c1_guard_primary_role_mismatch" (
  "guard_key" TEXT NOT NULL PRIMARY KEY,
  "detail" TEXT NOT NULL CHECK (1 = 0)
);

INSERT INTO "c1_guard_primary_role_mismatch" ("guard_key", "detail")
SELECT 'PRIMARY_ROLE_MISMATCH:' || u."id",
       'User ' || u."id" || ' role=' || u."role" || ' 有其他 active UserRole，但無 active 的 role=User.role 對應列'
FROM "User" u
WHERE EXISTS (SELECT 1 FROM "UserRole" ur2 WHERE ur2."userId" = u."id" AND ur2."isActive" = true)
  AND NOT EXISTS (SELECT 1 FROM "UserRole" ur3 WHERE ur3."userId" = u."id" AND ur3."role" = u."role" AND ur3."isActive" = true);

DROP TABLE "c1_guard_primary_role_mismatch";

-- ---- 回填 1：為缺少 (userId, role=User.role) 對應列的 User 建立 active UserRole ----
-- 走到這裡代表 Guard 1／Guard 2 皆未命中，缺少的列必為「完全沒有任何列」，
-- 而非「已存在但需要修正」的情況，安全建立不撞 @@unique([userId, role])。
CREATE TEMP TABLE "c1_role_backfill_plan" (
  "new_id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL
);

INSERT INTO "c1_role_backfill_plan" ("new_id", "userId", "role")
SELECT lower(hex(randomblob(16))), u."id", u."role"
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."role" = u."role");

INSERT INTO "UserRole" ("id", "userId", "role", "isActive", "createdAt", "updatedAt")
SELECT "new_id", "userId", "role", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "c1_role_backfill_plan";

-- ---- 回填 2：為上一步新建的 UserRole 補寫 UserRoleHistory（ASSIGNED / SYSTEM_MIGRATION） ----
INSERT INTO "UserRoleHistory" ("id", "userRoleId", "userId", "role", "eventType", "fromValue", "toValue", "actorUserId", "eventSource", "reasonCode", "effectiveAt", "createdAt")
SELECT lower(hex(randomblob(16))), p."new_id", p."userId", p."role", 'ASSIGNED', NULL, p."role", NULL, 'SYSTEM_MIGRATION', 'C1_ROLE_BACKFILL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "c1_role_backfill_plan" p
WHERE NOT EXISTS (
  SELECT 1 FROM "UserRoleHistory" h
  WHERE h."userId" = p."userId" AND h."role" = p."role" AND h."eventType" = 'ASSIGNED'
    AND h."eventSource" = 'SYSTEM_MIGRATION' AND h."reasonCode" = 'C1_ROLE_BACKFILL'
);

DROP TABLE "c1_role_backfill_plan";

-- ---- 回填 3：既有（非本次新建）且 active 的 primary-role UserRole，若尚無基準歷程則補一筆 ----
-- 去重依 (userId, role, eventType, eventSource, reasonCode) 判斷，回填 1/2 已建立的列在此天然被排除。
INSERT INTO "UserRoleHistory" ("id", "userRoleId", "userId", "role", "eventType", "fromValue", "toValue", "actorUserId", "eventSource", "reasonCode", "effectiveAt", "createdAt")
SELECT lower(hex(randomblob(16))), ur."id", ur."userId", ur."role", 'ASSIGNED', NULL, ur."role", NULL, 'SYSTEM_MIGRATION', 'C1_ROLE_BACKFILL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "UserRole" ur
JOIN "User" u ON u."id" = ur."userId" AND u."role" = ur."role"
WHERE ur."isActive" = true
  AND NOT EXISTS (
    SELECT 1 FROM "UserRoleHistory" h
    WHERE h."userId" = ur."userId" AND h."role" = ur."role" AND h."eventType" = 'ASSIGNED'
      AND h."eventSource" = 'SYSTEM_MIGRATION' AND h."reasonCode" = 'C1_ROLE_BACKFILL'
  );

-- ---- 回填 4：既有 active=true 的 TeamMember 補寫 TeamMembershipHistory（JOINED / SYSTEM_MIGRATION） ----
-- 正式 dev.db 目前 TeamMember=0，此區塊預期插入 0 筆，屬正常完成，非 SKIP/FAIL；
-- SQL 本身仍完整保留，供其他已有 TeamMember 資料的環境正確回填。
CREATE TEMP TABLE "c1_team_membership_backfill_plan" (
  "new_id" TEXT NOT NULL PRIMARY KEY,
  "teamMemberId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "membershipRole" TEXT NOT NULL
);

INSERT INTO "c1_team_membership_backfill_plan" ("new_id", "teamMemberId", "teamId", "userId", "membershipRole")
SELECT lower(hex(randomblob(16))), tm."id", tm."teamId", tm."userId", tm."membershipRole"
FROM "TeamMember" tm
WHERE tm."isActive" = true
  AND NOT EXISTS (
    SELECT 1 FROM "TeamMembershipHistory" h
    WHERE h."teamMemberId" = tm."id" AND h."eventType" = 'JOINED'
      AND h."eventSource" = 'SYSTEM_MIGRATION' AND h."reasonCode" = 'C1_TEAM_MEMBERSHIP_BACKFILL'
  );

INSERT INTO "TeamMembershipHistory" ("id", "teamMemberId", "teamId", "userId", "eventType", "fromMembershipRole", "toMembershipRole", "actorUserId", "eventSource", "reasonCode", "effectiveAt", "createdAt")
SELECT "new_id", "teamMemberId", "teamId", "userId", 'JOINED', NULL, "membershipRole", NULL, 'SYSTEM_MIGRATION', 'C1_TEAM_MEMBERSHIP_BACKFILL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "c1_team_membership_backfill_plan";

DROP TABLE "c1_team_membership_backfill_plan";

-- ---- Guard 3：Break-glass 唯一有效 Admin 判定（僅非空資料庫強制；全新空 DB 由 seed.ts 負責） ----
-- 有效 Admin 定義：User.isActive=true AND UserRole.role='Admin' AND UserRole.isActive=true。
-- 對應規則：「0 位或 ≥2 位時 Migration 必須停止並回報，不得任意挑選」；
-- 「Migration 執行時 User=0 是合法情境，不得因有效 Admin=0 而讓 Migration 失敗」。
CREATE TEMP TABLE "c1_guard_breakglass_admin_count" (
  "guard_key" TEXT NOT NULL PRIMARY KEY,
  "detail" TEXT NOT NULL CHECK (1 = 0)
);

INSERT INTO "c1_guard_breakglass_admin_count" ("guard_key", "detail")
SELECT 'BREAK_GLASS_ADMIN_COUNT_NOT_UNIQUE', '有效 Admin 人數 = ' || cnt."activeAdminCount"
FROM (
  SELECT COUNT(*) AS "activeAdminCount"
  FROM "User" u
  JOIN "UserRole" ur ON ur."userId" = u."id" AND ur."role" = 'Admin' AND ur."isActive" = true
  WHERE u."isActive" = true
) cnt
WHERE (SELECT COUNT(*) FROM "User") > 0 AND cnt."activeAdminCount" <> 1;

DROP TABLE "c1_guard_breakglass_admin_count";

-- ---- 初始標記：恰好一位有效 Admin 時才標記 isBreakGlassAdmin=true ----
-- 走到這裡代表 Guard 3 未中止，故非空資料庫必為「恰好 1 位」；空資料庫（cnt=0）此 UPDATE 自然 0 筆命中。
-- 使用 MIN(id) 搭配 HAVING cnt=1 的彙總寫法，避免 SQLite 純量子查詢在多筆結果時
-- 靜默取第一筆的「任意挑選」風險——cnt<>1 時彙總列本身被 WHERE 濾除，不會有任何 id 外流。
UPDATE "User"
SET "isBreakGlassAdmin" = true
WHERE "id" IN (
  SELECT "only_id" FROM (
    SELECT MIN(u."id") AS "only_id", COUNT(*) AS "cnt"
    FROM "User" u
    JOIN "UserRole" ur ON ur."userId" = u."id" AND ur."role" = 'Admin' AND ur."isActive" = true
    WHERE u."isActive" = true
  )
  WHERE "cnt" = 1
);
