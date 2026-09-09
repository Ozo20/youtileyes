-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrganisationUnitType" AS ENUM ('UNIVERSITY', 'FACULTY', 'DEPARTMENT', 'SCHOOL', 'PROGRAMME_AREA', 'ADMINISTRATIVE_UNIT', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('REGION', 'CITY', 'CAMPUS', 'BUILDING', 'ZONE', 'FLOOR', 'ROOM_GROUP', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationRelationType" AS ENUM ('TRAVEL', 'WALKING', 'SHUTTLE', 'OTHER');

-- CreateEnum
CREATE TYPE "AcademicPeriodType" AS ENUM ('ACADEMIC_YEAR', 'SEMESTER', 'TERM', 'TEACHING_PERIOD', 'EXAM_PERIOD', 'OTHER');

-- CreateEnum
CREATE TYPE "PlanningScopeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CREATED', 'UPDATED', 'DEACTIVATED', 'REACTIVATED', 'ARCHIVED', 'IMPORTED', 'GENERATED', 'PUBLISHED', 'OTHER');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Oslo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "OrganisationUnitType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "LocationType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "countryCode" VARCHAR(2),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "timezone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationRelation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "relationType" "LocationRelationType" NOT NULL DEFAULT 'TRAVEL',
    "minimumMinutes" INTEGER NOT NULL,
    "allowSameDay" BOOLEAN NOT NULL DEFAULT true,
    "allowBetweenSessions" BOOLEAN NOT NULL DEFAULT true,
    "preferencePenalty" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "capacity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationUnitLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organisationUnitId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganisationUnitLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "AcademicPeriodType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningScope" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicPeriodId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "PlanningScopeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningScopeOrganisationUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planningScopeId" TEXT NOT NULL,
    "organisationUnitId" TEXT NOT NULL,

    CONSTRAINT "PlanningScopeOrganisationUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningScopeLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planningScopeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "PlanningScopeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actorId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "OrganisationUnit_tenantId_parentId_idx" ON "OrganisationUnit"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "OrganisationUnit_tenantId_type_idx" ON "OrganisationUnit"("tenantId", "type");

-- CreateIndex
CREATE INDEX "OrganisationUnit_tenantId_active_idx" ON "OrganisationUnit"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationUnit_tenantId_code_key" ON "OrganisationUnit"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Location_tenantId_parentId_idx" ON "Location"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "Location_tenantId_type_idx" ON "Location"("tenantId", "type");

-- CreateIndex
CREATE INDEX "Location_tenantId_active_idx" ON "Location"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Location_tenantId_code_key" ON "Location"("tenantId", "code");

-- CreateIndex
CREATE INDEX "LocationRelation_tenantId_fromLocationId_idx" ON "LocationRelation"("tenantId", "fromLocationId");

-- CreateIndex
CREATE INDEX "LocationRelation_tenantId_toLocationId_idx" ON "LocationRelation"("tenantId", "toLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationRelation_tenantId_fromLocationId_toLocationId_relat_key" ON "LocationRelation"("tenantId", "fromLocationId", "toLocationId", "relationType");

-- CreateIndex
CREATE INDEX "Room_tenantId_locationId_idx" ON "Room"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "Room_tenantId_active_idx" ON "Room"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Room_tenantId_code_key" ON "Room"("tenantId", "code");

-- CreateIndex
CREATE INDEX "OrganisationUnitLocation_tenantId_organisationUnitId_idx" ON "OrganisationUnitLocation"("tenantId", "organisationUnitId");

-- CreateIndex
CREATE INDEX "OrganisationUnitLocation_tenantId_locationId_idx" ON "OrganisationUnitLocation"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationUnitLocation_tenantId_organisationUnitId_locati_key" ON "OrganisationUnitLocation"("tenantId", "organisationUnitId", "locationId");

-- CreateIndex
CREATE INDEX "AcademicPeriod_tenantId_parentId_idx" ON "AcademicPeriod"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "AcademicPeriod_tenantId_startDate_endDate_idx" ON "AcademicPeriod"("tenantId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicPeriod_tenantId_code_key" ON "AcademicPeriod"("tenantId", "code");

-- CreateIndex
CREATE INDEX "PlanningScope_tenantId_status_idx" ON "PlanningScope"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PlanningScope_tenantId_academicPeriodId_idx" ON "PlanningScope"("tenantId", "academicPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningScope_tenantId_code_key" ON "PlanningScope"("tenantId", "code");

-- CreateIndex
CREATE INDEX "PlanningScopeOrganisationUnit_tenantId_planningScopeId_idx" ON "PlanningScopeOrganisationUnit"("tenantId", "planningScopeId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningScopeOrganisationUnit_tenantId_planningScopeId_orga_key" ON "PlanningScopeOrganisationUnit"("tenantId", "planningScopeId", "organisationUnitId");

-- CreateIndex
CREATE INDEX "PlanningScopeLocation_tenantId_planningScopeId_idx" ON "PlanningScopeLocation"("tenantId", "planningScopeId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningScopeLocation_tenantId_planningScopeId_locationId_key" ON "PlanningScopeLocation"("tenantId", "planningScopeId", "locationId");

-- CreateIndex
CREATE INDEX "EventLog_tenantId_createdAt_idx" ON "EventLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_tenantId_entityType_entityId_idx" ON "EventLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "EventLog_tenantId_actorId_idx" ON "EventLog"("tenantId", "actorId");

-- AddForeignKey
ALTER TABLE "OrganisationUnit" ADD CONSTRAINT "OrganisationUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationUnit" ADD CONSTRAINT "OrganisationUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrganisationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationRelation" ADD CONSTRAINT "LocationRelation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationRelation" ADD CONSTRAINT "LocationRelation_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationRelation" ADD CONSTRAINT "LocationRelation_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationUnitLocation" ADD CONSTRAINT "OrganisationUnitLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationUnitLocation" ADD CONSTRAINT "OrganisationUnitLocation_organisationUnitId_fkey" FOREIGN KEY ("organisationUnitId") REFERENCES "OrganisationUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationUnitLocation" ADD CONSTRAINT "OrganisationUnitLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningScope" ADD CONSTRAINT "PlanningScope_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningScope" ADD CONSTRAINT "PlanningScope_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningScopeOrganisationUnit" ADD CONSTRAINT "PlanningScopeOrganisationUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningScopeOrganisationUnit" ADD CONSTRAINT "PlanningScopeOrganisationUnit_planningScopeId_fkey" FOREIGN KEY ("planningScopeId") REFERENCES "PlanningScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningScopeOrganisationUnit" ADD CONSTRAINT "PlanningScopeOrganisationUnit_organisationUnitId_fkey" FOREIGN KEY ("organisationUnitId") REFERENCES "OrganisationUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningScopeLocation" ADD CONSTRAINT "PlanningScopeLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningScopeLocation" ADD CONSTRAINT "PlanningScopeLocation_planningScopeId_fkey" FOREIGN KEY ("planningScopeId") REFERENCES "PlanningScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningScopeLocation" ADD CONSTRAINT "PlanningScopeLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
