ALTER TABLE "SessionInstructor"
ADD COLUMN "role" "StaffingRoleType" NOT NULL DEFAULT 'LEAD';

ALTER TABLE "RecoveryCase"
ADD COLUMN "publishedPlanId" TEXT,
ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "publishedByName" TEXT;

CREATE INDEX "RecoveryCase_tenantId_publishedPlanId_idx"
ON "RecoveryCase"("tenantId", "publishedPlanId");

ALTER TABLE "RecoveryCase"
ADD CONSTRAINT "RecoveryCase_publishedPlanId_fkey"
FOREIGN KEY ("publishedPlanId") REFERENCES "Plan"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
