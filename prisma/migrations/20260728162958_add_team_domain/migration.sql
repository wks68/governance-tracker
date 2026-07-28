-- AlterTable
ALTER TABLE "Team" ADD COLUMN "domain" TEXT;

-- CreateIndex
CREATE INDEX "Team_domain_idx" ON "Team"("domain");
