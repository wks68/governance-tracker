-- CreateTable
CREATE TABLE "RcaActionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rcaIssueId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerTeamId" TEXT,
    "ownerUserId" TEXT,
    "plannedCompletionDate" DATETIME,
    "actualCompletionDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "evidenceSummary" TEXT,
    "verificationMethod" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "verifierUserId" TEXT,
    "verifiedAt" DATETIME,
    "verificationNote" TEXT,
    "extensionReason" TEXT,
    "riskExceptionReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RcaActionItem_rcaIssueId_fkey" FOREIGN KEY ("rcaIssueId") REFERENCES "Issue" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "RcaActionItem_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "RcaActionItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "RcaActionItem_verifierUserId_fkey" FOREIGN KEY ("verifierUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateIndex
CREATE INDEX "RcaActionItem_rcaIssueId_idx" ON "RcaActionItem"("rcaIssueId");

-- CreateIndex
CREATE INDEX "RcaActionItem_ownerUserId_idx" ON "RcaActionItem"("ownerUserId");

-- CreateIndex
CREATE INDEX "RcaActionItem_status_idx" ON "RcaActionItem"("status");

-- CreateIndex
CREATE INDEX "RcaActionItem_verificationStatus_idx" ON "RcaActionItem"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "RcaActionItem_rcaIssueId_sequence_key" ON "RcaActionItem"("rcaIssueId", "sequence");
