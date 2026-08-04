-- CreateTable
CREATE TABLE "UserSupervisorAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "supervisorUserId" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validUntil" DATETIME,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSupervisorAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "UserSupervisorAssignment_supervisorUserId_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "UserSupervisorAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "ApprovalDelegation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "delegatorUserId" TEXT NOT NULL,
    "delegateUserId" TEXT NOT NULL,
    "teamId" TEXT,
    "approvalType" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validUntil" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL DEFAULT '',
    "revokedAt" DATETIME,
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApprovalDelegation_delegatorUserId_fkey" FOREIGN KEY ("delegatorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalDelegation_delegateUserId_fkey" FOREIGN KEY ("delegateUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalDelegation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalDelegation_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ApprovalDelegation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "ApprovalRecord" (
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
    "approvalAuthorityType" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "StageRiskCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "approvalRecordId" TEXT,
    "stageKey" TEXT NOT NULL,
    "assessmentRound" INTEGER NOT NULL,
    "checkKey" TEXT NOT NULL,
    "answer" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "answeredByUserId" TEXT,
    "answeredAt" DATETIME,
    "verificationOwnerUserId" TEXT,
    "verificationDueAt" DATETIME,
    "resolvedByUserId" TEXT,
    "resolutionComment" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StageRiskCheck_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "StageRiskCheck_approvalRecordId_fkey" FOREIGN KEY ("approvalRecordId") REFERENCES "ApprovalRecord" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "StageRiskCheck_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "StageRiskCheck_verificationOwnerUserId_fkey" FOREIGN KEY ("verificationOwnerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "StageRiskCheck_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateIndex
CREATE INDEX "UserSupervisorAssignment_userId_isActive_idx" ON "UserSupervisorAssignment"("userId", "isActive");

-- CreateIndex
CREATE INDEX "UserSupervisorAssignment_supervisorUserId_idx" ON "UserSupervisorAssignment"("supervisorUserId");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_delegateUserId_isActive_idx" ON "ApprovalDelegation"("delegateUserId", "isActive");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_delegatorUserId_idx" ON "ApprovalDelegation"("delegatorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRecord_supersedesApprovalRecordId_key" ON "ApprovalRecord"("supersedesApprovalRecordId");

-- CreateIndex
CREATE INDEX "ApprovalRecord_issueId_approvalType_recordStatus_idx" ON "ApprovalRecord"("issueId", "approvalType", "recordStatus");

-- CreateIndex
CREATE INDEX "ApprovalRecord_decision_idx" ON "ApprovalRecord"("decision");

-- CreateIndex
CREATE INDEX "ApprovalRecord_approverUserId_idx" ON "ApprovalRecord"("approverUserId");

-- CreateIndex
CREATE INDEX "ApprovalRecord_dueAt_idx" ON "ApprovalRecord"("dueAt");

-- CreateIndex
CREATE INDEX "StageRiskCheck_issueId_idx" ON "StageRiskCheck"("issueId");

-- CreateIndex
CREATE INDEX "StageRiskCheck_answer_idx" ON "StageRiskCheck"("answer");

-- CreateIndex
CREATE UNIQUE INDEX "StageRiskCheck_issueId_stageKey_assessmentRound_checkKey_key" ON "StageRiskCheck"("issueId", "stageKey", "assessmentRound", "checkKey");

-- CreateIndex (手動追加：同一 issueId+approvalType+relatedStageKey 僅允許一筆 ACTIVE+PENDING，SQLite 不支援 schema.prisma 語法表達條件式唯一索引)
CREATE UNIQUE INDEX "ApprovalRecord_one_active_pending"
ON "ApprovalRecord" (
  "issueId",
  "approvalType",
  "relatedStageKey"
)
WHERE "recordStatus" = 'ACTIVE'
  AND "decision" = 'PENDING';
