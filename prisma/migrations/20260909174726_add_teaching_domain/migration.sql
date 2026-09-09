-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RequirementPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TeachingGroupStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseDeliveryMode" AS ENUM ('IN_PERSON', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "QualificationLevel" AS ENUM ('PRIMARY', 'SECONDARY', 'SUPPORT');

-- CreateEnum
CREATE TYPE "RequirementUnit" AS ENUM ('MINUTES', 'HOURS');

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceSystem" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "primaryOrganisationUnitId" TEXT,
    "primaryLocationId" TEXT,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instructor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceSystem" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "employmentPercentage" DECIMAL(5,2),
    "maxTeachingMinutesPerWeek" INTEGER,
    "primaryOrganisationUnitId" TEXT,
    "primaryLocationId" TEXT,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceSystem" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "deliveryMode" "CourseDeliveryMode" NOT NULL DEFAULT 'IN_PERSON',
    "standardGroupSize" INTEGER,
    "maxGroupSize" INTEGER,
    "minSessionMinutes" INTEGER,
    "preferredSessionMinutes" INTEGER,
    "maxSessionMinutes" INTEGER,
    "allowDoubleSession" BOOLEAN NOT NULL DEFAULT false,
    "maxSessionsPerDay" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorCourse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "qualificationLevel" "QualificationLevel" NOT NULL DEFAULT 'PRIMARY',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCourseRequirement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "academicPeriodId" TEXT NOT NULL,
    "requiredAmount" INTEGER NOT NULL,
    "unit" "RequirementUnit" NOT NULL DEFAULT 'MINUTES',
    "priority" "RequirementPriority" NOT NULL DEFAULT 'NORMAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCourseRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicPeriodId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "minStudents" INTEGER,
    "maxStudents" INTEGER,
    "status" "TeachingGroupStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingGroupStudent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teachingGroupId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingGroupStudent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Student_tenantId_status_idx" ON "Student"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Student_tenantId_lastName_firstName_idx" ON "Student"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Student_tenantId_primaryOrganisationUnitId_idx" ON "Student"("tenantId", "primaryOrganisationUnitId");

-- CreateIndex
CREATE INDEX "Student_tenantId_primaryLocationId_idx" ON "Student"("tenantId", "primaryLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_tenantId_externalId_sourceSystem_key" ON "Student"("tenantId", "externalId", "sourceSystem");

-- CreateIndex
CREATE INDEX "Instructor_tenantId_status_idx" ON "Instructor"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Instructor_tenantId_lastName_firstName_idx" ON "Instructor"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Instructor_tenantId_primaryOrganisationUnitId_idx" ON "Instructor"("tenantId", "primaryOrganisationUnitId");

-- CreateIndex
CREATE INDEX "Instructor_tenantId_primaryLocationId_idx" ON "Instructor"("tenantId", "primaryLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Instructor_tenantId_externalId_sourceSystem_key" ON "Instructor"("tenantId", "externalId", "sourceSystem");

-- CreateIndex
CREATE INDEX "Course_tenantId_active_idx" ON "Course"("tenantId", "active");

-- CreateIndex
CREATE INDEX "Course_tenantId_name_idx" ON "Course"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Course_tenantId_code_key" ON "Course"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Course_tenantId_externalId_sourceSystem_key" ON "Course"("tenantId", "externalId", "sourceSystem");

-- CreateIndex
CREATE INDEX "InstructorCourse_tenantId_instructorId_idx" ON "InstructorCourse"("tenantId", "instructorId");

-- CreateIndex
CREATE INDEX "InstructorCourse_tenantId_courseId_idx" ON "InstructorCourse"("tenantId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorCourse_tenantId_instructorId_courseId_key" ON "InstructorCourse"("tenantId", "instructorId", "courseId");

-- CreateIndex
CREATE INDEX "InstructorLocation_tenantId_instructorId_idx" ON "InstructorLocation"("tenantId", "instructorId");

-- CreateIndex
CREATE INDEX "InstructorLocation_tenantId_locationId_idx" ON "InstructorLocation"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorLocation_tenantId_instructorId_locationId_key" ON "InstructorLocation"("tenantId", "instructorId", "locationId");

-- CreateIndex
CREATE INDEX "StudentCourseRequirement_tenantId_studentId_idx" ON "StudentCourseRequirement"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "StudentCourseRequirement_tenantId_courseId_idx" ON "StudentCourseRequirement"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "StudentCourseRequirement_tenantId_academicPeriodId_idx" ON "StudentCourseRequirement"("tenantId", "academicPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentCourseRequirement_tenantId_studentId_courseId_academ_key" ON "StudentCourseRequirement"("tenantId", "studentId", "courseId", "academicPeriodId");

-- CreateIndex
CREATE INDEX "TeachingGroup_tenantId_academicPeriodId_idx" ON "TeachingGroup"("tenantId", "academicPeriodId");

-- CreateIndex
CREATE INDEX "TeachingGroup_tenantId_courseId_idx" ON "TeachingGroup"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "TeachingGroup_tenantId_status_idx" ON "TeachingGroup"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingGroup_tenantId_code_key" ON "TeachingGroup"("tenantId", "code");

-- CreateIndex
CREATE INDEX "TeachingGroupStudent_tenantId_teachingGroupId_idx" ON "TeachingGroupStudent"("tenantId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "TeachingGroupStudent_tenantId_studentId_idx" ON "TeachingGroupStudent"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingGroupStudent_tenantId_teachingGroupId_studentId_key" ON "TeachingGroupStudent"("tenantId", "teachingGroupId", "studentId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_primaryOrganisationUnitId_fkey" FOREIGN KEY ("primaryOrganisationUnitId") REFERENCES "OrganisationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_primaryOrganisationUnitId_fkey" FOREIGN KEY ("primaryOrganisationUnitId") REFERENCES "OrganisationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorCourse" ADD CONSTRAINT "InstructorCourse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorCourse" ADD CONSTRAINT "InstructorCourse_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorCourse" ADD CONSTRAINT "InstructorCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorLocation" ADD CONSTRAINT "InstructorLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorLocation" ADD CONSTRAINT "InstructorLocation_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorLocation" ADD CONSTRAINT "InstructorLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCourseRequirement" ADD CONSTRAINT "StudentCourseRequirement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCourseRequirement" ADD CONSTRAINT "StudentCourseRequirement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCourseRequirement" ADD CONSTRAINT "StudentCourseRequirement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCourseRequirement" ADD CONSTRAINT "StudentCourseRequirement_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGroup" ADD CONSTRAINT "TeachingGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGroup" ADD CONSTRAINT "TeachingGroup_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGroup" ADD CONSTRAINT "TeachingGroup_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGroupStudent" ADD CONSTRAINT "TeachingGroupStudent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGroupStudent" ADD CONSTRAINT "TeachingGroupStudent_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGroupStudent" ADD CONSTRAINT "TeachingGroupStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
