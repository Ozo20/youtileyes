"use server";

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PlanStatus,
  Prisma,
  ScenarioStatus,
  StaffingRoleType,
} from "../../generated/prisma/client";

import { writeAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const DEMO_ACTOR = {
  name: "Ola Solem",
};

type SolverSession = {
  teaching_group_id: string;
  start_minute: number;
  end_minute: number;
  instructor_id: string;
  room_id: string;
  date: string | null;
  occurrence_id?: string | null;
  instructor_ids?: string[];
  staffing_assignments?: Array<{
    role: string;
    instructor_id: string;
  }>;
};

type SolverOutput = {
  schema_version: string;
  tenant_id: string;
  plan_scenario_id: string;
  status: string;
  objective_value: number | null;
  sessions: SolverSession[];
  metrics?: Array<{
    key: string;
    value: number;
    unit?: string | null;
  }>;
  diagnostics?: Record<string, unknown>;
};

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function runCommand(
  command: string,
  args: string[],
) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed.\n` +
        `${result.stderr || result.stdout || "No process output."}`,
    );
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function dateValue(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function staffingRole(value: string): StaffingRoleType {
  if (
    value === StaffingRoleType.LEAD ||
    value === StaffingRoleType.ASSISTANT ||
    value === StaffingRoleType.SUPPORT ||
    value === StaffingRoleType.OTHER
  ) {
    return value;
  }

  return StaffingRoleType.OTHER;
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

async function ensureReviewWorkflow(
  tx: Prisma.TransactionClient,
  plan: {
    id: string;
    tenantId: string;
    planningScopeId: string;
    version: number;
  },
) {
  const existing =
    await tx.planReviewWorkflow.findFirst({
      where: {
        tenantId: plan.tenantId,
        planId: plan.id,
      },
    });

  if (existing) return existing;

  // Reuse the most recent workflow configuration in this planning scope.
  // This makes a new Base Plan revision inherit the controlled review path
  // without making workflow configuration part of the revision itself.
  const templatePlan = await tx.plan.findFirst({
    where: {
      tenantId: plan.tenantId,
      planningScopeId: plan.planningScopeId,
      id: {
        not: plan.id,
      },
      reviewWorkflows: {
        some: {},
      },
    },
    orderBy: {
      version: "desc",
    },
    include: {
      reviewWorkflows: {
        include: {
          steps: {
            orderBy: [
              { stage: "asc" },
              { position: "asc" },
            ],
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 1,
      },
    },
  });

  const template = templatePlan?.reviewWorkflows[0];

  if (!template) {
    throw new Error(
      `No review workflow template exists for planning scope. ` +
        `Cannot prepare Base Plan v${plan.version} for controlled review.`,
    );
  }

  return tx.planReviewWorkflow.create({
    data: {
      tenantId: plan.tenantId,
      planId: plan.id,
      name: template.name,
      status: "DRAFT",
      steps: {
        create: template.steps.map((step) => ({
          tenantId: plan.tenantId,
          stage: step.stage,
          position: step.position,
          name: step.name,
          reviewerRole: step.reviewerRole,
          reviewerId: step.reviewerId,
          reviewerName: null,
          required: step.required,
          status: "PENDING",
        })),
      },
    },
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

  const scenario = await prisma.$transaction(
    async (tx) => {
      const created = await tx.planScenario.create({
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

      await writeAuditEvent(tx, {
        tenantId: plan.tenantId,
        eventType: "CREATED",
        entityType: "PlanScenario",
        entityId: created.id,
        actor: DEMO_ACTOR,
        description:
          `Base Plan proposal generation started for v${plan.version}.`,
        source: "planning.base-plan.generate",
        correlationId,
        planId: plan.id,
        scenarioId: created.id,
        afterState: {
          status: created.status,
          generationType: "BASE_PLAN",
          inputFingerprint,
        },
      });

      return created;
    },
  );

  const workDir = mkdtempSync(
    join(tmpdir(), "youtileyes-base-plan-"),
  );
  const inputPath = join(workDir, "input.json");
  const outputPath = join(workDir, "output.json");

  try {
    runCommand("npx", [
      "tsx",
      "scripts/build-solver-input.ts",
      "--scenario",
      scenario.id,
      "--output",
      inputPath,
    ]);

    const python =
      existsSync("solver/.venv/bin/python")
        ? "solver/.venv/bin/python"
        : "python3";

    runCommand(python, [
      "-m",
      "solver.src.cli",
      "--input",
      inputPath,
      "--output",
      outputPath,
    ]);

    const output = JSON.parse(
      readFileSync(outputPath, "utf8"),
    ) as SolverOutput;

    if (output.plan_scenario_id !== scenario.id) {
      throw new Error(
        "Solver output belongs to a different PlanScenario.",
      );
    }

    if (output.tenant_id !== plan.tenantId) {
      throw new Error(
        "Solver output belongs to a different tenant.",
      );
    }

    if (
      output.status !== "OPTIMAL" &&
      output.status !== "FEASIBLE"
    ) {
      throw new Error(
        `Base Plan solver finished with ${output.status}.`,
      );
    }

    const groupIds = [
      ...new Set(
        output.sessions.map(
          (session) => session.teaching_group_id,
        ),
      ),
    ];

    const groups = await prisma.teachingGroup.findMany({
      where: {
        tenantId: plan.tenantId,
        id: {
          in: groupIds,
        },
      },
      include: {
        students: {
          select: {
            studentId: true,
          },
        },
      },
    });

    const groupsById = new Map(
      groups.map((group) => [group.id, group]),
    );

    await prisma.$transaction(async (tx) => {
      for (const item of output.sessions) {
        const group = groupsById.get(
          item.teaching_group_id,
        );

        if (!group) {
          throw new Error(
            `Solver returned unknown teaching group ${item.teaching_group_id}.`,
          );
        }

        if (!item.date) {
          throw new Error(
            "Planning-horizon solver returned a session without a date.",
          );
        }

        const assignments =
          item.staffing_assignments &&
          item.staffing_assignments.length > 0
            ? item.staffing_assignments
            : (
                item.instructor_ids &&
                item.instructor_ids.length > 0
                  ? item.instructor_ids
                  : [item.instructor_id]
              ).map((instructorId, index) => ({
                instructor_id: instructorId,
                role:
                  index === 0
                    ? StaffingRoleType.LEAD
                    : StaffingRoleType.ASSISTANT,
              }));

        const uniqueAssignments = [
          ...new Map(
            assignments.map((assignment) => [
              assignment.instructor_id,
              assignment,
            ]),
          ).values(),
        ];

        await tx.scenarioSession.create({
          data: {
            tenantId: plan.tenantId,
            planScenarioId: scenario.id,
            teachingGroupId: item.teaching_group_id,
            roomId: item.room_id,
            date: dateValue(item.date),
            startMinute: item.start_minute,
            endMinute: item.end_minute,
            origin: "GENERATED",
            instructors: {
              create: uniqueAssignments.map(
                (assignment) => ({
                  tenantId: plan.tenantId,
                  instructorId:
                    assignment.instructor_id,
                  role: staffingRole(
                    assignment.role,
                  ),
                }),
              ),
            },
            students: {
              create: group.students.map(
                (student) => ({
                  tenantId: plan.tenantId,
                  studentId: student.studentId,
                }),
              ),
            },
          },
        });
      }

      const afterScenario =
        await tx.planScenario.update({
          where: {
            id: scenario.id,
          },
          data: {
            status: ScenarioStatus.GENERATED,
            solverScore: output.objective_value,
            objectiveSummary: {
              solverStatus: output.status,
              schemaVersion: output.schema_version,
              metrics: output.metrics ?? [],
              diagnostics: JSON.parse(
                JSON.stringify(output.diagnostics ?? {}),
              ) as Prisma.InputJsonValue,
              inputFingerprint,
            } satisfies Prisma.InputJsonValue,
            generatedAt: new Date(),
            failureMessage: null,
          },
        });

      await tx.plan.update({
        where: {
          id: plan.id,
        },
        data: {
          status: PlanStatus.GENERATED,
        },
      });

      await ensureReviewWorkflow(tx, {
        id: plan.id,
        tenantId: plan.tenantId,
        planningScopeId: plan.planningScopeId,
        version: plan.version,
      });

      await writeAuditEvent(tx, {
        tenantId: plan.tenantId,
        eventType: "GENERATED",
        entityType: "PlanScenario",
        entityId: scenario.id,
        actor: DEMO_ACTOR,
        description:
          `Base Plan proposal generated for v${plan.version}: ` +
          `${output.sessions.length} session(s), solver ${output.status}.`,
        source: "planning.base-plan.generate",
        correlationId,
        planId: plan.id,
        scenarioId: scenario.id,
        beforeState: {
          status: ScenarioStatus.GENERATING,
        },
        afterState: {
          status: afterScenario.status,
          solverStatus: output.status,
          solverScore: output.objective_value,
          sessionCount: output.sessions.length,
          inputFingerprint,
        },
      });
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await prisma.$transaction(async (tx) => {
      await tx.planScenario.update({
        where: {
          id: scenario.id,
        },
        data: {
          status: ScenarioStatus.FAILED,
          failureMessage: message,
          generatedAt: new Date(),
        },
      });

      await writeAuditEvent(tx, {
        tenantId: plan.tenantId,
        eventType: "UPDATED",
        entityType: "PlanScenario",
        entityId: scenario.id,
        actor: DEMO_ACTOR,
        description:
          `Base Plan proposal generation failed for v${plan.version}.`,
        source: "planning.base-plan.generate",
        correlationId,
        planId: plan.id,
        scenarioId: scenario.id,
        beforeState: {
          status: ScenarioStatus.GENERATING,
        },
        afterState: {
          status: ScenarioStatus.FAILED,
          failureMessage: message,
        },
      });
    });

    throw error;
  } finally {
    rmSync(workDir, {
      recursive: true,
      force: true,
    });
  }

  revalidatePath("/planning");
  revalidatePath("/planning/base-plan");
  revalidatePath("/schedule");
  revalidatePath("/history");

  redirect(
    `/planning?scenario=${scenario.id}&review=1#scenario-review`,
  );
}
