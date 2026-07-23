-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Issue" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    CONSTRAINT "Issue_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IssueType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "typeKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "WorkflowStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueType" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "statusKey" TEXT NOT NULL,
    "label" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "IssueFieldValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IssueFieldValue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evidence_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "actionType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "suggestionType" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSuggestion_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_issueKey_key" ON "Issue"("issueKey");

-- CreateIndex
CREATE INDEX "Issue_issueType_idx" ON "Issue"("issueType");

-- CreateIndex
CREATE INDEX "Issue_workflowStatus_idx" ON "Issue"("workflowStatus");

-- CreateIndex
CREATE INDEX "Issue_statusLight_idx" ON "Issue"("statusLight");

-- CreateIndex
CREATE INDEX "Issue_ownerUserId_idx" ON "Issue"("ownerUserId");

-- CreateIndex
CREATE INDEX "Issue_reporterUserId_idx" ON "Issue"("reporterUserId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueType_typeKey_key" ON "IssueType"("typeKey");

-- CreateIndex
CREATE INDEX "WorkflowStatus_issueType_idx" ON "WorkflowStatus"("issueType");

-- CreateIndex
CREATE INDEX "IssueFieldValue_issueId_idx" ON "IssueFieldValue"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueFieldValue_issueId_fieldKey_key" ON "IssueFieldValue"("issueId", "fieldKey");

-- CreateIndex
CREATE INDEX "Evidence_issueId_idx" ON "Evidence"("issueId");

-- CreateIndex
CREATE INDEX "Comment_issueId_idx" ON "Comment"("issueId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AiSuggestion_issueId_idx" ON "AiSuggestion"("issueId");
