-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'GENERATED', 'REVIEWED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('DRAFT', 'GENERATING', 'GENERATED', 'FAILED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SessionOrigin" AS ENUM ('MANUAL', 'IMPORTED', 'GENERATED', 'REPLANNED');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planningScopeId" TEXT NOT NULL,
    "academicPeriodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "basedOnPlanId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanScenario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'DRAFT',
    "solverScore" DOUBLE PRECISION,
    "objectiveSummary" JSONB,
    "generationConfig" JSONB,
    "generatedAt" TIMESTAMP(3),
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "teachingGroupId" TEXT NOT NULL,
    "roomId" TEXT,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PLANNED',
    "origin" "SessionOrigin" NOT NULL DEFAULT 'MANUAL',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionInstructor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,

    CONSTRAINT "SessionInstructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionStudent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "SessionStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planScenarioId" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "teachingGroupId" TEXT NOT NULL,
    "roomId" TEXT,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "origin" "SessionOrigin" NOT NULL DEFAULT 'GENERATED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioSessionInstructor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scenarioSessionId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,

    CONSTRAINT "ScenarioSessionInstructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioSessionStudent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scenarioSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "ScenarioSessionStudent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plan_tenantId_status_idx" ON "Plan"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Plan_tenantId_planningScopeId_idx" ON "Plan"("tenantId", "planningScopeId");

-- CreateIndex
CREATE INDEX "Plan_tenantId_academicPeriodId_idx" ON "Plan"("tenantId", "academicPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_tenantId_planningScopeId_version_key" ON "Plan"("tenantId", "planningScopeId", "version");

-- CreateIndex
CREATE INDEX "PlanScenario_tenantId_planId_idx" ON "PlanScenario"("tenantId", "planId");

-- CreateIndex
CREATE INDEX "PlanScenario_tenantId_status_idx" ON "PlanScenario"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Session_tenantId_planId_date_idx" ON "Session"("tenantId", "planId", "date");

-- CreateIndex
CREATE INDEX "Session_tenantId_teachingGroupId_idx" ON "Session"("tenantId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "Session_tenantId_roomId_date_idx" ON "Session"("tenantId", "roomId", "date");

-- CreateIndex
CREATE INDEX "SessionInstructor_tenantId_instructorId_idx" ON "SessionInstructor"("tenantId", "instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionInstructor_tenantId_sessionId_instructorId_key" ON "SessionInstructor"("tenantId", "sessionId", "instructorId");

-- CreateIndex
CREATE INDEX "SessionStudent_tenantId_studentId_idx" ON "SessionStudent"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionStudent_tenantId_sessionId_studentId_key" ON "SessionStudent"("tenantId", "sessionId", "studentId");

-- CreateIndex
CREATE INDEX "ScenarioSession_tenantId_planScenarioId_date_idx" ON "ScenarioSession"("tenantId", "planScenarioId", "date");

-- CreateIndex
CREATE INDEX "ScenarioSession_tenantId_sourceSessionId_idx" ON "ScenarioSession"("tenantId", "sourceSessionId");

-- CreateIndex
CREATE INDEX "ScenarioSession_tenantId_teachingGroupId_idx" ON "ScenarioSession"("tenantId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "ScenarioSessionInstructor_tenantId_instructorId_idx" ON "ScenarioSessionInstructor"("tenantId", "instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioSessionInstructor_tenantId_scenarioSessionId_instru_key" ON "ScenarioSessionInstructor"("tenantId", "scenarioSessionId", "instructorId");

-- CreateIndex
CREATE INDEX "ScenarioSessionStudent_tenantId_studentId_idx" ON "ScenarioSessionStudent"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioSessionStudent_tenantId_scenarioSessionId_studentId_key" ON "ScenarioSessionStudent"("tenantId", "scenarioSessionId", "studentId");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_planningScopeId_fkey" FOREIGN KEY ("planningScopeId") REFERENCES "PlanningScope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_basedOnPlanId_fkey" FOREIGN KEY ("basedOnPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanScenario" ADD CONSTRAINT "PlanScenario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanScenario" ADD CONSTRAINT "PlanScenario_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInstructor" ADD CONSTRAINT "SessionInstructor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInstructor" ADD CONSTRAINT "SessionInstructor_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInstructor" ADD CONSTRAINT "SessionInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStudent" ADD CONSTRAINT "SessionStudent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStudent" ADD CONSTRAINT "SessionStudent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStudent" ADD CONSTRAINT "SessionStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSession" ADD CONSTRAINT "ScenarioSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSession" ADD CONSTRAINT "ScenarioSession_planScenarioId_fkey" FOREIGN KEY ("planScenarioId") REFERENCES "PlanScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSession" ADD CONSTRAINT "ScenarioSession_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSession" ADD CONSTRAINT "ScenarioSession_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSession" ADD CONSTRAINT "ScenarioSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSessionInstructor" ADD CONSTRAINT "ScenarioSessionInstructor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSessionInstructor" ADD CONSTRAINT "ScenarioSessionInstructor_scenarioSessionId_fkey" FOREIGN KEY ("scenarioSessionId") REFERENCES "ScenarioSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSessionInstructor" ADD CONSTRAINT "ScenarioSessionInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSessionStudent" ADD CONSTRAINT "ScenarioSessionStudent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSessionStudent" ADD CONSTRAINT "ScenarioSessionStudent_scenarioSessionId_fkey" FOREIGN KEY ("scenarioSessionId") REFERENCES "ScenarioSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioSessionStudent" ADD CONSTRAINT "ScenarioSessionStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
