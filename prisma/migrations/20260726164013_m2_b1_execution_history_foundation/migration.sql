/*
  Warnings:

  - You are about to drop the column `enteredAt` on the `IssueWorkflowStageHistory` table. All the data in the column will be lost.
  - You are about to drop the column `reason` on the `IssueWorkflowStageHistory` table. All the data in the column will be lost.
  - You are about to drop the column `workflowStageId` on the `IssueWorkflowStageHistory` table. All the data in the column will be lost.
  - Added the required column `toStageId` to the `IssueWorkflowStageHistory` table without a default value. This is not possible if the table is not empty.

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
INSERT INTO "new_IssueWorkflowStageHistory" ("actorUserId", "exitedAt", "id", "issueId", "transitionType") SELECT "actorUserId", "exitedAt", "id", "issueId", "transitionType" FROM "IssueWorkflowStageHistory";
DROP TABLE "IssueWorkflowStageHistory";
ALTER TABLE "new_IssueWorkflowStageHistory" RENAME TO "IssueWorkflowStageHistory";
CREATE INDEX "IssueWorkflowStageHistory_issueId_idx" ON "IssueWorkflowStageHistory"("issueId");
CREATE INDEX "IssueWorkflowStageHistory_toStageId_idx" ON "IssueWorkflowStageHistory"("toStageId");
CREATE INDEX "IssueWorkflowStageHistory_fromStageId_idx" ON "IssueWorkflowStageHistory"("fromStageId");
CREATE INDEX "IssueWorkflowStageHistory_transitionId_idx" ON "IssueWorkflowStageHistory"("transitionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
