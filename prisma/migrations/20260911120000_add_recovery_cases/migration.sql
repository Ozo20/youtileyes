CREATE TYPE "RecoveryCaseStatus" AS ENUM ('OPEN', 'GENERATING', 'READY', 'ACCEPTED', 'CLOSED');
CREATE TYPE "RecoveryDisruptionType" AS ENUM ('INSTRUCTOR_UNAVAILABLE', 'ROOM_UNAVAILABLE');
CREATE TYPE "RecoveryProposalStatus" AS ENUM ('CURRENT', 'STALE', 'ACCEPTED', 'REJECTED');

CREATE TABLE "RecoveryCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "baseScenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecoveryCaseStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "acceptedScenarioId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecoveryCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecoveryDisruption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "type" "RecoveryDisruptionType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceLabel" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecoveryDisruption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecoveryCaseProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "status" "RecoveryProposalStatus" NOT NULL DEFAULT 'CURRENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecoveryCaseProposal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SolverJob" ADD COLUMN "recoveryCaseId" TEXT;

CREATE INDEX "RecoveryCase_tenantId_planId_status_idx" ON "RecoveryCase"("tenantId", "planId", "status");
CREATE INDEX "RecoveryCase_tenantId_baseScenarioId_idx" ON "RecoveryCase"("tenantId", "baseScenarioId");
CREATE INDEX "RecoveryDisruption_tenantId_recoveryCaseId_active_idx" ON "RecoveryDisruption"("tenantId", "recoveryCaseId", "active");
CREATE INDEX "RecoveryDisruption_tenantId_type_resourceId_idx" ON "RecoveryDisruption"("tenantId", "type", "resourceId");
CREATE UNIQUE INDEX "RecoveryCaseProposal_recoveryCaseId_scenarioId_key" ON "RecoveryCaseProposal"("recoveryCaseId", "scenarioId");
CREATE INDEX "RecoveryCaseProposal_tenantId_recoveryCaseId_status_idx" ON "RecoveryCaseProposal"("tenantId", "recoveryCaseId", "status");
CREATE INDEX "RecoveryCaseProposal_tenantId_scenarioId_idx" ON "RecoveryCaseProposal"("tenantId", "scenarioId");
CREATE INDEX "SolverJob_tenantId_recoveryCaseId_idx" ON "SolverJob"("tenantId", "recoveryCaseId");

ALTER TABLE "RecoveryCase" ADD CONSTRAINT "RecoveryCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecoveryCase" ADD CONSTRAINT "RecoveryCase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecoveryCase" ADD CONSTRAINT "RecoveryCase_baseScenarioId_fkey" FOREIGN KEY ("baseScenarioId") REFERENCES "PlanScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecoveryDisruption" ADD CONSTRAINT "RecoveryDisruption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecoveryDisruption" ADD CONSTRAINT "RecoveryDisruption_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecoveryCaseProposal" ADD CONSTRAINT "RecoveryCaseProposal_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecoveryCaseProposal" ADD CONSTRAINT "RecoveryCaseProposal_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "PlanScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SolverJob" ADD CONSTRAINT "SolverJob_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
