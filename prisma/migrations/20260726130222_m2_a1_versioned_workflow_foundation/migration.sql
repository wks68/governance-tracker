-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "issueType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowDefinitionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "clonedFromVersionId" TEXT,
    "publishedAt" DATETIME,
    "publishedByUserId" TEXT,
    "archivedAt" DATETIME,
    "archivedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowVersion_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "WorkflowStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowVersionId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isStart" BOOLEAN NOT NULL DEFAULT false,
    "isEnd" BOOLEAN NOT NULL DEFAULT false,
    "terminalOutcome" TEXT,
    "assignedTeamId" TEXT,
    "requiredExecutionRole" TEXT,
    "requiredMembershipRole" TEXT,
    "approvalType" TEXT,
    "requireReason" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowStage_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "WorkflowStage_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "WorkflowTransition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowVersionId" TEXT NOT NULL,
    "fromStageId" TEXT NOT NULL,
    "toStageId" TEXT NOT NULL,
    "transitionType" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requireReason" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowTransition_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "WorkflowTransition_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "WorkflowStage" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "WorkflowTransition_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "WorkflowStage" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "WorkflowStageRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowStageId" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowStageRequirement_workflowStageId_fkey" FOREIGN KEY ("workflowStageId") REFERENCES "WorkflowStage" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "IssueWorkflowStageHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "workflowStageId" TEXT NOT NULL,
    "transitionType" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "enteredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" DATETIME,
    CONSTRAINT "IssueWorkflowStageHistory_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueWorkflowStageHistory_workflowStageId_fkey" FOREIGN KEY ("workflowStageId") REFERENCES "WorkflowStage" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueKey" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemName" TEXT NOT NULL DEFAULT '',
    "environment" TEXT NOT NULL DEFAULT '',
    "riskLevel" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT '',
    "ownerRole" TEXT NOT NULL DEFAULT '',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "ownerUserId" TEXT,
    "reporter" TEXT NOT NULL DEFAULT '',
    "reporterUserId" TEXT,
    "workflowStatus" TEXT NOT NULL,
    "statusLight" TEXT NOT NULL DEFAULT 'Green',
    "dueDate" DATETIME,
    "needRca" BOOLEAN NOT NULL DEFAULT false,
    "needRiskException" BOOLEAN NOT NULL DEFAULT false,
    "impactProduction" BOOLEAN NOT NULL DEFAULT false,
    "evidenceStatus" TEXT NOT NULL DEFAULT '缺漏',
    "blockReason" TEXT NOT NULL DEFAULT '',
    "waitingRole" TEXT NOT NULL DEFAULT '',
    "nextStep" TEXT NOT NULL DEFAULT '',
    "alertLevel" TEXT NOT NULL DEFAULT '',
    "firstResponseAt" DATETIME,
    "assignedTeamId" TEXT,
    "stageEnteredAt" DATETIME,
    "changeSubType" TEXT,
    "workflowVersionId" TEXT,
    "currentWorkflowStageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    CONSTRAINT "Issue_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "Issue_currentWorkflowStageId_fkey" FOREIGN KEY ("currentWorkflowStageId") REFERENCES "WorkflowStage" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
INSERT INTO "new_Issue" ("alertLevel", "assignedTeamId", "blockReason", "changeSubType", "closedAt", "createdAt", "description", "dueDate", "environment", "evidenceStatus", "firstResponseAt", "id", "impactProduction", "issueKey", "issueType", "needRca", "needRiskException", "nextStep", "ownerName", "ownerRole", "ownerUserId", "priority", "reporter", "reporterUserId", "riskLevel", "stageEnteredAt", "statusLight", "systemName", "title", "updatedAt", "waitingRole", "workflowStatus") SELECT "alertLevel", "assignedTeamId", "blockReason", "changeSubType", "closedAt", "createdAt", "description", "dueDate", "environment", "evidenceStatus", "firstResponseAt", "id", "impactProduction", "issueKey", "issueType", "needRca", "needRiskException", "nextStep", "ownerName", "ownerRole", "ownerUserId", "priority", "reporter", "reporterUserId", "riskLevel", "stageEnteredAt", "statusLight", "systemName", "title", "updatedAt", "waitingRole", "workflowStatus" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE UNIQUE INDEX "Issue_issueKey_key" ON "Issue"("issueKey");
CREATE INDEX "Issue_issueType_idx" ON "Issue"("issueType");
CREATE INDEX "Issue_workflowStatus_idx" ON "Issue"("workflowStatus");
CREATE INDEX "Issue_statusLight_idx" ON "Issue"("statusLight");
CREATE INDEX "Issue_ownerUserId_idx" ON "Issue"("ownerUserId");
CREATE INDEX "Issue_reporterUserId_idx" ON "Issue"("reporterUserId");
CREATE INDEX "Issue_assignedTeamId_idx" ON "Issue"("assignedTeamId");
CREATE INDEX "Issue_workflowVersionId_idx" ON "Issue"("workflowVersionId");
CREATE INDEX "Issue_currentWorkflowStageId_idx" ON "Issue"("currentWorkflowStageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_key_key" ON "WorkflowDefinition"("key");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_issueType_idx" ON "WorkflowDefinition"("issueType");

-- CreateIndex
CREATE INDEX "WorkflowVersion_status_idx" ON "WorkflowVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowDefinitionId_versionNo_key" ON "WorkflowVersion"("workflowDefinitionId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStage_workflowVersionId_stageKey_key" ON "WorkflowStage"("workflowVersionId", "stageKey");

-- CreateIndex
CREATE INDEX "WorkflowTransition_toStageId_idx" ON "WorkflowTransition"("toStageId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTransition_fromStageId_actionKey_key" ON "WorkflowTransition"("fromStageId", "actionKey");

-- CreateIndex
CREATE INDEX "IssueWorkflowStageHistory_issueId_idx" ON "IssueWorkflowStageHistory"("issueId");

-- CreateIndex (手動追加：每個非結束關卡最多一個 FORWARD，SQLite 不支援 schema.prisma 語法表達條件式唯一索引)
CREATE UNIQUE INDEX "WorkflowTransition_one_forward_per_stage"
ON "WorkflowTransition" ("fromStageId")
WHERE "transitionType" = 'FORWARD';

-- CreateIndex (手動追加：每個關卡最多一個 CANCEL，SQLite 不支援 schema.prisma 語法表達條件式唯一索引)
CREATE UNIQUE INDEX "WorkflowTransition_one_cancel_per_stage"
ON "WorkflowTransition" ("fromStageId")
WHERE "transitionType" = 'CANCEL';
