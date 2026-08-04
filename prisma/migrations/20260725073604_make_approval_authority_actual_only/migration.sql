-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApprovalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "approvalType" TEXT NOT NULL,
    "relatedStageKey" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approverUserId" TEXT,
    "approverTeamId" TEXT,
    "expectedApproverUserId" TEXT,
    "delegatedFromUserId" TEXT,
    "approvalAuthorityType" TEXT,
    "supervisorAssignmentId" TEXT,
    "approvalDelegationId" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "recordStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "decisionReasonCode" TEXT,
    "decisionComment" TEXT,
    "decidedAt" DATETIME,
    "approvalSnapshotJson" TEXT,
    "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshotHash" TEXT,
    "revisionNo" INTEGER NOT NULL DEFAULT 1,
    "supersedesApprovalRecordId" TEXT,
    "dueAt" DATETIME,
    "remindedAt" DATETIME,
    "invalidatedAt" DATETIME,
    "invalidationReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApprovalRecord_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalRecord_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalRecord_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalRecord_approverTeamId_fkey" FOREIGN KEY ("approverTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalRecord_expectedApproverUserId_fkey" FOREIGN KEY ("expectedApproverUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalRecord_delegatedFromUserId_fkey" FOREIGN KEY ("delegatedFromUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalRecord_supervisorAssignmentId_fkey" FOREIGN KEY ("supervisorAssignmentId") REFERENCES "UserSupervisorAssignment" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalRecord_approvalDelegationId_fkey" FOREIGN KEY ("approvalDelegationId") REFERENCES "ApprovalDelegation" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalRecord_supersedesApprovalRecordId_fkey" FOREIGN KEY ("supersedesApprovalRecordId") REFERENCES "ApprovalRecord" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
INSERT INTO "new_ApprovalRecord" ("approvalAuthorityType", "approvalDelegationId", "approvalSnapshotJson", "approvalType", "approverTeamId", "approverUserId", "createdAt", "decidedAt", "decision", "decisionComment", "decisionReasonCode", "delegatedFromUserId", "dueAt", "expectedApproverUserId", "id", "invalidatedAt", "invalidationReason", "issueId", "recordStatus", "relatedStageKey", "remindedAt", "requestedAt", "requestedByUserId", "revisionNo", "snapshotHash", "snapshotSchemaVersion", "supersedesApprovalRecordId", "supervisorAssignmentId", "updatedAt") SELECT "approvalAuthorityType", "approvalDelegationId", "approvalSnapshotJson", "approvalType", "approverTeamId", "approverUserId", "createdAt", "decidedAt", "decision", "decisionComment", "decisionReasonCode", "delegatedFromUserId", "dueAt", "expectedApproverUserId", "id", "invalidatedAt", "invalidationReason", "issueId", "recordStatus", "relatedStageKey", "remindedAt", "requestedAt", "requestedByUserId", "revisionNo", "snapshotHash", "snapshotSchemaVersion", "supersedesApprovalRecordId", "supervisorAssignmentId", "updatedAt" FROM "ApprovalRecord";
DROP TABLE "ApprovalRecord";
ALTER TABLE "new_ApprovalRecord" RENAME TO "ApprovalRecord";
CREATE UNIQUE INDEX "ApprovalRecord_supersedesApprovalRecordId_key" ON "ApprovalRecord"("supersedesApprovalRecordId");
CREATE INDEX "ApprovalRecord_issueId_approvalType_recordStatus_idx" ON "ApprovalRecord"("issueId", "approvalType", "recordStatus");
CREATE INDEX "ApprovalRecord_decision_idx" ON "ApprovalRecord"("decision");
CREATE INDEX "ApprovalRecord_approverUserId_idx" ON "ApprovalRecord"("approverUserId");
CREATE INDEX "ApprovalRecord_dueAt_idx" ON "ApprovalRecord"("dueAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 手動追加（重要）：本 migration 因 SQLite 不支援 ALTER COLUMN 而以
-- RedefineTables（建新表→搬資料→DROP 舊表→RENAME）方式將 approvalAuthorityType 改為 nullable。
-- Prisma 自動產生的腳本只重建 schema.prisma 內定義的 @@index／@@unique，對「schema 語法無法
-- 表達的條件式唯一索引」完全不知情，因此 DROP TABLE 會連同刪除既有的
-- ApprovalRecord_one_active_pending partial unique index，且不會自動重建。
-- 比照 20260725063426_add_approval_layer migration 的作法，於此手動補回，
-- 否則「同一 issueId+approvalType+relatedStageKey 僅一筆 ACTIVE+PENDING」的 DB 層防護會悄悄消失。
CREATE UNIQUE INDEX "ApprovalRecord_one_active_pending"
ON "ApprovalRecord" (
  "issueId",
  "approvalType",
  "relatedStageKey"
)
WHERE "recordStatus" = 'ACTIVE'
  AND "decision" = 'PENDING';
