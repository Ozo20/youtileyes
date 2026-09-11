# Youtileyes Audit / EventLog policy

Youtileyes treats `EventLog` as an append-only operational audit trail.

## What must be logged

Every meaningful state-changing action should create an audit event, including:

- master-data create/update/deactivate/reactivate
- availability and exception changes
- teaching requirement and allocation changes
- plan/scenario generation
- solver/recovery generation
- direct and cascading scenario changes
- submit/review/approve/reject/publish/supersede actions
- import actions
- future manual overrides, if they are ever introduced

Read-only activity is not logged by default.

## Bulk generation

Bulk generation should not create thousands of low-value events for unchanged
rows. Instead:

1. write one parent event for the generation operation;
2. write item-level events for meaningful differences/changes;
3. use one `correlationId` for the entire operation.

## Standard metadata envelope

The central `writeAuditEvent()` helper stores:

- `schemaVersion`
- `source`
- `correlationId`
- `actorName`
- `planId`
- `scenarioId`
- `beforeState`
- `afterState`
- `context`

The database columns continue to hold the stable query keys:

- tenant
- event type
- entity type
- entity ID
- actor ID
- description
- timestamp

## Immutability

Existing audit rows must never be edited to make current data look cleaner.
Corrections are represented by new events.

## Actor handling

Until authentication/RBAC is connected, system operations may use a null
`actorId`. Human-triggered actions should supply actor ID/name as soon as the
user model is connected.

## Future schema refinement

`correlationId`, `planId` and `scenarioId` currently live in structured
metadata to avoid a migration in this UI/audit slice. If history volume grows,
they can be promoted to indexed EventLog columns without changing the semantic
contract.
