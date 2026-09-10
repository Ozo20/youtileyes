-- CreateEnum
CREATE TYPE "PlanReviewWorkflowStatus" AS ENUM ('DRAFT', 'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanReviewStepStatus" AS ENUM ('PENDING', 'READY', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PlanReviewDecisionType" AS ENUM ('APPROVE', 'REJECT', 'RETURN_FOR_CHANGES');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'SUBMITTED';
ALTER TYPE "EventType" ADD VALUE 'APPROVED';
ALTER TYPE "EventType" ADD VALUE 'REJECTED';
ALTER TYPE "EventType" ADD VALUE 'SUPERSEDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "PlanStatus" ADD VALUE 'IN_REVIEW';
ALTER TYPE "PlanStatus" ADD VALUE 'APPROVED';
ALTER TYPE "PlanStatus" ADD VALUE 'SUPERSEDED';

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "effectiveFrom" DATE,
ADD COLUMN     "effectiveTo" DATE,
ADD COLUMN     "frozenThroughDate" DATE,
ADD COLUMN     "planningAsOfDate" DATE,
ADD COLUMN     "planningEndDate" DATE,
ADD COLUMN     "planningStartDate" DATE,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlanReviewWorkflow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PlanReviewWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanReviewWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanReviewStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
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

    CONSTRAINT "PlanReviewStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanReviewDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "decision" "PlanReviewDecisionType" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanReviewWorkflow_tenantId_status_idx" ON "PlanReviewWorkflow"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PlanReviewWorkflow_tenantId_planId_idx" ON "PlanReviewWorkflow"("tenantId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanReviewWorkflow_tenantId_planId_name_key" ON "PlanReviewWorkflow"("tenantId", "planId", "name");

-- CreateIndex
CREATE INDEX "PlanReviewStep_tenantId_workflowId_stage_idx" ON "PlanReviewStep"("tenantId", "workflowId", "stage");

-- CreateIndex
CREATE INDEX "PlanReviewStep_tenantId_reviewerId_status_idx" ON "PlanReviewStep"("tenantId", "reviewerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanReviewStep_tenantId_workflowId_stage_position_key" ON "PlanReviewStep"("tenantId", "workflowId", "stage", "position");

-- CreateIndex
CREATE INDEX "PlanReviewDecision_tenantId_stepId_decidedAt_idx" ON "PlanReviewDecision"("tenantId", "stepId", "decidedAt");

-- CreateIndex
CREATE INDEX "PlanReviewDecision_tenantId_actorId_decidedAt_idx" ON "PlanReviewDecision"("tenantId", "actorId", "decidedAt");

-- AddForeignKey
ALTER TABLE "PlanReviewWorkflow" ADD CONSTRAINT "PlanReviewWorkflow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanReviewWorkflow" ADD CONSTRAINT "PlanReviewWorkflow_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanReviewStep" ADD CONSTRAINT "PlanReviewStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanReviewStep" ADD CONSTRAINT "PlanReviewStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "PlanReviewWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanReviewDecision" ADD CONSTRAINT "PlanReviewDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanReviewDecision" ADD CONSTRAINT "PlanReviewDecision_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PlanReviewStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
