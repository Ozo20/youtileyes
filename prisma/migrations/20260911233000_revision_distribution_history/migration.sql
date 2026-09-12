CREATE TYPE "DistributionFormat" AS ENUM ('PDF', 'CSV', 'JSON');
CREATE TYPE "DistributionStatus" AS ENUM ('GENERATED', 'DELIVERED', 'FAILED');

CREATE TABLE "PlanDistribution" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "format" "DistributionFormat" NOT NULL,
  "status" "DistributionStatus" NOT NULL DEFAULT 'GENERATED',
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "generatedByName" TEXT,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "PlanDistribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanDistribution_tenantId_planId_generatedAt_idx"
ON "PlanDistribution"("tenantId", "planId", "generatedAt");
CREATE INDEX "PlanDistribution_tenantId_format_generatedAt_idx"
ON "PlanDistribution"("tenantId", "format", "generatedAt");
CREATE INDEX "PlanDistribution_tenantId_status_generatedAt_idx"
ON "PlanDistribution"("tenantId", "status", "generatedAt");

ALTER TABLE "PlanDistribution"
ADD CONSTRAINT "PlanDistribution_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanDistribution"
ADD CONSTRAINT "PlanDistribution_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "Plan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
