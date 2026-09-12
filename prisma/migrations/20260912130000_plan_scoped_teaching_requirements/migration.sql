-- Base Plan teaching demand belongs to one controlled Plan revision.
--
-- Legacy data stored one shared TeachingRequirement set per academic period.
-- Existing Plan versions created through recovery therefore all referenced the
-- same structural Base Plan demand implicitly.
--
-- Migration strategy:
--   1. Attach the legacy rows to the newest non-archived Plan.
--   2. Clone the same requirement snapshot to every other existing Plan in the
--      same tenant / academic period.
--   3. Clone weekly allocations together with each requirement.
--   4. Make planId mandatory and enforce revision-scoped uniqueness.
--
-- After this migration every historical Plan revision is self-contained.

ALTER TABLE "TeachingRequirement"
ADD COLUMN "planId" TEXT;

-- The legacy unique constraint prevents us from cloning the same teaching group
-- into several Plan revisions, so remove it before creating the snapshots.
DROP INDEX IF EXISTS
"TeachingRequirement_tenantId_teachingGroupId_academicPeriodId_key";

DROP INDEX IF EXISTS
"TeachingRequirement_tenantId_teachingGroupId_academicPeriod_key";

-- Attach each existing legacy requirement to the newest active/non-archived
-- Plan for its tenant and academic period. This preserves the original row IDs
-- on the current baseline.
UPDATE "TeachingRequirement" AS requirement
SET "planId" = (
  SELECT plan."id"
  FROM "Plan" AS plan
  WHERE plan."tenantId" = requirement."tenantId"
    AND plan."academicPeriodId" = requirement."academicPeriodId"
    AND plan."status" <> 'ARCHIVED'::"PlanStatus"
  ORDER BY plan."version" DESC, plan."createdAt" DESC
  LIMIT 1
);

-- Abort rather than silently creating incomplete revision history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TeachingRequirement"
    WHERE "planId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'TeachingRequirement migration failed: no matching Plan exists for one or more rows';
  END IF;
END
$$;

-- Build a temporary mapping between each legacy/current requirement and every
-- other Plan revision that needs its own snapshot.
--
-- IDs are TEXT in this schema. md5 gives us deterministic unique IDs for this
-- one-time migration without depending on a PostgreSQL UUID extension.
CREATE TEMP TABLE "_TeachingRequirementPlanMap" AS
SELECT
  requirement."id" AS "sourceRequirementId",
  plan."id" AS "targetPlanId",
  md5(
    'teaching-requirement:'
    || requirement."id"
    || ':'
    || plan."id"
  ) AS "targetRequirementId"
FROM "TeachingRequirement" AS requirement
JOIN "Plan" AS plan
  ON plan."tenantId" = requirement."tenantId"
 AND plan."academicPeriodId" = requirement."academicPeriodId"
WHERE plan."id" <> requirement."planId";

-- Clone Base Plan requirements to all historical/future-existing revisions.
INSERT INTO "TeachingRequirement" (
  "id",
  "tenantId",
  "planId",
  "teachingGroupId",
  "academicPeriodId",
  "totalMinutes",
  "distributionMode",
  "minWeeklyMinutes",
  "preferredWeeklyMinutes",
  "maxWeeklyMinutes",
  "carryoverAllowed",
  "priority",
  "active",
  "createdAt",
  "updatedAt"
)
SELECT
  mapping."targetRequirementId",
  source."tenantId",
  mapping."targetPlanId",
  source."teachingGroupId",
  source."academicPeriodId",
  source."totalMinutes",
  source."distributionMode",
  source."minWeeklyMinutes",
  source."preferredWeeklyMinutes",
  source."maxWeeklyMinutes",
  source."carryoverAllowed",
  source."priority",
  source."active",
  source."createdAt",
  source."updatedAt"
FROM "_TeachingRequirementPlanMap" AS mapping
JOIN "TeachingRequirement" AS source
  ON source."id" = mapping."sourceRequirementId";

-- Weekly distributions are part of the Base Plan input snapshot as well.
INSERT INTO "TeachingRequirementWeek" (
  "id",
  "tenantId",
  "teachingRequirementId",
  "weekStartDate",
  "targetMinutes",
  "minMinutes",
  "maxMinutes",
  "availableTeachingDays",
  "adjustmentReason",
  "generatedAt",
  "updatedAt"
)
SELECT
  md5(
    'teaching-requirement-week:'
    || sourceWeek."id"
    || ':'
    || mapping."targetPlanId"
  ),
  sourceWeek."tenantId",
  mapping."targetRequirementId",
  sourceWeek."weekStartDate",
  sourceWeek."targetMinutes",
  sourceWeek."minMinutes",
  sourceWeek."maxMinutes",
  sourceWeek."availableTeachingDays",
  sourceWeek."adjustmentReason",
  sourceWeek."generatedAt",
  sourceWeek."updatedAt"
FROM "_TeachingRequirementPlanMap" AS mapping
JOIN "TeachingRequirementWeek" AS sourceWeek
  ON sourceWeek."teachingRequirementId" =
     mapping."sourceRequirementId";

DROP TABLE "_TeachingRequirementPlanMap";

ALTER TABLE "TeachingRequirement"
ALTER COLUMN "planId" SET NOT NULL;

CREATE UNIQUE INDEX
"TeachingRequirement_tenantId_planId_teachingGroupId_key"
ON "TeachingRequirement"(
  "tenantId",
  "planId",
  "teachingGroupId"
);

CREATE INDEX
"TeachingRequirement_tenantId_planId_idx"
ON "TeachingRequirement"(
  "tenantId",
  "planId"
);

ALTER TABLE "TeachingRequirement"
ADD CONSTRAINT "TeachingRequirement_planId_fkey"
FOREIGN KEY ("planId")
REFERENCES "Plan"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
