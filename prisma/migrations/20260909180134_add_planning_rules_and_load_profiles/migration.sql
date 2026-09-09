-- CreateEnum
CREATE TYPE "PlanningRuleType" AS ENUM ('MAX_TEACHING_MINUTES_PER_DAY', 'MAX_CONTINUOUS_TEACHING_MINUTES', 'MIN_BREAK_MINUTES', 'MIN_LUNCH_MINUTES', 'MAX_SESSIONS_PER_DAY', 'MIN_REAL_BREAK_MINUTES', 'MIN_BREAK_AFTER_SESSION', 'MAX_COURSE_SESSIONS_PER_DAY', 'PREFERRED_SESSION_LENGTH', 'REQUIRE_DOUBLE_SESSION', 'ALLOW_DOUBLE_SESSION', 'LOCATION_TRAVEL_BUFFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PlanningRuleScopeType" AS ENUM ('TENANT', 'ORGANISATION_UNIT', 'LOCATION', 'COURSE', 'TEACHING_GROUP', 'STUDENT', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "PlanningRuleConstraintType" AS ENUM ('HARD', 'SOFT');

-- CreateEnum
CREATE TYPE "PlanningRuleValueUnit" AS ENUM ('MINUTES', 'COUNT', 'BOOLEAN', 'PERCENT', 'SCORE', 'NONE');

-- AlterTable
ALTER TABLE "Instructor" ADD COLUMN     "loadProfileId" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "loadProfileId" TEXT;

-- CreateTable
CREATE TABLE "LoadProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "maxTeachingMinutesPerDay" INTEGER,
    "maxContinuousTeachingMinutes" INTEGER,
    "minBreakMinutes" INTEGER,
    "minLunchMinutes" INTEGER,
    "maxSessionsPerDay" INTEGER,
    "minRealBreakMinutes" INTEGER,
    "travelConsumesBreakTime" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoadProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ruleType" "PlanningRuleType" NOT NULL,
    "scopeType" "PlanningRuleScopeType" NOT NULL,
    "constraintType" "PlanningRuleConstraintType" NOT NULL DEFAULT 'SOFT',
    "valueInt" INTEGER,
    "valueBoolean" BOOLEAN,
    "valueText" TEXT,
    "valueUnit" "PlanningRuleValueUnit" NOT NULL DEFAULT 'NONE',
    "weight" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "organisationUnitId" TEXT,
    "locationId" TEXT,
    "courseId" TEXT,
    "teachingGroupId" TEXT,
    "studentId" TEXT,
    "instructorId" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoadProfile_tenantId_active_idx" ON "LoadProfile"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LoadProfile_tenantId_code_key" ON "LoadProfile"("tenantId", "code");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_ruleType_idx" ON "PlanningRule"("tenantId", "ruleType");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_scopeType_idx" ON "PlanningRule"("tenantId", "scopeType");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_active_idx" ON "PlanningRule"("tenantId", "active");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_organisationUnitId_idx" ON "PlanningRule"("tenantId", "organisationUnitId");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_locationId_idx" ON "PlanningRule"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_courseId_idx" ON "PlanningRule"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_teachingGroupId_idx" ON "PlanningRule"("tenantId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_studentId_idx" ON "PlanningRule"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "PlanningRule_tenantId_instructorId_idx" ON "PlanningRule"("tenantId", "instructorId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_loadProfileId_fkey" FOREIGN KEY ("loadProfileId") REFERENCES "LoadProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_loadProfileId_fkey" FOREIGN KEY ("loadProfileId") REFERENCES "LoadProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadProfile" ADD CONSTRAINT "LoadProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_organisationUnitId_fkey" FOREIGN KEY ("organisationUnitId") REFERENCES "OrganisationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
