-- CreateTable
CREATE TABLE "IssueKeySequence" (
    "issueType" TEXT NOT NULL PRIMARY KEY,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- InitializeCounters
-- 初始化每個 issueType 的計數器起始值。一律取「目前存活 Issue 該 issueType 的數字後綴最大值」
-- 與「已知歷史高水位」兩者較大者，不得只用現存筆數／現存 MAX——這是本次修正的核心防線。
--
-- 已知歷史高水位（本輪僅發現 Hotfix 一項，資料來源見下）：
--   Hotfix 歷史高水位 = 4。正式 dev.db（/workspaces/governance-tracker/prisma/dev.db）
--   曾建立過 HOTFIX-0004 並已受控刪除，現存資料已無此列（目前現存 MAX 僅 HOTFIX-0003），
--   但本專案既有、已提交的回歸測試 scripts/m2_b-verify.ts 第 776-808 行（[MIG1-0]/[MIG1-0b]/
--   [MIG1-1]/[MIG1-2]）已將「複本 HOTFIX-0004 為 0 筆（已清理殘留）」作為長期基準事實寫入
--   版本控管，可作為「此編號確實被使用過」的可稽核佐證，不得再次配發。其餘 7 種 issueType
--   （Incident／RCA／RiskException／QaVerification／ChangeRelease／MonitoringInventory／
--   BackupRecoveryTest）在專案歷史中查無任何已刪除殘留證據，故其歷史高水位採現存 MAX（等同
--   已知歷史高水位為 0，不墊高）。
--
-- 這份「已知歷史高水位」常數同時也寫在 src/lib/issue-key-sequence/synchronizationService.ts
-- 的 KNOWN_HISTORICAL_FLOORS，供 Fresh DB（migration 套用當下 Issue 表尚無 seed 資料、
-- 此處算出的 MAX 必為 0）在 seed 階段呼叫 synchronizeIssueKeySequencesFromExistingIssues()
-- 時再次墊高，兩處常數必須保持一致（見該檔案頂部註解與 targeted verify）。
INSERT INTO "IssueKeySequence" ("issueType", "lastValue", "updatedAt")
SELECT
  t.issueType,
  MAX(
    COALESCE(
      (SELECT MAX(CAST(SUBSTR(i."issueKey", INSTR(i."issueKey", '-') + 1) AS INTEGER))
       FROM "Issue" i
       WHERE i."issueType" = t.issueType),
      0
    ),
    t.knownHistoricalFloor
  ),
  CURRENT_TIMESTAMP
FROM (
  SELECT column1 AS issueType, column2 AS knownHistoricalFloor
  FROM (
    VALUES
      ('Hotfix', 4),
      ('Incident', 0),
      ('RCA', 0),
      ('RiskException', 0),
      ('QaVerification', 0),
      ('ChangeRelease', 0),
      ('MonitoringInventory', 0),
      ('BackupRecoveryTest', 0)
  )
) AS t;
