ALTER TABLE "Tenant" ADD COLUMN "recoveryApprovalRequired" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "RecoveryCaseReviewStatus" AS ENUM (
  'NOT_REQUIRED',
  'DRAFT',
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'RETURNED'
);

ALTER TABLE "RecoveryCase"
  ADD COLUMN "basePlanVersion" INTEGER,
  ADD COLUMN "approvalRequired" BOOLEAN,
  ADD COLUMN "reviewStatus" "RecoveryCaseReviewStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "submittedForReviewAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3);

UPDATE "RecoveryCase" rc
SET
  "basePlanVersion" = p."version",
  "approvalRequired" = t."recoveryApprovalRequired",
  "reviewStatus" = CASE
    WHEN t."recoveryApprovalRequired" THEN 'DRAFT'::"RecoveryCaseReviewStatus"
    ELSE 'NOT_REQUIRED'::"RecoveryCaseReviewStatus"
  END
FROM "Plan" p, "Tenant" t
WHERE rc."planId" = p."id"
  AND rc."tenantId" = t."id";

ALTER TABLE "RecoveryCase"
  ALTER COLUMN "basePlanVersion" SET NOT NULL,
  ALTER COLUMN "approvalRequired" SET NOT NULL;

CREATE TABLE "RecoveryCaseReviewStep" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recoveryCaseId" TEXT NOT NULL,
  "caseVersion" INTEGER NOT NULL,
  "stage" INTEGER NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 1,
  "name" TEXT NOT NULL,
  "reviewerRole" TEXT,
  "reviewerId" TEXT,
  "reviewerName" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "status" "PlanReviewStepStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecoveryCaseReviewStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecoveryCaseReviewDecision" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "decision" "PlanReviewDecisionType" NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "comment" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecoveryCaseReviewDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryCaseReviewStep_tenantId_recoveryCaseId_caseVersion_stage_position_key"
ON "RecoveryCaseReviewStep"("tenantId", "recoveryCaseId", "caseVersion", "stage", "position");

CREATE INDEX "RecoveryCaseReviewStep_tenantId_recoveryCaseId_caseVersion_idx"
ON "RecoveryCaseReviewStep"("tenantId", "recoveryCaseId", "caseVersion");

CREATE INDEX "RecoveryCaseReviewStep_tenantId_reviewerId_status_idx"
ON "RecoveryCaseReviewStep"("tenantId", "reviewerId", "status");

CREATE INDEX "RecoveryCaseReviewDecision_tenantId_stepId_decidedAt_idx"
ON "RecoveryCaseReviewDecision"("tenantId", "stepId", "decidedAt");

CREATE INDEX "RecoveryCaseReviewDecision_tenantId_actorId_decidedAt_idx"
ON "RecoveryCaseReviewDecision"("tenantId", "actorId", "decidedAt");

ALTER TABLE "RecoveryCaseReviewStep"
ADD CONSTRAINT "RecoveryCaseReviewStep_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecoveryCaseReviewStep"
ADD CONSTRAINT "RecoveryCaseReviewStep_recoveryCaseId_fkey"
FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecoveryCaseReviewDecision"
ADD CONSTRAINT "RecoveryCaseReviewDecision_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecoveryCaseReviewDecision"
ADD CONSTRAINT "RecoveryCaseReviewDecision_stepId_fkey"
FOREIGN KEY ("stepId") REFERENCES "RecoveryCaseReviewStep"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
