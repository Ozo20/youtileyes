import { createHash, randomUUID } from "node:crypto";

import {
  DistributionFormat,
  DistributionStatus,
  Prisma,
} from "@/generated/prisma/client";
import { writeAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const DEMO_ACTOR = { name: "Ola Solem" };

export async function recordPlanDistribution({
  planId,
  format,
  fileName,
  contentType,
  bytes,
}: {
  planId: string;
  format: DistributionFormat;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}) {
  const hash = createHash("sha256")
    .update(bytes)
    .digest("hex");
  const correlationId = randomUUID();

  return prisma.$transaction(async (tx) => {
    const plan = await tx.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        tenantId: true,
        version: true,
        status: true,
      },
    });

    if (!plan) throw new Error("Plan not found.");

    const record = await tx.planDistribution.create({
      data: {
        tenantId: plan.tenantId,
        planId: plan.id,
        format,
        status: DistributionStatus.GENERATED,
        fileName,
        contentType,
        contentHash: hash,
        sizeBytes: bytes.byteLength,
        generatedByName: DEMO_ACTOR.name,
        metadata: {
          schemaVersion: "1.0",
          planVersion: plan.version,
          planStatus: plan.status,
          deliveryMode: "DOWNLOAD",
        } satisfies Prisma.InputJsonValue,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: plan.tenantId,
      eventType: "GENERATED",
      entityType: "PlanDistribution",
      entityId: record.id,
      actor: DEMO_ACTOR,
      description: `${format} distribution generated for Plan v${plan.version}.`,
      source: "planning.distribution",
      correlationId,
      planId: plan.id,
      afterState: {
        distributionId: record.id,
        format,
        status: record.status,
        fileName,
        contentHash: hash,
        sizeBytes: bytes.byteLength,
      },
      context: {
        deliveryMode: "DOWNLOAD",
      },
    });

    return record;
  });
}
