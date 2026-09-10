# Youtileyes — planning horizon / multi-day solver (contract 1.2)

This package upgrades the solver input/output contract from 1.1 to 1.2 while keeping the existing single-day solver code as regression coverage.

## What changes

- Uses `Plan.planningAsOfDate`, `frozenThroughDate`, `planningStartDate` and `planningEndDate` as hard planning boundaries.
- Never creates solver candidates before `planningStartDate` or after `planningEndDate`.
- Consumes `TeachingRequirementWeek` allocations rather than scheduling each TeachingGroup only once.
- Materialises weekly teaching demand as individual teaching occurrences.
- Distributes each week's occurrences across actual `CalendarDay` rows.
- Applies instructor, student and room `UNAVAILABLE` windows.
- Applies active blocking `PlanningException` rows.
- Preserves room suitability, instructor qualification, instructor/group preference and travel penalties.
- Solves one week at a time inside the selected planning horizon, then combines the results into one scenario output. This keeps the CP-SAT model bounded while the semester demand is still governed by the requirement-allocation layer.
- Solver output sessions now carry their own date.
- Persistence rejects sessions outside the plan's editable horizon.

No Prisma schema migration is required for this package; the lifecycle/calendar/availability models already exist.

## Install

From the Youtileyes project root, make sure Git is clean first:

```bash
git status --short
```

Copy the package contents over the project root.

Then regenerate demo data and weekly demand:

```bash
npm run db:seed
npm run planning:allocate
npm run planning:check
npm run planning:lifecycle-check
```

## TypeScript / app regression

```bash
rm -rf .next
npx next typegen
npx tsc --noEmit
npm run lint
npm run build
```

## Solver regression

```bash
source solver/.venv/bin/activate

npm run solver:test:core
npm run solver:test:preferences
npm run solver:test:contract
npm run solver:test:horizon
```

Expected new checks:

```text
Solver contract 1.2 test: PASS
Multi-day planning horizon test: PASS
```

## End-to-end horizon run

```bash
npm run solver:input

PYTHONPATH=. python -m solver.src.cli \
  --input /tmp/youtileyes_solver_input.json \
  --output /tmp/youtileyes_solver_output.json
```

Inspect the output before persistence:

```bash
python - <<'PY'
import json
from collections import Counter

p = "/tmp/youtileyes_solver_output.json"
data = json.load(open(p))
print("schema:", data["schema_version"])
print("status:", data["status"])
print("sessions:", len(data["sessions"]))
print("date range:", min(s["date"] for s in data["sessions"]), "->", max(s["date"] for s in data["sessions"]))
print("sessions by date:")
for date, count in sorted(Counter(s["date"] for s in data["sessions"]).items()):
    print(" ", date, count)
print("planning window:", data["diagnostics"].get("planningWindow"))
PY
```

The earliest generated date must be on or after `2026-09-14` in the demo. Nothing before the frozen horizon may be emitted.

Persist:

```bash
npm run solver:persist
```

Optional DB verification:

```bash
psql youtileyes_dev -c '
SELECT MIN("date") AS first_date,
       MAX("date") AS last_date,
       COUNT(*) AS sessions
FROM "ScenarioSession";
'
```

## Demo availability proof

The seed adds two future availability constraints inside the editable horizon:

- instructor T1 unavailable 2026-09-16 from 08:00 to 12:00;
- room A10 unavailable all day 2026-09-17.

The generated schedule must route around these constraints rather than editing the frozen period.

## Architectural boundary

Contract 1.2 intentionally separates two optimisation levels:

1. Semester/annual demand allocation -> `TeachingRequirementWeek`.
2. Timetabling inside each allocated week -> OR-Tools CP-SAT.

This prevents one enormous semester-wide CP-SAT model. A later replanning layer can redistribute unmet/cancelled weekly demand across adjacent weeks before running the weekly solver again.
