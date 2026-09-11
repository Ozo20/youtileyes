import "dotenv/config";

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import {
  applyResourceDisruption,
  compareRecoveryOutputs,
  type ResourceDisruption,
} from "../src/lib/planning/resource-recovery";
import {
  runSolverVerification,
  type SolverInputLike,
  type SolverOutputLike,
} from "../src/lib/planning/recovery-verification";
import {
  buildScenarioName,
  scenarioChangeType,
  toPrismaJson,
  type RecoveryScenarioSession,
} from "../src/lib/planning/recovery-scenario";
import { writeAuditEvent } from "../src/lib/audit";
import { prisma } from "../src/lib/prisma";
import {
  normalizeSolverStaffing,
  staffingInstructorIds,
} from "../src/lib/planning/solver-staffing";

const INPUT_PATH =
  process.env.YOUTILEYES_SOLVER_INPUT ??
  "/tmp/youtileyes_solver_input.json";

const REPORT_PATH =
  process.env.YOUTILEYES_RECOVERY_SCENARIO_REPORT ??
  "/tmp/youtileyes_recovery_scenario.json";

type SolverSessionRecord = {
  occurrence_id?: string | null;
  occurrenceId?: string | null;
  teaching_group_id?: string;
  teachingGroupId?: string;
  date?: string | null;
  start_minute?: number;
  startMinute?: number;
  end_minute?: number;
  endMinute?: number;
  instructor_id?: string;
  instructorId?: string;
  instructor_ids?: string[];
  instructorIds?: string[];
  staffing_assignments?: Array<{
    role?: string;
    instructor_id?: string;
    instructorId?: string;
  }>;
  staffingAssignments?: Array<{
    role?: string;
    instructor_id?: string;
    instructorId?: string;
  }>;
  room_id?: string;
  roomId?: string;
};

function parseArgs(): ResourceDisruption & { label?: string } {
  const args = new Map<string, string>();

  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];

    if (!key || !value || !key.startsWith("--")) continue;
    args.set(key.slice(2), value);
  }

  const type = args.get("type");
  const resourceId = args.get("resource");
  const startDate = args.get("from");
  const endDate = args.get("to") ?? startDate;

  if (
    type !== "INSTRUCTOR_UNAVAILABLE" &&
    type !== "ROOM_UNAVAILABLE"
  ) {
    throw new Error(
      '--type must be "INSTRUCTOR_UNAVAILABLE" or "ROOM_UNAVAILABLE".',
    );
  }

  if (!resourceId || !startDate || !endDate) {
    throw new Error(
      "Required arguments: --type <...> --resource <uuid> --from YYYY-MM-DD [--to YYYY-MM-DD]",
    );
  }

  return {
    type,
    resourceId,
    startDate,
    endDate,
    startMinute: args.has("startMinute")
      ? Number(args.get("startMinute"))
      : undefined,
    endMinute: args.has("endMinute")
      ? Number(args.get("endMinute"))
      : undefined,
    label: args.get("label"),
  };
}

function normalizeRecoveredSessions(
  output: SolverOutputLike,
): RecoveryScenarioSession[] {
  return (output.sessions ?? []).map((raw) => {
    const session = raw as SolverSessionRecord;

    const occurrenceId =
      session.occurrence_id ?? session.occurrenceId ?? null;
    const teachingGroupId =
      session.teaching_group_id ?? session.teachingGroupId;
    const startMinute =
      session.start_minute ?? session.startMinute;
    const endMinute =
      session.end_minute ?? session.endMinute;
    const staffingAssignments = normalizeSolverStaffing(session);
    const instructorIds =
      staffingInstructorIds(staffingAssignments);
    const instructorId =
      session.instructor_id ??
      session.instructorId ??
      instructorIds[0];
    const roomId =
      session.room_id ?? session.roomId;

    if (
      !occurrenceId ||
      !teachingGroupId ||
      !session.date ||
      startMinute === undefined ||
      endMinute === undefined ||
      !instructorId ||
      !roomId
    ) {
      throw new Error(
        `Incomplete recovered solver session: ${JSON.stringify(session)}`,
      );
    }

    return {
      occurrenceId,
      teachingGroupId,
      date: session.date,
      startMinute,
      endMinute,
      instructorId,
      instructorIds,
      staffingAssignments,
      roomId,
    };
  });
}

async function resolveResourceLabel(
  disruption: ResourceDisruption,
  explicitLabel?: string,
) {
  if (explicitLabel) return explicitLabel;

  if (disruption.type === "INSTRUCTOR_UNAVAILABLE") {
    const instructor = await prisma.instructor.findUnique({
      where: { id: disruption.resourceId },
      select: {
        firstName: true,
        lastName: true,
      },
    });

    if (instructor) {
      return `${instructor.firstName} ${instructor.lastName}`;
    }
  } else {
    const room = await prisma.room.findUnique({
      where: { id: disruption.resourceId },
      select: { name: true },
    });

    if (room) return room.name;
  }

  return disruption.resourceId;
}

