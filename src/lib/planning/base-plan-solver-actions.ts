"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PlanStatus,
  Prisma,
  ScenarioStatus,
  SolverJobStatus,
} from "../../generated/prisma/client";

import { writeAuditEvent } from "@/lib/audit";
import { getPlanningAnalysis } from "@/lib/planning/planning-analysis-data";
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

async function basePlanInputFingerprint(planId: string) {
  const requirements =
    await prisma.teachingRequirement.findMany({
      where: {
        planId,
        active: true,
      },
      select: {
        teachingGroupId: true,
        totalMinutes: true,
        distributionMode: true,
        minWeeklyMinutes: true,
        preferredWeeklyMinutes: true,
        maxWeeklyMinutes: true,
        carryoverAllowed: true,
        priority: true,
        weeklyAllocations: {
          select: {
            weekStartDate: true,
            targetMinutes: true,
            minMinutes: true,
            maxMinutes: true,
            availableTeachingDays: true,
            adjustmentReason: true,
          },
          orderBy: {
            weekStartDate: "asc",
          },
        },
      },
      orderBy: {
        teachingGroupId: "asc",
      },
    });

  const canonical = requirements.map((requirement) => ({
    ...requirement,
    weeklyAllocations: requirement.weeklyAllocations.map(
      (week) => ({
        ...week,
        weekStartDate:
          week.weekStartDate.toISOString().slice(0, 10),
      }),
    ),
  }));

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

async function markOrphanedBasePlanScenarios(planId: string) {
  const orphaned = await prisma.planScenario.findMany({
    where: {
      planId,
      status: ScenarioStatus.GENERATING,
      generationConfig: {
        path: ["type"],
        equals: "BASE_PLAN",
      },
      solverJobs: {
        none: {
          status: {
            in: [
              SolverJobStatus.QUEUED,
              SolverJobStatus.RUNNING,
            ],
          },
        },
      },
    },
    select: {
      id: true,
      tenantId: true,
      planId: true,
      name: true,
    },
  });

  if (orphaned.length === 0) return;

  const correlationId = randomUUID();
  const failureMessage =
    "Previous Base Plan generation stopped before a tracked solver job completed.";

  await prisma.$transaction(async (tx) => {
    for (const scenario of orphaned) {
      await tx.planScenario.update({
        where: {
          id: scenario.id,
        },
        data: {
          status: ScenarioStatus.FAILED,
          failureMessage,
          generatedAt: new Date(),
        },
      });

      await writeAuditEvent(tx, {
        tenantId: scenario.tenantId,
        eventType: "UPDATED",
        entityType: "PlanScenario",
        entityId: scenario.id,
        actor: DEMO_ACTOR,
        description:
          `Orphaned Base Plan generation marked failed: ${scenario.name}.`,
        source: "planning.base-plan.generate.reconcile",
        correlationId,
        planId: scenario.planId,
        scenarioId: scenario.id,
        beforeState: {
          status: ScenarioStatus.GENERATING,
        },
        afterState: {
          status: ScenarioStatus.FAILED,
          failureMessage,
        },
      });
    }
  });
}

export async function generateBasePlanScenario(
  formData: FormData,
) {
  const planId = requiredText(formData, "planId");
  const correlationId = randomUUID();

  const plan = await prisma.plan.findUnique({
    where: {
      id: planId,
    },
    include: {
      _count: {
        select: {
          teachingRequirements: true,
        },
      },
    },
  });

  if (!plan) {
    throw new Error("Base Plan revision not found.");
  }

  if (
    plan.status !== PlanStatus.DRAFT &&
    plan.status !== PlanStatus.GENERATED &&
    plan.status !== PlanStatus.REVIEWED
  ) {
    throw new Error(
      `Base Plan v${plan.version} cannot be recalculated from ${plan.status}.`,
    );
  }

  if (plan._count.teachingRequirements === 0) {
    throw new Error(
      "Base Plan has no teaching requirements.",
    );
  }

  const allocationCount =
    await prisma.teachingRequirementWeek.count({
      where: {
        teachingRequirement: {
          planId: plan.id,
          active: true,
        },
      },
    });

  if (allocationCount === 0) {
    throw new Error(
      "Base Plan has no weekly allocations. Generate weekly allocation first.",
    );
  }

  const planningAnalysis =
    await getPlanningAnalysis(plan.id);

  if (!planningAnalysis.canRunSolver) {
    const firstBlocking =
      planningAnalysis.checks.find(
        (check) =>
          check.severity === "BLOCKING",
      );

    throw new Error(
      firstBlocking
        ? `Planning analysis blocked timetable generation: ${firstBlocking.message}`
        : "Planning analysis blocked timetable generation.",
    );
  }

  // Clean up the pre-job prototype state, including an interrupted synchronous
  // generation, before deciding whether a new run may be queued.
  await markOrphanedBasePlanScenarios(plan.id);

  const activeJob = await prisma.solverJob.findFirst({
    where: {
      tenantId: plan.tenantId,
      status: {
        in: [
          SolverJobStatus.QUEUED,
          SolverJobStatus.RUNNING,
        ],
      },
      planScenario: {
        planId: plan.id,
        generationConfig: {
          path: ["type"],
          equals: "BASE_PLAN",
        },
      },
    },
    select: {
      id: true,
      planScenarioId: true,
    },
  });

  if (activeJob) {
    redirect(
      `/planning?scenario=${activeJob.planScenarioId}&job=${activeJob.id}#base-plan-generation`,
    );
  }

  const proposalNumber =
    (await prisma.planScenario.count({
      where: {
        tenantId: plan.tenantId,
        planId: plan.id,
        generationConfig: {
          path: ["type"],
          equals: "BASE_PLAN",
        },
      },
    })) + 1;

  const inputFingerprint =
    await basePlanInputFingerprint(plan.id);
  const queuedAt = new Date();

  const { scenario, job } = await prisma.$transaction(
    async (tx) => {
      const createdScenario = await tx.planScenario.create({
        data: {
          tenantId: plan.tenantId,
          planId: plan.id,
          name: `Base Plan v${plan.version} · Proposal ${proposalNumber}`,
          status: ScenarioStatus.GENERATING,
          generationConfig: {
            type: "BASE_PLAN",
            planVersion: plan.version,
            inputFingerprint,
            requestedByName: DEMO_ACTOR.name,
            correlationId,
          } satisfies Prisma.InputJsonValue,
        },
      });

      const createdJob = await tx.solverJob.create({
        data: {
          tenantId: plan.tenantId,
          planScenarioId: createdScenario.id,
          status: SolverJobStatus.QUEUED,
          config: {
            schemaVersion: "1.0",
            type: "BASE_PLAN",
            planId: plan.id,
            planVersion: plan.version,
            scenarioId: createdScenario.id,
            inputFingerprint,
            correlationId,
            requestedByName: DEMO_ACTOR.name,
            executionMode: "QUEUE_WORKER",
            progress: {
              phase: "QUEUED",
              phaseLabel: "Queued",
              percent: 0,
              currentWeek: 0,
              totalWeeks: null,
              message: "Waiting for solver worker.",
              updatedAt: queuedAt.toISOString(),
            },
          } satisfies Prisma.InputJsonValue,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: plan.tenantId,
        eventType: "CREATED",
        entityType: "PlanScenario",
        entityId: createdScenario.id,
        actor: DEMO_ACTOR,
        description:
          `Base Plan proposal generation queued for v${plan.version}.`,
        source: "planning.base-plan.generate",
        correlationId,
        planId: plan.id,
        scenarioId: createdScenario.id,
        afterState: {
          status: createdScenario.status,
          generationType: "BASE_PLAN",
          inputFingerprint,
          solverJobId: createdJob.id,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: plan.tenantId,
        eventType: "CREATED",
        entityType: "SolverJob",
        entityId: createdJob.id,
        actor: DEMO_ACTOR,
        description:
          `Base Plan solver job queued for v${plan.version}.`,
        source: "planning.base-plan.generate",
        correlationId,
        planId: plan.id,
        scenarioId: createdScenario.id,
        afterState: {
          status: createdJob.status,
          scenarioId: createdScenario.id,
          planVersion: plan.version,
        },
      });

      return {
        scenario: createdScenario,
        job: createdJob,
      };
    },
  );

  revalidatePath("/planning");
  revalidatePath("/planning/base-plan");
  revalidatePath("/history");

  redirect(
    `/planning?scenario=${scenario.id}&job=${job.id}#base-plan-generation`,
  );
}
