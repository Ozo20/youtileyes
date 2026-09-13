-- CreateEnum
CREATE TYPE "RoomFeatureType" AS ENUM ('EQUIPMENT', 'FEATURE');

-- AlterTable
ALTER TABLE "RoomFeature" ADD COLUMN     "type" "RoomFeatureType" NOT NULL DEFAULT 'FEATURE';