async function main() {
  const input = JSON.parse(
    await readFile(INPUT_PATH, "utf8"),
  ) as SolverInputLike;

  const disruptionWithLabel = parseArgs();
  const { label, ...disruption } = disruptionWithLabel;

  const baseScenario = await prisma.planScenario.findUnique({
    where: { id: input.planScenarioId },
    include: {
      plan: true,
    },
  });

  if (!baseScenario) {
    throw new Error(
      `Base PlanScenario ${input.planScenarioId} was not found.`,
    );
  }

  if (baseScenario.tenantId !== input.tenantId) {
    throw new Error(
      "Solver input tenant does not match the base scenario tenant.",
    );
  }

  const baselineOutput = await runSolverVerification(input);

  if (
    baselineOutput.status !== "OPTIMAL" &&
    baselineOutput.status !== "FEASIBLE"
  ) {
    throw new Error(
      `Base solver input must be feasible before recovery. Got ${baselineOutput.status}.`,
    );
  }

  const disruptedInput = applyResourceDisruption(input, disruption);
  const recoveredOutput = await runSolverVerification(disruptedInput);

  if (
    recoveredOutput.status !== "OPTIMAL" &&
    recoveredOutput.status !== "FEASIBLE"
  ) {
    throw new Error(
      `Recovery is not feasible. Solver status: ${recoveredOutput.status}.`,
    );
  }

  const changes = compareRecoveryOutputs(
    baselineOutput,
    recoveredOutput,
    disruption,
  );

  const recoveredSessions =
    normalizeRecoveredSessions(recoveredOutput);

  const groupIds = [
    ...new Set(
      recoveredSessions.map((session) => session.teachingGroupId),
    ),
  ];

  const teachingGroups = await prisma.teachingGroup.findMany({
    where: {
      tenantId: baseScenario.tenantId,
      id: { in: groupIds },
    },
    select: {
      id: true,
      students: {
        select: {
          studentId: true,
        },
      },
    },
  });

  const studentsByGroup = new Map(
    teachingGroups.map((group) => [
      group.id,
      group.students.map((membership) => membership.studentId),
    ]),
  );

  const resourceLabel = await resolveResourceLabel(
    disruption,
    label,
  );

  const scenarioName = buildScenarioName(
    resourceLabel,
    disruption.startDate,
    disruption.endDate,
  );

  const correlationId = randomUUID();

  const directChangeCount = changes.filter(
    (change) => change.direct,
  ).length;
  const cascadingChangeCount =
    changes.length - directChangeCount;

  const scenario = await prisma.$transaction(async (tx) => {
    const created = await tx.planScenario.create({
      data: {
        tenantId: baseScenario.tenantId,
        planId: baseScenario.planId,
        name: scenarioName,
        status: "GENERATED",
        solverScore:
          recoveredOutput.objective_value ??
          recoveredOutput.objectiveValue ??
          null,
        generatedAt: new Date(),
        generationConfig: toPrismaJson({
          type: "RESOURCE_RECOVERY",
          basedOnScenarioId: baseScenario.id,
          disruption,
        }),
        objectiveSummary: toPrismaJson({
          solverStatus: recoveredOutput.status,
          changedSessionCount: changes.length,
          directChangeCount,
          cascadingChangeCount,
          disruption,
        }),
      },
    });

    const scenarioSessionByOccurrence = new Map<string, string>();

    for (const session of recoveredSessions) {
      const createdSession = await tx.scenarioSession.create({
        data: {
          tenantId: baseScenario.tenantId,
          planScenarioId: created.id,
          teachingGroupId: session.teachingGroupId,
          roomId: session.roomId,
          date: new Date(`${session.date}T00:00:00.000Z`),
          startMinute: session.startMinute,
          endMinute: session.endMinute,
          origin: "REPLANNED",
          changeReason:
            disruption.type === "INSTRUCTOR_UNAVAILABLE"
              ? `Recovery after instructor unavailability: ${resourceLabel}`
              : `Recovery after room unavailability: ${resourceLabel}`,
          instructors: {
            create: session.staffingAssignments.map((assignment) => ({
              tenantId: baseScenario.tenantId,
              instructorId: assignment.instructorId,
              role: assignment.role,
            })),
          },
          students: {
            create: (studentsByGroup.get(session.teachingGroupId) ?? []).map(
              (studentId) => ({
                tenantId: baseScenario.tenantId,
                studentId,
              }),
            ),
          },
        },
        select: { id: true },
      });

      scenarioSessionByOccurrence.set(
        session.occurrenceId,
        createdSession.id,
      );
    }

    for (const change of changes) {
      await tx.scenarioChange.create({
        data: {
          tenantId: baseScenario.tenantId,
          planScenarioId: created.id,
          scenarioSessionId:
            scenarioSessionByOccurrence.get(change.occurrenceId) ??
            null,
          changeType: scenarioChangeType(
            change.changedFields,
          ),
          explanationCode: change.direct
            ? "RESOURCE_RECOVERY_DIRECT"
            : "RESOURCE_RECOVERY_CASCADE",
          explanation: change.direct
            ? `Direct change caused by ${resourceLabel} being unavailable.`
            : `Cascading change required to preserve a feasible global timetable after ${resourceLabel} became unavailable.`,
          beforeState: change.before
            ? toPrismaJson(change.before)
            : undefined,
          afterState: change.after
            ? toPrismaJson(change.after)
            : undefined,
        },
      });
    }

    const metrics = [
      {
        metricType: "SESSION_CHANGE_COUNT" as const,
        key: "changedSessionCount",
        value: changes.length,
        unit: "count",
      },
      {
        metricType: "OTHER" as const,
        key: "directChangeCount",
        value: directChangeCount,
        unit: "count",
      },
      {
        metricType: "OTHER" as const,
        key: "cascadingChangeCount",
        value: cascadingChangeCount,
        unit: "count",
      },
    ];

    for (const metric of metrics) {
      await tx.scenarioMetric.create({
        data: {
          tenantId: baseScenario.tenantId,
          planScenarioId: created.id,
          ...metric,
        },
      });
    }

    await writeAuditEvent(tx, {
      tenantId: baseScenario.tenantId,
      eventType: "GENERATED",
      entityType: "PlanScenario",
      entityId: created.id,
      description:
        `Recovery scenario generated for ${resourceLabel}: ` +
        `${changes.length} session change(s), ` +
        `${directChangeCount} direct, ${cascadingChangeCount} cascading.`,
      source: "planning.resource-recovery",
      correlationId,
      planId: baseScenario.planId,
      scenarioId: created.id,
      beforeState: {
        scenarioId: baseScenario.id,
        scenarioName: baseScenario.name,
      },
      afterState: {
        scenarioId: created.id,
        scenarioName: created.name,
        status: created.status,
      },
      context: {
        basedOnScenarioId: baseScenario.id,
        disruption,
        solverStatus: recoveredOutput.status,
        changedSessionCount: changes.length,
        directChangeCount,
        cascadingChangeCount,
        multiInstructorSessionCount: recoveredSessions.filter(
          (session) => session.instructorIds.length > 1,
        ).length,
        persistedInstructorAssignmentCount: recoveredSessions.reduce(
          (sum, session) => sum + session.instructorIds.length,
          0,
        ),
      },
    });

    for (const change of changes) {
      await writeAuditEvent(tx, {
        tenantId: baseScenario.tenantId,
        eventType: "UPDATED",
        entityType: "ScenarioSession",
        entityId:
          scenarioSessionByOccurrence.get(change.occurrenceId) ??
          null,
        description: change.direct
          ? `Direct recovery change for occurrence ${change.occurrenceId}.`
          : `Cascading recovery change for occurrence ${change.occurrenceId}.`,
        source: "planning.resource-recovery",
        correlationId,
        planId: baseScenario.planId,
        scenarioId: created.id,
        beforeState: change.before,
        afterState: change.after,
        context: {
          occurrenceId: change.occurrenceId,
          teachingGroupId: change.teachingGroupId,
          direct: change.direct,
          changedFields: change.changedFields,
          disruption,
          beforeStaffing: change.before?.staffingAssignments ?? [],
          afterStaffing: change.after?.staffingAssignments ?? [],
        },
      });
    }

    return created;
  });

  const report = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    basedOnScenarioId: baseScenario.id,
    planId: baseScenario.planId,
    disruption,
    resourceLabel,
    solverStatus: recoveredOutput.status,
    solverScore:
      recoveredOutput.objective_value ??
      recoveredOutput.objectiveValue ??
      null,
    sessions: recoveredSessions.length,
    instructorAssignments: recoveredSessions.reduce(
      (sum, session) => sum + session.instructorIds.length,
      0,
    ),
    multiInstructorSessions: recoveredSessions.filter(
      (session) => session.instructorIds.length > 1,
    ).length,
    changedSessionCount: changes.length,
    directChangeCount,
    cascadingChangeCount,
    changes,
  };

  await writeFile(
    REPORT_PATH,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log("=== YOUTILEYES RECOVERY SCENARIO ===");
  console.log(`Scenario: ${scenario.name}`);
  console.log(`ID: ${scenario.id}`);
  console.log(`Based on: ${baseScenario.name}`);
  console.log(`Resource: ${resourceLabel}`);
  console.log(`Solver: ${recoveredOutput.status}`);
  console.log(`Sessions: ${recoveredSessions.length}`);
  console.log(
    `Instructor assignments: ${recoveredSessions.reduce(
      (sum, session) => sum + session.instructorIds.length,
      0,
    )}`,
  );
  console.log(
    `Multi-instructor sessions: ${recoveredSessions.filter(
      (session) => session.instructorIds.length > 1,
    ).length}`,
  );
  console.log(`Changes: ${changes.length}`);
  console.log(`Direct: ${directChangeCount}`);
  console.log(`Cascading: ${cascadingChangeCount}`);
  console.log(`Report: ${REPORT_PATH}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
