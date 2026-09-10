-- CreateEnum
CREATE TYPE "RoomCourseSuitability" AS ENUM ('PREFERRED', 'ALLOWED', 'AVOID', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "PlanningPreferenceLevel" AS ENUM ('PREFER', 'NEUTRAL', 'AVOID');

-- CreateTable
CREATE TABLE "RoomCoursePreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "suitability" "RoomCourseSuitability" NOT NULL DEFAULT 'ALLOWED',
    "penalty" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomCoursePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomTravelTime" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromRoomId" TEXT NOT NULL,
    "toRoomId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomTravelTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorTeachingGroupPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "teachingGroupId" TEXT NOT NULL,
    "preference" "PlanningPreferenceLevel" NOT NULL DEFAULT 'NEUTRAL',
    "weight" INTEGER NOT NULL DEFAULT 100,
    "reasonCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorTeachingGroupPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomCoursePreference_tenantId_courseId_idx" ON "RoomCoursePreference"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "RoomCoursePreference_tenantId_roomId_idx" ON "RoomCoursePreference"("tenantId", "roomId");

-- CreateIndex
CREATE INDEX "RoomCoursePreference_tenantId_active_suitability_idx" ON "RoomCoursePreference"("tenantId", "active", "suitability");

-- CreateIndex
CREATE UNIQUE INDEX "RoomCoursePreference_tenantId_roomId_courseId_key" ON "RoomCoursePreference"("tenantId", "roomId", "courseId");

-- CreateIndex
CREATE INDEX "RoomTravelTime_tenantId_fromRoomId_idx" ON "RoomTravelTime"("tenantId", "fromRoomId");

-- CreateIndex
CREATE INDEX "RoomTravelTime_tenantId_toRoomId_idx" ON "RoomTravelTime"("tenantId", "toRoomId");

-- CreateIndex
CREATE INDEX "RoomTravelTime_tenantId_active_idx" ON "RoomTravelTime"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RoomTravelTime_tenantId_fromRoomId_toRoomId_key" ON "RoomTravelTime"("tenantId", "fromRoomId", "toRoomId");

-- CreateIndex
CREATE INDEX "InstructorTeachingGroupPreference_tenantId_instructorId_idx" ON "InstructorTeachingGroupPreference"("tenantId", "instructorId");

-- CreateIndex
CREATE INDEX "InstructorTeachingGroupPreference_tenantId_teachingGroupId_idx" ON "InstructorTeachingGroupPreference"("tenantId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "InstructorTeachingGroupPreference_tenantId_active_preferenc_idx" ON "InstructorTeachingGroupPreference"("tenantId", "active", "preference");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorTeachingGroupPreference_tenantId_instructorId_tea_key" ON "InstructorTeachingGroupPreference"("tenantId", "instructorId", "teachingGroupId");

-- AddForeignKey
ALTER TABLE "RoomCoursePreference" ADD CONSTRAINT "RoomCoursePreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCoursePreference" ADD CONSTRAINT "RoomCoursePreference_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCoursePreference" ADD CONSTRAINT "RoomCoursePreference_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomTravelTime" ADD CONSTRAINT "RoomTravelTime_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomTravelTime" ADD CONSTRAINT "RoomTravelTime_fromRoomId_fkey" FOREIGN KEY ("fromRoomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomTravelTime" ADD CONSTRAINT "RoomTravelTime_toRoomId_fkey" FOREIGN KEY ("toRoomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorTeachingGroupPreference" ADD CONSTRAINT "InstructorTeachingGroupPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorTeachingGroupPreference" ADD CONSTRAINT "InstructorTeachingGroupPreference_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorTeachingGroupPreference" ADD CONSTRAINT "InstructorTeachingGroupPreference_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
