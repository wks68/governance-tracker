import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const shouldReset = process.argv.includes("--reset");

const dropStatements = [
  `DROP TABLE IF EXISTS "AiSuggestion"`,
  `DROP TABLE IF EXISTS "AuditLog"`,
  `DROP TABLE IF EXISTS "Comment"`,
  `DROP TABLE IF EXISTS "Evidence"`,
  `DROP TABLE IF EXISTS "IssueFieldValue"`,
  `DROP TABLE IF EXISTS "Issue"`,
  `DROP TABLE IF EXISTS "WorkflowStatus"`,
  `DROP TABLE IF EXISTS "IssueType"`
];

const createStatements = [
  `CREATE TABLE IF NOT EXISTS "IssueType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "WorkflowStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowStatus_issueTypeId_fkey" FOREIGN KEY ("issueTypeId") REFERENCES "IssueType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Issue" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "IssueFieldValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IssueFieldValue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evidence_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionSummary" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "AiSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "suggestionType" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSuggestion_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IssueType_name_key" ON "IssueType"("name")`,
  `CREATE INDEX IF NOT EXISTS "WorkflowStatus_issueTypeId_sortOrder_idx" ON "WorkflowStatus"("issueTypeId", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowStatus_issueTypeId_name_key" ON "WorkflowStatus"("issueTypeId", "name")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Issue_issueKey_key" ON "Issue"("issueKey")`,
  `CREATE INDEX IF NOT EXISTS "Issue_issueType_idx" ON "Issue"("issueType")`,
  `CREATE INDEX IF NOT EXISTS "Issue_workflowStatus_idx" ON "Issue"("workflowStatus")`,
  `CREATE INDEX IF NOT EXISTS "Issue_statusLight_idx" ON "Issue"("statusLight")`,
  `CREATE INDEX IF NOT EXISTS "Issue_dueDate_idx" ON "Issue"("dueDate")`,
  `CREATE INDEX IF NOT EXISTS "IssueFieldValue_fieldKey_idx" ON "IssueFieldValue"("fieldKey")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IssueFieldValue_issueId_fieldKey_key" ON "IssueFieldValue"("issueId", "fieldKey")`,
  `CREATE INDEX IF NOT EXISTS "Evidence_issueId_idx" ON "Evidence"("issueId")`,
  `CREATE INDEX IF NOT EXISTS "Comment_issueId_idx" ON "Comment"("issueId")`,
  `CREATE INDEX IF NOT EXISTS "AuditLog_issueId_idx" ON "AuditLog"("issueId")`,
  `CREATE INDEX IF NOT EXISTS "AuditLog_actionType_idx" ON "AuditLog"("actionType")`,
  `CREATE INDEX IF NOT EXISTS "AiSuggestion_issueId_idx" ON "AiSuggestion"("issueId")`,
  `CREATE INDEX IF NOT EXISTS "AiSuggestion_suggestionType_idx" ON "AiSuggestion"("suggestionType")`
];

async function main() {
  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);

  if (shouldReset) {
    for (const statement of dropStatements) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  for (const statement of createStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
  console.log("SQLite schema is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
