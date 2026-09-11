# Youtileyes – Audit foundation + History + Overview

This package is based on the supplied `youtileyes-audit-ui-input.zip`.

It introduces the first reusable operational UI slice and a centralized
EventLog write helper.

## Added

- `src/lib/audit.ts`
- `src/components/ui/stat-card.tsx`
- `src/components/ui/empty-state.tsx`
- `src/components/audit/audit-event-list.tsx`
- `src/app/(portal)/history/page.tsx`
- `src/styles/operations.css`
- `AUDIT_POLICY.md`

## Replaced

- `src/app/page.tsx` — real Overview dashboard instead of Create Next App
- `src/app/layout.tsx` — Youtileyes metadata + operations stylesheet
- `src/lib/navigation.ts` — adds History
- `scripts/create-resource-recovery-scenario.ts` — standardized audit logging

No Prisma migration is required in this slice.

## Safe install

Unzip to a temporary directory first:

```bash
rm -rf /tmp/youtileyes-audit-ui-install
mkdir -p /tmp/youtileyes-audit-ui-install

unzip -o ~/Downloads/youtileyes-audit-history-overview-next-step.zip \
  -d /tmp/youtileyes-audit-ui-install

find /tmp/youtileyes-audit-ui-install -type f | sort
```

Then copy without deleting any existing project files:

```bash
cd /Users/olasolem/Documents/youtileyes

rsync -av \
  /tmp/youtileyes-audit-ui-install/youtileyes-audit-history-overview-next-step/ \
  .
```

There is deliberately no `--delete`.

## Validate

```bash
rm -rf .next
npx prisma generate
npx next typegen
npx tsc --noEmit
npm run lint
npm run build
```

## Exercise audit logging

Create another recovery scenario using a real resource UUID:

```bash
source solver/.venv/bin/activate
npm run planning:allocate
npm run solver:input

npm run planning:resource-recovery:create -- \
  --type INSTRUCTOR_UNAVAILABLE \
  --resource <REAL_INSTRUCTOR_UUID> \
  --from 2026-09-16 \
  --to 2026-09-16
```

The operation now writes:

- one `GENERATED / PlanScenario` audit event
- one `UPDATED / ScenarioSession` audit event for each meaningful direct or
  cascading change
- one shared correlation ID for the operation

## UI

Start:

```bash
npm run dev
```

Open:

- `http://localhost:3000/` — Overview
- `http://localhost:3000/history` — History / audit log
- `http://localhost:3000/schedule` — existing schedule

The History page supports event type, entity and text filtering, and an event
detail panel with the structured metadata envelope.
