import {
  Prisma,
  type EventType,
} from "../generated/prisma/client";

export type AuditActor = {
  id?: string | null;
  name?: string | null;
};

export type AuditEventInput = {
  tenantId: string;
  eventType: EventType;
  entityType: string;
  entityId?: string | null;
  actor?: AuditActor | null;
  description: string;
  source: string;
  correlationId?: string | null;
  planId?: string | null;
  scenarioId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  context?: Record<string, unknown>;
};

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;

  return JSON.parse(
    JSON.stringify(value),
  ) as Prisma.InputJsonValue;
}

export function buildAuditMetadata(
  input: Omit<
    AuditEventInput,
    | "tenantId"
    | "eventType"
    | "entityType"
    | "entityId"
    | "description"
  >,
): Prisma.InputJsonValue {
  return jsonValue({
    schemaVersion: "1.0",
    source: input.source,
    correlationId: input.correlationId ?? null,
    actorName: input.actor?.name ?? null,
    planId: input.planId ?? null,
    scenarioId: input.scenarioId ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    context: input.context ?? {},
  })!;
}

export async function writeAuditEvent(
  tx: Prisma.TransactionClient,
  input: AuditEventInput,
) {
  return tx.eventLog.create({
    data: {
      tenantId: input.tenantId,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      actorId: input.actor?.id ?? null,
      description: input.description,
      metadata: buildAuditMetadata({
        actor: input.actor,
        source: input.source,
        correlationId: input.correlationId,
        planId: input.planId,
        scenarioId: input.scenarioId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        context: input.context,
      }),
    },
  });
}

export function getAuditMetadata(
  metadata: Prisma.JsonValue | null,
) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return null;
  }

  return metadata as Record<string, Prisma.JsonValue>;
}

export function getAuditText(
  metadata: Prisma.JsonValue | null,
  key: string,
) {
  const value = getAuditMetadata(metadata)?.[key];

  return typeof value === "string" ? value : null;
}
