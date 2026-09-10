# Youtileyes — cohort, period requirements and activity-day foundation

This slice adds the planning-demand layer that sits between master data and the timetable solver.

## What is added

- `StudentCohort` / `StudentCohortMember` for real classes and programme cohorts such as `8C` or `ST2A`.
- `TeachingGroup.membershipMode = FULL_COHORT` so a class can receive a subject together as one atomic teaching group.
- `TeachingGroup.schedulingPriority` for later solver prioritisation when demand competes for scarce capacity.
- `TeachingRequirement` for semester/year teaching volume in minutes.
- `TeachingRequirementWeek` for generated week-level allocation targets.
- Cohort- and teaching-group-targeted `PlanningException` rows.
- Semester `CalendarDay` materialisation.
- `planning:allocate` to distribute period requirements across teaching weeks.
- `planning:check` to verify allocation totals and the demo cohort setup.
- `solver/requirements.txt` is included explicitly.

The timetable solver is intentionally unchanged in this slice. The next solver slice can consume `TeachingRequirementWeek`, multiple `CalendarDay` rows and availability/exception data without having to redesign the domain again.

## Install

Start from a clean Git checkpoint.

```bash
cd /Users/olasolem/Documents/youtileyes
git status --short
```

Copy/extract this package over the project root, then run:

```bash
npx prisma format
npx prisma validate
npx prisma migrate dev --name add_cohorts_and_teaching_requirements
npx prisma generate
npm run db:seed
npm run planning:allocate
npm run planning:check
```

Expected demo checks include:

- `ST2A` has 5 students.
- all four demo teaching groups are `FULL_COHORT`.
- the Autumn 2026 period has week allocations whose totals equal each semester requirement.
- the week containing 10 September is marked as having reduced teaching capacity because of the cohort activity day.

Then run the existing application checks:

```bash
rm -rf .next
npx next typegen
npx tsc --noEmit
npm run lint
npm run build
```

And preserve the existing solver checks:

```bash
source solver/.venv/bin/activate
npm run solver:test:core
npm run solver:test:preferences
npm run solver:test:contract
```

## Inspect the planning demand

```bash
psql youtileyes_dev -c '
SELECT
  tg."code" AS group_code,
  tr."totalMinutes",
  SUM(trw."targetMinutes") AS allocated_minutes,
  COUNT(*) AS weeks
FROM "TeachingRequirement" tr
JOIN "TeachingGroup" tg ON tg."id" = tr."teachingGroupId"
JOIN "TeachingRequirementWeek" trw ON trw."teachingRequirementId" = tr."id"
GROUP BY tg."code", tr."totalMinutes"
ORDER BY tg."code";

SELECT
  tg."code" AS group_code,
  trw."weekStartDate",
  trw."targetMinutes",
  trw."availableTeachingDays",
  trw."adjustmentReason"
FROM "TeachingRequirementWeek" trw
JOIN "TeachingRequirement" tr ON tr."id" = trw."teachingRequirementId"
JOIN "TeachingGroup" tg ON tg."id" = tr."teachingGroupId"
WHERE trw."weekStartDate" = DATE ''2026-09-07''
ORDER BY tg."code";
'
```

## Architectural intent

`StudentCohort` is the stable class/programme membership layer. `TeachingGroup` remains subject-specific. A full-class Norwegian lesson is therefore one teaching group linked to a cohort rather than many unrelated student lessons.

`TeachingRequirement` is the period-level truth, e.g. the number of minutes a group should receive over a semester/year. `TeachingRequirementWeek` is derived planning demand. It can be regenerated whenever the calendar or blocking events change.

An activity day blocks ordinary teaching capacity; it does not silently remove the teaching requirement. This is the basis for later compensation on other days or weeks.
