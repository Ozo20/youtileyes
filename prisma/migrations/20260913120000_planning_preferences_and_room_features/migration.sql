-- AlterEnum
ALTER TYPE "PlanningRuleType" ADD VALUE 'AVOID_TIME_WINDOW';

-- AlterEnum
ALTER TYPE "PlanningRuleScopeType" ADD VALUE 'STUDENT_COHORT';

-- AlterTable
ALTER TABLE "InstructorCourse" ADD COLUMN     "competenceLevel" INTEGER;

-- AlterTable
ALTER TABLE "StaffingRequirement" ADD COLUMN     "minimumCourseLevel" INTEGER,
ADD COLUMN     "preferredCourseLevel" INTEGER;

-- AlterTable
ALTER TABLE "PlanningRule" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "endMinute" INTEGER,
ADD COLUMN     "startMinute" INTEGER,
ADD COLUMN     "studentCohortId" TEXT,
ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "RoomFeature" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "RoomFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomFeatureValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RoomFeatureValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomRequirement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "courseId" TEXT,
    "studentId" TEXT,
    "instructorId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "perStudent" BOOLEAN NOT NULL DEFAULT false,
    "hard" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RoomRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomFeature_tenantId_code_key" ON "RoomFeature"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RoomFeatureValue_tenantId_roomId_featureId_key" ON "RoomFeatureValue"("tenantId", "roomId", "featureId");

-- CreateIndex
CREATE INDEX "RoomRequirement_tenantId_active_idx" ON "RoomRequirement"("tenantId", "active");

-- AddForeignKey
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_studentCohortId_fkey" FOREIGN KEY ("studentCohortId") REFERENCES "StudentCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomFeature" ADD CONSTRAINT "RoomFeature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomFeatureValue" ADD CONSTRAINT "RoomFeatureValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomFeatureValue" ADD CONSTRAINT "RoomFeatureValue_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomFeatureValue" ADD CONSTRAINT "RoomFeatureValue_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "RoomFeature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomRequirement" ADD CONSTRAINT "RoomRequirement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomRequirement" ADD CONSTRAINT "RoomRequirement_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "RoomFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomRequirement" ADD CONSTRAINT "RoomRequirement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomRequirement" ADD CONSTRAINT "RoomRequirement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomRequirement" ADD CONSTRAINT "RoomRequirement_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Validate numeric features and require exactly one requirement owner.
ALTER TABLE "RoomFeatureValue" ADD CONSTRAINT "RoomFeatureValue_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "RoomRequirement" ADD CONSTRAINT "RoomRequirement_values_check" CHECK ("quantity" > 0 AND "weight" > 0 AND num_nonnulls("courseId", "studentId", "instructorId") = 1 AND (NOT "perStudent" OR "courseId" IS NOT NULL) AND ("courseId" IS NOT NULL OR "hard"));
ALTER TABLE "InstructorCourse" ADD CONSTRAINT "InstructorCourse_level_check" CHECK ("competenceLevel" IS NULL OR "competenceLevel" BETWEEN 1 AND 100);
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_course_levels_check" CHECK (("minimumCourseLevel" IS NULL OR "minimumCourseLevel" BETWEEN 1 AND 100) AND ("preferredCourseLevel" IS NULL OR "preferredCourseLevel" BETWEEN 1 AND 100) AND ("minimumCourseLevel" IS NULL OR "preferredCourseLevel" IS NULL OR "preferredCourseLevel" >= "minimumCourseLevel"));
-- Compare enum as text so this migration also works within a transaction.
ALTER TABLE "PlanningRule" ADD CONSTRAINT "PlanningRule_time_window_check" CHECK ("ruleType"::text <> 'AVOID_TIME_WINDOW' OR ("startMinute" IS NOT NULL AND "endMinute" IS NOT NULL AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute" AND "weight" > 0 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7] AND "audience" IN ('ALL', 'STUDENTS', 'INSTRUCTORS')));
