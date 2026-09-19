-- AlterEnum
ALTER TYPE "ScenarioStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "SolverRunStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "SolverJob" ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3);
