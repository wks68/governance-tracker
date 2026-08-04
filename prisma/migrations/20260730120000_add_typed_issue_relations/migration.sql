-- Additive draft only. This migration must be reviewed and applied through the
-- normal release process; the feature gate verification deploys it only to a
-- freshly created scratch SQLite database.
CREATE TABLE "IssueRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceIssueId" TEXT NOT NULL,
    "targetIssueId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedById" TEXT,
    "removedAt" DATETIME,
    "removalReason" TEXT,
    CONSTRAINT "IssueRelation_sourceIssueId_fkey" FOREIGN KEY ("sourceIssueId") REFERENCES "Issue" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueRelation_targetIssueId_fkey" FOREIGN KEY ("targetIssueId") REFERENCES "Issue" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueRelation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "IssueRelation_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "IssueRelation_sourceIssueId_idx" ON "IssueRelation"("sourceIssueId");
CREATE INDEX "IssueRelation_targetIssueId_idx" ON "IssueRelation"("targetIssueId");
CREATE INDEX "IssueRelation_relationType_idx" ON "IssueRelation"("relationType");
CREATE INDEX "IssueRelation_removedAt_idx" ON "IssueRelation"("removedAt");

-- The same active typed relation may exist at most once. Removed rows remain
-- immutable history and do not block a later, newly inserted relation row.
CREATE UNIQUE INDEX "IssueRelation_active_pair_unique"
ON "IssueRelation"("sourceIssueId", "targetIssueId", "relationType")
WHERE "removedAt" IS NULL;

-- A Hotfix has at most one active primary quarterly project relation.
CREATE UNIQUE INDEX "IssueRelation_active_hotfix_project_unique"
ON "IssueRelation"("sourceIssueId")
WHERE "relationType" = 'HOTFIX_TO_PROJECT'
  AND "removedAt" IS NULL;
