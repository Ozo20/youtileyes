# Youtileyes — resource model integration

This package extends the existing working checkpoint with persisted resource constraints and preferences used directly by the OR-Tools solver.

## What changes

- Adds `RoomCoursePreference` for preferred/allowed/avoid/prohibited room-course combinations.
- Adds `RoomTravelTime` for real room-to-room travel time.
- Adds `InstructorTeachingGroupPreference` for neutral solver-facing instructor/group preferences without requiring sensitive free-text explanations.
- Reuses `InstructorCourse.qualificationLevel` as a qualification hierarchy and converts it to a solver assignment penalty.
- Solver contract moves to `1.1`; `1.0` input remains readable for backward compatibility.
- Solver candidate objective now includes qualification, room suitability and instructor/group preference penalties.
- Demo seed contains realistic room travel, room suitability and fallback teaching qualifications.
- Removes the old demo workaround that attempted to represent room travel through a same-location `LocationRelation`.

## Install

Start from a clean Git checkpoint.

```bash
cd /Users/olasolem/Documents/youtileyes
git status --short
```

Unzip the supplied package over the project root. The paths inside the ZIP are already relative to the Youtileyes root.

Then run:

```bash
npx prisma format
npx prisma validate
npx prisma migrate dev --name add_resource_constraints_preferences
npx prisma generate
npm run db:seed
```

## Validate TypeScript / application

```bash
rm -rf .next
npx next typegen
npx tsc --noEmit
npm run lint
npm run build
```

Two old `prisma/seed.ts` unused-variable warnings should no longer be present because the obsolete room-travel workaround has been removed.

## Solver tests

Activate the existing solver virtual environment:

```bash
source solver/.venv/bin/activate
```

Then run:

```bash
npm run solver:test:core
npm run solver:test:preferences
npm run solver:test:contract
```

The existing tests may also be run individually if desired:

```bash
PYTHONPATH=. python solver/tests/smoke_solver.py
PYTHONPATH=. python solver/tests/travel_breaks.py
PYTHONPATH=. python solver/tests/student_day_quality.py
PYTHONPATH=. python solver/tests/demo_schedule.py
```

## End-to-end database → solver → persistence

```bash
npm run solver:input

PYTHONPATH=. python -m solver.src.cli \
  --input /tmp/youtileyes_solver_input.json \
  --output /tmp/youtileyes_solver_output.json

npm run solver:persist
```

Inspect the generated input if useful:

```bash
python3 -m json.tool /tmp/youtileyes_solver_input.json | less
```

For contract `1.1`, verify that it contains non-empty data for `coursePenalties`, `roomPenalties`, `instructorPenalties`, and real room-to-room `travel` values.

## Expected architectural result

The assignment decision is no longer based only on "qualified + enough room capacity". A candidate assignment now receives an objective penalty composed of:

```text
qualification penalty
+ room suitability penalty
+ instructor/group preference penalty
```

Hard exclusion remains separate:

- Instructor without an active course qualification is not a candidate.
- A `PROHIBITED` room-course combination is not a candidate.
- Capacity, collision, break and travel constraints remain hard constraints.

This keeps the distinction between feasibility and preference explicit and prepares the solver for intelligent replanning later.
