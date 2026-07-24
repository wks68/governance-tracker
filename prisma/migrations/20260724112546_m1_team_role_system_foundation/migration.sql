-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "fromValue" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "reasonCode" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "toValue" TEXT;

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipRole" TEXT NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "System" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SystemTeamMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "systemId" TEXT NOT NULL,
    "responsibilityType" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SystemTeamMapping_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SystemTeamMapping_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    CONSTRAINT "Issue_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Issue" ("alertLevel", "blockReason", "closedAt", "createdAt", "description", "dueDate", "environment", "evidenceStatus", "firstResponseAt", "id", "impactProduction", "issueKey", "issueType", "needRca", "needRiskException", "nextStep", "ownerName", "ownerRole", "ownerUserId", "priority", "reporter", "reporterUserId", "riskLevel", "statusLight", "systemName", "title", "updatedAt", "waitingRole", "workflowStatus") SELECT "alertLevel", "blockReason", "closedAt", "createdAt", "description", "dueDate", "environment", "evidenceStatus", "firstResponseAt", "id", "impactProduction", "issueKey", "issueType", "needRca", "needRiskException", "nextStep", "ownerName", "ownerRole", "ownerUserId", "priority", "reporter", "reporterUserId", "riskLevel", "statusLight", "systemName", "title", "updatedAt", "waitingRole", "workflowStatus" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE UNIQUE INDEX "Issue_issueKey_key" ON "Issue"("issueKey");
CREATE INDEX "Issue_issueType_idx" ON "Issue"("issueType");
CREATE INDEX "Issue_workflowStatus_idx" ON "Issue"("workflowStatus");
CREATE INDEX "Issue_statusLight_idx" ON "Issue"("statusLight");
CREATE INDEX "Issue_ownerUserId_idx" ON "Issue"("ownerUserId");
CREATE INDEX "Issue_reporterUserId_idx" ON "Issue"("reporterUserId");
CREATE INDEX "Issue_assignedTeamId_idx" ON "Issue"("assignedTeamId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_role_key" ON "UserRole"("userId", "role");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "System_key_key" ON "System"("key");

-- CreateIndex
CREATE INDEX "SystemTeamMapping_systemId_responsibilityType_idx" ON "SystemTeamMapping"("systemId", "responsibilityType");
