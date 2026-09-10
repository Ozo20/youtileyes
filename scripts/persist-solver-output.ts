import "dotenv/config";

import { readFile } from "node:fs/promises";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/prisma";

type SolverSession = {
  teaching_group_id: string;
  start_minute: number;
  end_minute: number;
  instructor_id: string;
  room_id: string;
};

type SolverMetric = {
  key: string;
  value: number;
  unit?: string | null;
};

type SolverOutput = {
  schema_version: string;
  tenant_id: string;
  plan_scenario_id: string;
  status: string;
  objective_value?: number | null;
  sessions: SolverSession[];
  metrics?: SolverMetric[];
  diagnostics?: Prisma.InputJsonObject;
};

const SUPPORTED_SCHEMA_VERSIONS = new Set(["1.0", "1.1"]);

function metricTypeFromKey(key: string) {
  switch (key) {
    case "scheduledTeachingMinutes":
      return "TOTAL_TEACHING_MINUTES" as const;
    case "scheduledSessionCount":
      return "OTHER" as const;
    default:
      return "OTHER" as const;
  }
}

function solverDate(output: SolverOutput): Date {
  const value = output.diagnostics?.date;

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      "Solver output diagnostics.date must be a YYYY-MM-DD string",
    );
  }

  return new Date(`${value}T00:00:00.000Z`);
}

async function main() {
  const inputPath =
    process.argv[2] ?? "/tmp/youtileyes_solver_output.json";

  const raw = await readFile(inputPath, "utf8");
  const output = JSON.parse(raw) as SolverOutput;

  if (!SUPPORTED_SCHEMA_VERSIONS.has(output.schema_version)) {
    throw new Error(
      `Unsupported solver output schema version: ${output.schema_version}`,
    );
  }

  if (!['OPTIMAL', 'FEASIBLE'].includes(output.status)) {
    throw new Error(
      `Solver output cannot be persisted as a generated scenario because status is ${output.status}`,
    );
  }

  const sessionDate = solverDate(output);

  const scenario = await prisma.planScenario.findUnique({
    where: { id: output.plan_scenario_id },
    include: { plan: true },
  });

  if (!scenario) {
    throw new Error(`PlanScenario ${output.plan_scenario_id} was not found`);
  }

  if (scenario.tenantId !== output.tenant_id) {
    throw new Error("Tenant mismatch between solver output and PlanScenario");
  }

  const solverJob = await prisma.solverJob.create({
    data: {
      tenantId: scenario.tenantId,
      planScenarioId: scenario.id,
      status: "RUNNING",
      startedAt: new Date(),
      config: {
        source: "solver-output-import",
        schemaVersion: output.schema_version,
      },
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.scenarioSessionInstructor.deleteMany({
        where: {
          scenarioSession: {
            planScenarioId: scenario.id,
          },
        },
      });

      await tx.scenarioSessionStudent.deleteMany({
        where: {
          scenarioSession: {
            planScenarioId: scenario.id,
          },
        },
      });

      await tx.scenarioChange.deleteMany({
        where: { planScenarioId: scenario.id },
      });

      await tx.scenarioMetric.deleteMany({
        where: { planScenarioId: scenario.id },
      });

      await tx.scenarioSession.deleteMany({
        where: { planScenarioId: scenario.id },
      });

      const teachingGroups = await tx.teachingGroup.findMany({
        where: {
          id: {
            in: output.sessions.map((session) => session.teaching_group_id),
          },
        },
        include: { students: true },
      });

      const groupById = new Map(
        teachingGroups.map((group) => [group.id, group]),
      );

      for (const session of output.sessions) {
        const group = groupById.get(session.teaching_group_id);

        if (!group) {
          throw new Error(
            `TeachingGroup ${session.teaching_group_id} was not found`,
          );
        }

        const scenarioSession = await tx.scenarioSession.create({
          data: {
            tenantId: scenario.tenantId,
            planScenarioId: scenario.id,
            teachingGroupId: session.teaching_group_id,
            roomId: session.room_id,
            date: sessionDate,
            startMinute: session.start_minute,
            endMinute: session.end_minute,
            origin: "GENERATED",
            locked: false,
          },
        });

        await tx.scenarioSessionInstructor.create({
          data: {
            tenantId: scenario.tenantId,
            scenarioSessionId: scenarioSession.id,
            instructorId: session.instructor_id,
          },
        });

        if (group.students.length > 0) {
          await tx.scenarioSessionStudent.createMany({
            data: group.students.map((membership) => ({
              tenantId: scenario.tenantId,
              scenarioSessionId: scenarioSession.id,
              studentId: membership.studentId,
            })),
          });
        }
      }

      for (const metric of output.metrics ?? []) {
        await tx.scenarioMetric.create({
          data: {
            tenantId: scenario.tenantId,
            planScenarioId: scenario.id,
            metricType: metricTypeFromKey(metric.key),
            key: metric.key,
            value: metric.value,
            unit: metric.unit ?? null,
          },
        });
      }

      await tx.solverRun.create({
        data: {
          tenantId: scenario.tenantId,
          solverJobId: solverJob.id,
          status: output.status === "OPTIMAL" ? "OPTIMAL" : "FEASIBLE",
          solverName: "Google OR-Tools CP-SAT",
          solverVersion: "9.15.6755",
          objectiveValue: output.objective_value ?? null,
          completedAt: new Date(),
          diagnostics: output.diagnostics ?? {},
        },
      });

      await tx.planScenario.update({
        where: { id: scenario.id },
        data: {
          status: "GENERATED",
          solverScore: output.objective_value ?? null,
          objectiveSummary: output.diagnostics ?? {},
          generatedAt: new Date(),
          failureMessage: null,
        },
      });

      await tx.solverJob.update({
        where: { id: solverJob.id },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
        },
      });
    });

    console.log("Solver output persisted");
    console.log(`Scenario: ${scenario.name}`);
    console.log(`Sessions: ${output.sessions.length}`);
    console.log(`Status: ${output.status}`);
    console.log(`Objective: ${output.objective_value ?? "n/a"}`);
    console.log(`Date: ${sessionDate.toISOString().slice(0, 10)}`);
  } catch (error) {
    await prisma.solverJob.update({
      where: { id: solverJob.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        failureMessage:
          error instanceof Error ? error.message : String(error),
      },
    });

    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
