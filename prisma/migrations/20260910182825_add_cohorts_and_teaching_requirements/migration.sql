-- CreateEnum
CREATE TYPE "StudentCohortType" AS ENUM ('CLASS', 'PROGRAMME', 'COHORT', 'OTHER');

-- CreateEnum
CREATE TYPE "TeachingGroupMembershipMode" AS ENUM ('CUSTOM', 'FULL_COHORT');

-- CreateEnum
CREATE TYPE "TeachingDistributionMode" AS ENUM ('EVEN_BY_TEACHING_CAPACITY', 'EVEN_BY_WEEK', 'FLEXIBLE');

-- AlterTable
ALTER TABLE "PlanningException" ADD COLUMN     "studentCohortId" TEXT,
ADD COLUMN     "teachingGroupId" TEXT;

-- AlterTable
ALTER TABLE "TeachingGroup" ADD COLUMN     "membershipMode" "TeachingGroupMembershipMode" NOT NULL DEFAULT 'CUSTOM',
ADD COLUMN     "schedulingPriority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "studentCohortId" TEXT;

-- CreateTable
CREATE TABLE "StudentCohort" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicPeriodId" TEXT,
    "organisationUnitId" TEXT,
    "type" "StudentCohortType" NOT NULL DEFAULT 'CLASS',
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCohortMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentCohortId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentCohortMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingRequirement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teachingGroupId" TEXT NOT NULL,
    "academicPeriodId" TEXT NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "distributionMode" "TeachingDistributionMode" NOT NULL DEFAULT 'EVEN_BY_TEACHING_CAPACITY',
    "minWeeklyMinutes" INTEGER,
    "preferredWeeklyMinutes" INTEGER,
    "maxWeeklyMinutes" INTEGER,
    "carryoverAllowed" BOOLEAN NOT NULL DEFAULT true,
    "priority" "RequirementPriority" NOT NULL DEFAULT 'NORMAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingRequirementWeek" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teachingRequirementId" TEXT NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "minMinutes" INTEGER,
    "maxMinutes" INTEGER,
    "availableTeachingDays" INTEGER NOT NULL,
    "adjustmentReason" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingRequirementWeek_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentCohort_tenantId_active_idx" ON "StudentCohort"("tenantId", "active");

-- CreateIndex
CREATE INDEX "StudentCohort_tenantId_academicPeriodId_idx" ON "StudentCohort"("tenantId", "academicPeriodId");

-- CreateIndex
CREATE INDEX "StudentCohort_tenantId_organisationUnitId_idx" ON "StudentCohort"("tenantId", "organisationUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentCohort_tenantId_code_key" ON "StudentCohort"("tenantId", "code");

-- CreateIndex
CREATE INDEX "StudentCohortMember_tenantId_studentCohortId_idx" ON "StudentCohortMember"("tenantId", "studentCohortId");

-- CreateIndex
CREATE INDEX "StudentCohortMember_tenantId_studentId_idx" ON "StudentCohortMember"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentCohortMember_tenantId_studentCohortId_studentId_key" ON "StudentCohortMember"("tenantId", "studentCohortId", "studentId");

-- CreateIndex
CREATE INDEX "TeachingRequirement_tenantId_academicPeriodId_idx" ON "TeachingRequirement"("tenantId", "academicPeriodId");

-- CreateIndex
CREATE INDEX "TeachingRequirement_tenantId_teachingGroupId_idx" ON "TeachingRequirement"("tenantId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "TeachingRequirement_tenantId_active_idx" ON "TeachingRequirement"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRequirement_tenantId_teachingGroupId_academicPeriod_key" ON "TeachingRequirement"("tenantId", "teachingGroupId", "academicPeriodId");

-- CreateIndex
CREATE INDEX "TeachingRequirementWeek_tenantId_weekStartDate_idx" ON "TeachingRequirementWeek"("tenantId", "weekStartDate");

-- CreateIndex
CREATE INDEX "TeachingRequirementWeek_tenantId_teachingRequirementId_idx" ON "TeachingRequirementWeek"("tenantId", "teachingRequirementId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRequirementWeek_tenantId_teachingRequirementId_week_key" ON "TeachingRequirementWeek"("tenantId", "teachingRequirementId", "weekStartDate");

-- CreateIndex
CREATE INDEX "PlanningException_tenantId_studentCohortId_idx" ON "PlanningException"("tenantId", "studentCohortId");

-- CreateIndex
CREATE INDEX "PlanningException_tenantId_teachingGroupId_idx" ON "PlanningException"("tenantId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "TeachingGroup_tenantId_studentCohortId_idx" ON "TeachingGroup"("tenantId", "studentCohortId");

-- AddForeignKey
ALTER TABLE "StudentCohort" ADD CONSTRAINT "StudentCohort_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCohort" ADD CONSTRAINT "StudentCohort_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCohort" ADD CONSTRAINT "StudentCohort_organisationUnitId_fkey" FOREIGN KEY ("organisationUnitId") REFERENCES "OrganisationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCohortMember" ADD CONSTRAINT "StudentCohortMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCohortMember" ADD CONSTRAINT "StudentCohortMember_studentCohortId_fkey" FOREIGN KEY ("studentCohortId") REFERENCES "StudentCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCohortMember" ADD CONSTRAINT "StudentCohortMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGroup" ADD CONSTRAINT "TeachingGroup_studentCohortId_fkey" FOREIGN KEY ("studentCohortId") REFERENCES "StudentCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRequirement" ADD CONSTRAINT "TeachingRequirement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRequirement" ADD CONSTRAINT "TeachingRequirement_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRequirement" ADD CONSTRAINT "TeachingRequirement_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRequirementWeek" ADD CONSTRAINT "TeachingRequirementWeek_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRequirementWeek" ADD CONSTRAINT "TeachingRequirementWeek_teachingRequirementId_fkey" FOREIGN KEY ("teachingRequirementId") REFERENCES "TeachingRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningException" ADD CONSTRAINT "PlanningException_studentCohortId_fkey" FOREIGN KEY ("studentCohortId") REFERENCES "StudentCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningException" ADD CONSTRAINT "PlanningException_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
