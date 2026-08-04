/*
  這份 migration 是 Prisma `migrate dev --create-only` 的產出，但下方 INSERT INTO
  ... SELECT 語句已手動修正（見該語句上方註解）：Prisma 自動產生的版本只複製了
  actorUserId/exitedAt/id/issueId/transitionType 五欄，完全遺漏 NOT NULL 的 toStageId
  資料來源，若既有資料非 0 筆會直接因違反 NOT NULL 約束而整個 migration 失敗。手動版本
  正確地把 workflowStageId→toStageId、reason→reasonCode、enteredAt→executedAt 三個單純
  改名的欄位資料搬移過去，並從 WorkflowStage 現場查出 terminalOutcome，不遺失任何既有
  資料；fromStageId／transitionId／assignedTeamIdBefore／assignedTeamIdAfter 是舊 schema
  從未記錄過的全新事實，既有資料明確設為 NULL（非資料遺失）。
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IssueWorkflowStageHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "transitionId" TEXT,
    "transitionType" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reasonCode" TEXT,
    "assignedTeamIdBefore" TEXT,
    "assignedTeamIdAfter" TEXT,
    "terminalOutcome" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" DATETIME,
    CONSTRAINT "IssueWorkflowStageHistory_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueWorkflowStageHistory_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "WorkflowStage" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueWorkflowStageHistory_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "WorkflowStage" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueWorkflowStageHistory_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "WorkflowTransition" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueWorkflowStageHistory_assignedTeamIdBefore_fkey" FOREIGN KEY ("assignedTeamIdBefore") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueWorkflowStageHistory_assignedTeamIdAfter_fkey" FOREIGN KEY ("assignedTeamIdAfter") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- 手動修正 Prisma 自動產生的 INSERT 語句（原始版本只複製了
-- actorUserId/exitedAt/id/issueId/transitionType 五欄，完全遺漏 toStageId 這個
-- NOT NULL 欄位的資料來源，若既有資料非 0 筆會直接違反 NOT NULL 約束而整個 migration
-- 失敗；即使能執行也會靜默遺失 reasonCode／executedAt 的既有資料）：
--   toStageId   ← 舊欄位 workflowStageId（單純改名，直接搬移）
--   reasonCode  ← 舊欄位 reason（單純改名，直接搬移）
--   executedAt  ← 舊欄位 enteredAt（單純改名，直接搬移）
--   terminalOutcome ← 由舊 workflowStageId 對應的 WorkflowStage.terminalOutcome 現場查出
--     （M2-A 發布前驗證已保證 isEnd=false 時 terminalOutcome 必為 null，isEnd=true 時必填，
--     因此此處不需另外判斷 isEnd，直接取值即為正確結果）
--   fromStageId／transitionId／assignedTeamIdBefore／assignedTeamIdAfter ← 舊 schema
--     未曾記錄這些事實，沒有任何既有資料可搬移，一律明確設為 NULL（不是遺失資料，是
--     舊資料本來就不包含這些欄位所代表的事實）
INSERT INTO "new_IssueWorkflowStageHistory"
  ("id", "issueId", "fromStageId", "toStageId", "transitionId", "transitionType", "actorUserId", "reasonCode", "assignedTeamIdBefore", "assignedTeamIdAfter", "terminalOutcome", "executedAt", "exitedAt")
SELECT
  "id",
  "issueId",
  NULL,
  "workflowStageId",
  NULL,
  "transitionType",
  "actorUserId",
  "reason",
  NULL,
  NULL,
  (SELECT ws."terminalOutcome" FROM "WorkflowStage" ws WHERE ws."id" = "IssueWorkflowStageHistory"."workflowStageId"),
  "enteredAt",
  "exitedAt"
FROM "IssueWorkflowStageHistory";
DROP TABLE "IssueWorkflowStageHistory";
ALTER TABLE "new_IssueWorkflowStageHistory" RENAME TO "IssueWorkflowStageHistory";
CREATE INDEX "IssueWorkflowStageHistory_issueId_idx" ON "IssueWorkflowStageHistory"("issueId");
CREATE INDEX "IssueWorkflowStageHistory_toStageId_idx" ON "IssueWorkflowStageHistory"("toStageId");
CREATE INDEX "IssueWorkflowStageHistory_fromStageId_idx" ON "IssueWorkflowStageHistory"("fromStageId");
CREATE INDEX "IssueWorkflowStageHistory_transitionId_idx" ON "IssueWorkflowStageHistory"("transitionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
