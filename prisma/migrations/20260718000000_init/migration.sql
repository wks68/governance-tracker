-- CreateTable
CREATE TABLE "IssueType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkflowStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowStatus_issueTypeId_fkey" FOREIGN KEY ("issueTypeId") REFERENCES "IssueType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueKey" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "ownerRole" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "reporter" TEXT NOT NULL,
    "workflowStatus" TEXT NOT NULL,
    "statusLight" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "needRca" BOOLEAN NOT NULL DEFAULT false,
    "needRiskException" BOOLEAN NOT NULL DEFAULT false,
    "impactProduction" BOOLEAN NOT NULL DEFAULT false,
    "evidenceStatus" TEXT NOT NULL DEFAULT 'Missing',
    "blockReason" TEXT,
    "waitingRole" TEXT,
    "nextStep" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME
);

-- CreateTable
CREATE TABLE "IssueFieldValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
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
    "description" TEXT,
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
    "issueId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionSummary" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "IssueType_name_key" ON "IssueType"("name");

-- CreateIndex
CREATE INDEX "WorkflowStatus_issueTypeId_sortOrder_idx" ON "WorkflowStatus"("issueTypeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStatus_issueTypeId_name_key" ON "WorkflowStatus"("issueTypeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_issueKey_key" ON "Issue"("issueKey");

-- CreateIndex
CREATE INDEX "Issue_issueType_idx" ON "Issue"("issueType");

-- CreateIndex
CREATE INDEX "Issue_workflowStatus_idx" ON "Issue"("workflowStatus");

-- CreateIndex
CREATE INDEX "Issue_statusLight_idx" ON "Issue"("statusLight");

-- CreateIndex
CREATE INDEX "Issue_dueDate_idx" ON "Issue"("dueDate");

-- CreateIndex
CREATE INDEX "IssueFieldValue_fieldKey_idx" ON "IssueFieldValue"("fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "IssueFieldValue_issueId_fieldKey_key" ON "IssueFieldValue"("issueId", "fieldKey");

-- CreateIndex
CREATE INDEX "Evidence_issueId_idx" ON "Evidence"("issueId");

-- CreateIndex
CREATE INDEX "Comment_issueId_idx" ON "Comment"("issueId");

-- CreateIndex
CREATE INDEX "AuditLog_issueId_idx" ON "AuditLog"("issueId");

-- CreateIndex
CREATE INDEX "AuditLog_actionType_idx" ON "AuditLog"("actionType");

-- CreateIndex
CREATE INDEX "AiSuggestion_issueId_idx" ON "AiSuggestion"("issueId");

-- CreateIndex
CREATE INDEX "AiSuggestion_suggestionType_idx" ON "AiSuggestion"("suggestionType");
