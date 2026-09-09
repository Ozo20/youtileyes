-- CreateEnum
CREATE TYPE "CalendarDayType" AS ENUM ('TEACHING', 'HOLIDAY', 'PLANNING_DAY', 'EXAM', 'PRACTICE', 'ACTIVITY', 'CLOSED', 'OTHER');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'PREFERRED', 'DISCOURAGED');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('INSTRUCTOR_ABSENCE', 'STUDENT_ABSENCE', 'ROOM_UNAVAILABLE', 'LOCATION_UNAVAILABLE', 'ACTIVITY_DAY', 'SCHOOL_CLOSED', 'OTHER');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExceptionImpactMode" AS ENUM ('BLOCK', 'REDUCE_CAPACITY', 'INFORMATION_ONLY');

-- CreateTable
CREATE TABLE "CalendarDay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicPeriodId" TEXT,
    "date" DATE NOT NULL,
    "dayType" "CalendarDayType" NOT NULL DEFAULT 'TEACHING',
    "name" TEXT,
    "teachingAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAvailability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorAvailability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAvailability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningException" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "impactMode" "ExceptionImpactMode" NOT NULL DEFAULT 'BLOCK',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "instructorId" TEXT,
    "studentId" TEXT,
    "roomId" TEXT,
    "locationId" TEXT,
    "organisationUnitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarDay_tenantId_dayType_idx" ON "CalendarDay"("tenantId", "dayType");

-- CreateIndex
CREATE INDEX "CalendarDay_tenantId_academicPeriodId_idx" ON "CalendarDay"("tenantId", "academicPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarDay_tenantId_date_key" ON "CalendarDay"("tenantId", "date");

-- CreateIndex
CREATE INDEX "TimeBlock_tenantId_active_idx" ON "TimeBlock"("tenantId", "active");

-- CreateIndex
CREATE INDEX "TimeBlock_tenantId_startMinute_endMinute_idx" ON "TimeBlock"("tenantId", "startMinute", "endMinute");

-- CreateIndex
CREATE INDEX "StudentAvailability_tenantId_studentId_date_idx" ON "StudentAvailability"("tenantId", "studentId", "date");

-- CreateIndex
CREATE INDEX "StudentAvailability_tenantId_date_status_idx" ON "StudentAvailability"("tenantId", "date", "status");

-- CreateIndex
CREATE INDEX "InstructorAvailability_tenantId_instructorId_date_idx" ON "InstructorAvailability"("tenantId", "instructorId", "date");

-- CreateIndex
CREATE INDEX "InstructorAvailability_tenantId_date_status_idx" ON "InstructorAvailability"("tenantId", "date", "status");

-- CreateIndex
CREATE INDEX "RoomAvailability_tenantId_roomId_date_idx" ON "RoomAvailability"("tenantId", "roomId", "date");

-- CreateIndex
CREATE INDEX "RoomAvailability_tenantId_date_status_idx" ON "RoomAvailability"("tenantId", "date", "status");

-- CreateIndex
CREATE INDEX "PlanningException_tenantId_status_startAt_endAt_idx" ON "PlanningException"("tenantId", "status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "PlanningException_tenantId_instructorId_idx" ON "PlanningException"("tenantId", "instructorId");

-- CreateIndex
CREATE INDEX "PlanningException_tenantId_studentId_idx" ON "PlanningException"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "PlanningException_tenantId_roomId_idx" ON "PlanningException"("tenantId", "roomId");

-- CreateIndex
CREATE INDEX "PlanningException_tenantId_locationId_idx" ON "PlanningException"("tenantId", "locationId");

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAvailability" ADD CONSTRAINT "StudentAvailability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAvailability" ADD CONSTRAINT "StudentAvailability_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAvailability" ADD CONSTRAINT "InstructorAvailability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAvailability" ADD CONSTRAINT "InstructorAvailability_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAvailability" ADD CONSTRAINT "RoomAvailability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAvailability" ADD CONSTRAINT "RoomAvailability_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningException" ADD CONSTRAINT "PlanningException_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningException" ADD CONSTRAINT "PlanningException_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningException" ADD CONSTRAINT "PlanningException_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningException" ADD CONSTRAINT "PlanningException_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningException" ADD CONSTRAINT "PlanningException_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningException" ADD CONSTRAINT "PlanningException_organisationUnitId_fkey" FOREIGN KEY ("organisationUnitId") REFERENCES "OrganisationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
