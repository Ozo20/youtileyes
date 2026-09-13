-- AlterTable
ALTER TABLE "InstructorCourse" ADD COLUMN     "preference" "PlanningPreferenceLevel" NOT NULL DEFAULT 'NEUTRAL',
ADD COLUMN     "preferenceWeight" INTEGER NOT NULL DEFAULT 100;
