-- CreateEnum
CREATE TYPE "StaffingRoleType" AS ENUM ('LEAD', 'ASSISTANT', 'SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "StaffingRequirementSource" AS ENUM ('COURSE', 'TEACHING_GROUP', 'ROOM');

-- CreateTable
CREATE TABLE "Qualification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Qualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorQualification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingRequirement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "StaffingRequirementSource" NOT NULL,
    "courseId" TEXT,
    "teachingGroupId" TEXT,
    "roomId" TEXT,
    "role" "StaffingRoleType" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "requiredQualificationId" TEXT,
    "minimumQualificationLevel" INTEGER,
    "minimumStudentCount" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "hard" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Qualification_tenantId_active_idx" ON "Qualification"("tenantId", "active");

-- CreateIndex
CREATE INDEX "Qualification_tenantId_name_idx" ON "Qualification"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Qualification_tenantId_code_key" ON "Qualification"("tenantId", "code");

-- CreateIndex
CREATE INDEX "InstructorQualification_tenantId_instructorId_active_idx" ON "InstructorQualification"("tenantId", "instructorId", "active");

-- CreateIndex
CREATE INDEX "InstructorQualification_tenantId_qualificationId_active_idx" ON "InstructorQualification"("tenantId", "qualificationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorQualification_tenantId_instructorId_qualification_key" ON "InstructorQualification"("tenantId", "instructorId", "qualificationId");

-- CreateIndex
CREATE INDEX "StaffingRequirement_tenantId_source_active_idx" ON "StaffingRequirement"("tenantId", "source", "active");

-- CreateIndex
CREATE INDEX "StaffingRequirement_tenantId_courseId_idx" ON "StaffingRequirement"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "StaffingRequirement_tenantId_teachingGroupId_idx" ON "StaffingRequirement"("tenantId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "StaffingRequirement_tenantId_roomId_idx" ON "StaffingRequirement"("tenantId", "roomId");

-- CreateIndex
CREATE INDEX "StaffingRequirement_tenantId_requiredQualificationId_idx" ON "StaffingRequirement"("tenantId", "requiredQualificationId");

-- AddForeignKey
ALTER TABLE "Qualification" ADD CONSTRAINT "Qualification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorQualification" ADD CONSTRAINT "InstructorQualification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorQualification" ADD CONSTRAINT "InstructorQualification_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorQualification" ADD CONSTRAINT "InstructorQualification_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "Qualification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_requiredQualificationId_fkey" FOREIGN KEY ("requiredQualificationId") REFERENCES "Qualification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
