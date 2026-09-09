-- CreateEnum
CREATE TYPE "SolverJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SolverRunStatus" AS ENUM ('STARTED', 'FEASIBLE', 'OPTIMAL', 'INFEASIBLE', 'UNKNOWN', 'FAILED');

-- CreateEnum
CREATE TYPE "ConstraintViolationSeverity" AS ENUM ('INFO', 'WARNING', 'BLOCKING');

-- CreateEnum
CREATE TYPE "ScenarioMetricType" AS ENUM ('TOTAL_TEACHING_MINUTES', 'UNFULFILLED_TEACHING_MINUTES', 'STUDENT_IDLE_MINUTES', 'INSTRUCTOR_IDLE_MINUTES', 'ROOM_UTILISATION_PERCENT', 'INSTRUCTOR_UTILISATION_PERCENT', 'SESSION_CHANGE_COUNT', 'ROOM_CHANGE_COUNT', 'INSTRUCTOR_CHANGE_COUNT', 'TRAVEL_MINUTES', 'SOFT_CONSTRAINT_PENALTY', 'HARD_CONSTRAINT_VIOLATIONS', 'OTHER');

-- CreateEnum
CREATE TYPE "ScenarioChangeType" AS ENUM ('CREATED', 'MOVED', 'CANCELLED', 'ROOM_CHANGED', 'INSTRUCTOR_CHANGED', 'STUDENTS_CHANGED', 'LOCK_CHANGED', 'OTHER');

-- CreateTable
CREATE TABLE "SolverJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planScenarioId" TEXT NOT NULL,
    "status" "SolverJobStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedById" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "config" JSONB,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolverJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolverRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "solverJobId" TEXT NOT NULL,
    "status" "SolverRunStatus" NOT NULL DEFAULT 'STARTED',
    "solverName" TEXT NOT NULL,
    "solverVersion" TEXT,
    "objectiveValue" DOUBLE PRECISION,
    "bestBound" DOUBLE PRECISION,
    "wallTimeSeconds" DOUBLE PRECISION,
    "branches" BIGINT,
    "conflicts" BIGINT,
    "deterministicTime" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "diagnostics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolverRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolverObjective" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planScenarioId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "targetValue" DOUBLE PRECISION,
    "actualValue" DOUBLE PRECISION,
    "penaltyValue" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolverObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstraintViolation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "solverRunId" TEXT NOT NULL,
    "planningRuleId" TEXT,
    "severity" "ConstraintViolationSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "penaltyValue" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstraintViolation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planScenarioId" TEXT NOT NULL,
    "metricType" "ScenarioMetricType" NOT NULL,
    "key" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planScenarioId" TEXT NOT NULL,
    "scenarioSessionId" TEXT,
    "sourceSessionId" TEXT,
    "changeType" "ScenarioChangeType" NOT NULL,
    "explanationCode" TEXT,
    "explanation" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "penaltyDelta" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolverJob_tenantId_status_idx" ON "SolverJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SolverJob_tenantId_planScenarioId_idx" ON "SolverJob"("tenantId", "planScenarioId");

-- CreateIndex
CREATE INDEX "SolverJob_tenantId_queuedAt_idx" ON "SolverJob"("tenantId", "queuedAt");

-- CreateIndex
CREATE INDEX "SolverRun_tenantId_solverJobId_idx" ON "SolverRun"("tenantId", "solverJobId");

-- CreateIndex
CREATE INDEX "SolverRun_tenantId_status_idx" ON "SolverRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SolverObjective_tenantId_planScenarioId_idx" ON "SolverObjective"("tenantId", "planScenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "SolverObjective_tenantId_planScenarioId_key_key" ON "SolverObjective"("tenantId", "planScenarioId", "key");

-- CreateIndex
CREATE INDEX "ConstraintViolation_tenantId_solverRunId_idx" ON "ConstraintViolation"("tenantId", "solverRunId");

-- CreateIndex
CREATE INDEX "ConstraintViolation_tenantId_planningRuleId_idx" ON "ConstraintViolation"("tenantId", "planningRuleId");

-- CreateIndex
CREATE INDEX "ConstraintViolation_tenantId_severity_idx" ON "ConstraintViolation"("tenantId", "severity");

-- CreateIndex
CREATE INDEX "ConstraintViolation_tenantId_entityType_entityId_idx" ON "ConstraintViolation"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "ScenarioMetric_tenantId_planScenarioId_idx" ON "ScenarioMetric"("tenantId", "planScenarioId");

-- CreateIndex
CREATE INDEX "ScenarioMetric_tenantId_metricType_idx" ON "ScenarioMetric"("tenantId", "metricType");

-- CreateIndex
CREATE INDEX "ScenarioChange_tenantId_planScenarioId_idx" ON "ScenarioChange"("tenantId", "planScenarioId");

-- CreateIndex
CREATE INDEX "ScenarioChange_tenantId_scenarioSessionId_idx" ON "ScenarioChange"("tenantId", "scenarioSessionId");

-- CreateIndex
CREATE INDEX "ScenarioChange_tenantId_sourceSessionId_idx" ON "ScenarioChange"("tenantId", "sourceSessionId");

-- CreateIndex
CREATE INDEX "ScenarioChange_tenantId_changeType_idx" ON "ScenarioChange"("tenantId", "changeType");

-- AddForeignKey
ALTER TABLE "SolverJob" ADD CONSTRAINT "SolverJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolverJob" ADD CONSTRAINT "SolverJob_planScenarioId_fkey" FOREIGN KEY ("planScenarioId") REFERENCES "PlanScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolverRun" ADD CONSTRAINT "SolverRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolverRun" ADD CONSTRAINT "SolverRun_solverJobId_fkey" FOREIGN KEY ("solverJobId") REFERENCES "SolverJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolverObjective" ADD CONSTRAINT "SolverObjective_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolverObjective" ADD CONSTRAINT "SolverObjective_planScenarioId_fkey" FOREIGN KEY ("planScenarioId") REFERENCES "PlanScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstraintViolation" ADD CONSTRAINT "ConstraintViolation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstraintViolation" ADD CONSTRAINT "ConstraintViolation_solverRunId_fkey" FOREIGN KEY ("solverRunId") REFERENCES "SolverRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstraintViolation" ADD CONSTRAINT "ConstraintViolation_planningRuleId_fkey" FOREIGN KEY ("planningRuleId") REFERENCES "PlanningRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioMetric" ADD CONSTRAINT "ScenarioMetric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioMetric" ADD CONSTRAINT "ScenarioMetric_planScenarioId_fkey" FOREIGN KEY ("planScenarioId") REFERENCES "PlanScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioChange" ADD CONSTRAINT "ScenarioChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioChange" ADD CONSTRAINT "ScenarioChange_planScenarioId_fkey" FOREIGN KEY ("planScenarioId") REFERENCES "PlanScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioChange" ADD CONSTRAINT "ScenarioChange_scenarioSessionId_fkey" FOREIGN KEY ("scenarioSessionId") REFERENCES "ScenarioSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioChange" ADD CONSTRAINT "ScenarioChange_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
