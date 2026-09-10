# Youtileyes – plan lifecycle and approval foundation

This slice adds effective-dated planning horizons and a configurable plan approval workflow.

## Behaviour represented

- `planningAsOfDate`: what the planner considers "today" (can be fictional in demo mode).
- `frozenThroughDate`: existing published schedule is protected through this date.
- `planningStartDate` / `planningEndDate`: solver-editable horizon.
- `effectiveFrom` / `effectiveTo`: intended validity of an approved/published plan revision.
- Existing `Plan.version` + `basedOnPlanId` remain the revision chain.
- Review workflows support multiple stages and multiple reviewers in the same stage.
- Review decisions are durable history rows rather than overwriting the previous decision.

The demo seed uses:

- as-of: 2026-09-01
- frozen through: 2026-09-13
- editable/effective from: 2026-09-14
- end: 2026-12-18
- stage 1: Academic owner
- stage 2: Rector

## Install

From the project root, with a clean Git working tree:

```bash
npx prisma format
npx prisma validate
npx prisma migrate dev --name add_plan_lifecycle_and_review
npx prisma generate
npm run db:seed
npm run planning:lifecycle-check
```

Expected final line:

```text
Plan lifecycle check: PASS
```

Then run normal project checks:

```bash
rm -rf .next
npx next typegen
npx tsc --noEmit
npm run lint
npm run build
```

Existing solver regression checks should still pass:

```bash
source solver/.venv/bin/activate
npm run solver:test:core
npm run solver:test:preferences
npm run solver:test:contract
```

## Important lifecycle rule

Approval does not rewrite history. A future revision may be prepared while the currently published plan remains effective. Only when the future revision reaches its effective date does it become the applicable plan. A later revision supersedes it; historical sessions remain historical.

Actual submit/approve/publish service actions and UI are intentionally deferred until the user/auth membership model is connected. This slice establishes the database semantics first.
