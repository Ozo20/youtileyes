"use server";

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "../../generated/prisma/client";

import { writeAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const DEMO_ACTOR = {
  name: "Ola Solem",
};

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function dateOnly(value: string, key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${key} must use YYYY-MM-DD.`);
  }

  return value;
}

function dispatchLocalWorker(jobId: string) {
  const logPath = `/tmp/youtileyes_solver_job_${jobId}.log`;
  const logFd = openSync(logPath, "a");

  const child = spawn(
    "npx",
    [
      "tsx",
      "scripts/process-solver-job.ts",
      "--job",
      jobId,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    },
  );

  child.unref();

  return logPath;
}

export async function queueResourceRecoveryJob(
  formData: FormData,
) {
  const baseScenarioId = requiredText(
    formData,
    "baseScenarioId",
  );
  const resourceType = requiredText(
    formData,
    "resourceType",
  );
  const resourceId = requiredText(formData, "resourceId");
  const startDate = dateOnly(
    requiredText(formData, "startDate"),
    "startDate",
  );
  const endDate = dateOnly(
    requiredText(formData, "endDate"),
    "endDate",
  );

  if (
    resourceType !== "INSTRUCTOR_UNAVAILABLE" &&
    resourceType !== "ROOM_UNAVAILABLE"
  ) {
    throw new Error("Invalid resource disruption type.");
  }

  if (endDate < startDate) {
    throw new Error("endDate cannot be before startDate.");
  }

  const baseScenario = await prisma.planScenario.findUnique({
    where: {
      id: baseScenarioId,
    },
    include: {
      plan: true,
    },
  });

  if (!baseScenario) {
    throw new Error("Base scenario not found.");
  }

  const resourceLabel =
    resourceType === "INSTRUCTOR_UNAVAILABLE"
      ? await prisma.instructor.findFirst({
          where: {
            id: resourceId,
            tenantId: baseScenario.tenantId,
          },
          select: {
            firstName: true,
            lastName: true,
          },
        })
      : await prisma.room.findFirst({
          where: {
            id: resourceId,
            tenantId: baseScenario.tenantId,
          },
          select: {
            name: true,
          },
        });

  if (!resourceLabel) {
    throw new Error("Selected resource was not found.");
  }

  const label =
    "firstName" in resourceLabel
      ? `${resourceLabel.firstName} ${resourceLabel.lastName}`
      : resourceLabel.name;

  const correlationId = randomUUID();

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.solverJob.create({
      data: {
        tenantId: baseScenario.tenantId,
        planScenarioId: baseScenario.id,
        status: "QUEUED",
        config: {
          schemaVersion: "1.0",
          type: "RESOURCE_RECOVERY",
          baseScenarioId: baseScenario.id,
          planId: baseScenario.planId,
          resourceType,
          resourceId,
          resourceLabel: label,
          startDate,
          endDate,
          correlationId,
          requestedByName: DEMO_ACTOR.name,
          executionMode: "LOCAL_DETACHED_WORKER",
        } satisfies Prisma.InputJsonValue,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: baseScenario.tenantId,
      eventType: "CREATED",
      entityType: "SolverJob",
      entityId: created.id,
      actor: DEMO_ACTOR,
      description:
        `Solver job queued for ${label}: ${startDate}` +
        `${endDate === startDate ? "" : ` to ${endDate}`}.`,
      source: "planning.solver-job.queue",
      correlationId,
      planId: baseScenario.planId,
      scenarioId: baseScenario.id,
      afterState: {
        status: created.status,
        baseScenarioId: baseScenario.id,
      },
      context: {
        resourceType,
        resourceId,
        resourceLabel: label,
        startDate,
        endDate,
      },
    });

    return created;
  });

  const logPath = dispatchLocalWorker(job.id);

  await prisma.solverJob.update({
    where: {
      id: job.id,
    },
    data: {
      config: {
        schemaVersion: "1.0",
        type: "RESOURCE_RECOVERY",
        baseScenarioId: baseScenario.id,
        planId: baseScenario.planId,
        resourceType,
        resourceId,
        resourceLabel: label,
        startDate,
        endDate,
        correlationId,
        requestedByName: DEMO_ACTOR.name,
        executionMode: "LOCAL_DETACHED_WORKER",
        localLogPath: logPath,
      },
    },
  });

  revalidatePath("/planning");
  revalidatePath("/history");

  redirect(
    `/planning?scenario=${baseScenario.id}&job=${job.id}`,
  );
}
