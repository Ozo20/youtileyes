import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";

import {
  applyResourceDisruptions,
  compareRecoveryOutputsForDisruptions,
  type ResourceDisruption,
} from "../src/lib/planning/resource-recovery";
import {
  runSolverVerification,
  type SolverInputLike,
  type SolverOutputLike,
} from "../src/lib/planning/recovery-verification";
import {
  scenarioChangeType,
  toPrismaJson,
  type RecoveryScenarioSession,
} from "../src/lib/planning/recovery-scenario";
import {
  normalizeSolverStaffing,
  staffingInstructorIds,
} from "../src/lib/planning/solver-staffing";
import { writeAuditEvent } from "../src/lib/audit";
import { prisma } from "../src/lib/prisma";

const INPUT_PATH =
  process.env.YOUTILEYES_SOLVER_INPUT ??
  "/tmp/youtileyes_solver_input.json";

const REPORT_PATH =
  process.env.YOUTILEYES_RECOVERY_SCENARIO_REPORT ??
  "/tmp/youtileyes_recovery_case_scenario.json";

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

function parseCaseId() {
  const index = process.argv.indexOf("--case");

  if (index === -1 || !process.argv[index + 1]) {
    throw new Error("Required argument: --case <recovery-case-id>");
  }

  return process.argv[index + 1];
}

function solverScore(output: SolverOutputLike) {
  return output.objective_value ?? output.objectiveValue ?? null;
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
    const roomId = session.room_id ?? session.roomId;

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

async function main() {
  const recoveryCaseId = parseCaseId();

  const input = JSON.parse(
    await readFile(INPUT_PATH, "utf8"),
  ) as SolverInputLike;

  const recoveryCase = await prisma.recoveryCase.findUnique({
    where: {
      id: recoveryCaseId,
    },
    include: {
      baseScenario: {
        include: {
          plan: true,
        },
      },
      disruptions: {
        where: {
          active: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!recoveryCase) {
    throw new Error("Recovery case not found.");
  }

  if (recoveryCase.baseScenarioId !== input.planScenarioId) {
    throw new Error(
      "Solver input does not match the recovery case baseline.",
    );
  }

  if (recoveryCase.tenantId !== input.tenantId) {
    throw new Error(
      "Solver input tenant does not match the recovery case tenant.",
    );
  }

  if (recoveryCase.disruptions.length === 0) {
    throw new Error("Recovery case has no active disruptions.");
  }

  const disruptions: ResourceDisruption[] =
    recoveryCase.disruptions.map((item) => ({
      type: item.type,
      resourceId: item.resourceId,
      startDate: item.startDate.toISOString().slice(0, 10),
      endDate: item.endDate.toISOString().slice(0, 10),
      startMinute: item.startMinute ?? undefined,
      endMinute: item.endMinute ?? undefined,
    }));

  const baselineOutput = await runSolverVerification(input);

  if (
    baselineOutput.status !== "OPTIMAL" &&
    baselineOutput.status !== "FEASIBLE"
  ) {
    throw new Error(
      `Base solver input must be feasible. Got ${baselineOutput.status}.`,
    );
  }

  /*
   * All active disruptions are applied to one copy of the same baseline
   * before OR-Tools runs. This is the key recovery-case invariant: the
   * solver must satisfy the complete set simultaneously.
   */
  const disruptedInput = applyResourceDisruptions(
    input,
    disruptions,
  );
  const recoveredOutput =
    await runSolverVerification(disruptedInput);

  if (
    recoveredOutput.status !== "OPTIMAL" &&
    recoveredOutput.status !== "FEASIBLE"
  ) {
    throw new Error(
      `Recovery case is not feasible. Solver status ${recoveredOutput.status}.`,
    );
  }

  const changes = compareRecoveryOutputsForDisruptions(
    baselineOutput,
    recoveredOutput,
    disruptions,
  );

  const directChangeCount = changes.filter(
    (item) => item.direct,
  ).length;
  const cascadingChangeCount =
    changes.length - directChangeCount;

  const recoveredSessions =
    normalizeRecoveredSessions(recoveredOutput);

  /*
   * ScenarioSession does not store occurrenceId directly. The same pattern
   * as the existing one-disruption persistence path is used: occurrenceId
   * is retained in memory while persisting, so ScenarioChange can be linked
   * to the newly created ScenarioSession.
   */
  const groupIds = [
    ...new Set(
      recoveredSessions.map(
        (session) => session.teachingGroupId,
      ),
    ),
  ];

  const teachingGroups = await prisma.teachingGroup.findMany({
    where: {
      tenantId: recoveryCase.tenantId,
      id: {
        in: groupIds,
      },
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
      group.students.map(
        (membership) => membership.studentId,
      ),
    ]),
  );

  const scenarioName =
    `Recovery case v${recoveryCase.version} · ` +
    recoveryCase.disruptions
      .map((item) => item.resourceLabel.split(" · ")[0])
      .join(" + ");

  const score = solverScore(recoveredOutput);

  const scenario = await prisma.$transaction(async (tx) => {
    await tx.recoveryCaseProposal.updateMany({
      where: {
        recoveryCaseId,
        status: "CURRENT",
      },
      data: {
        status: "STALE",
      },
    });

    const created = await tx.planScenario.create({
      data: {
        tenantId: recoveryCase.tenantId,
        planId: recoveryCase.planId,
        name: scenarioName,
        status: "GENERATED",
        solverScore: score,
        objectiveSummary: toPrismaJson({
          solverStatus: recoveredOutput.status,
          recoveryCaseId,
          caseVersion: recoveryCase.version,
          disruptionCount: disruptions.length,
          changedSessionCount: changes.length,
          directChangeCount,
          cascadingChangeCount,
        }),
        generationConfig: toPrismaJson({
          type: "RECOVERY_CASE",
          recoveryCaseId,
          caseVersion: recoveryCase.version,
          basedOnScenarioId: recoveryCase.baseScenarioId,
          disruptions: recoveryCase.disruptions.map(
            (item) => ({
              id: item.id,
              type: item.type,
              resourceId: item.resourceId,
              resourceLabel: item.resourceLabel,
              startDate: item.startDate
                .toISOString()
                .slice(0, 10),
              endDate: item.endDate
                .toISOString()
                .slice(0, 10),
            }),
          ),
        }),
        generatedAt: new Date(),
      },
    });

    const scenarioSessionByOccurrence =
      new Map<string, string>();

    for (const session of recoveredSessions) {
      const createdSession =
        await tx.scenarioSession.create({
          data: {
            tenantId: recoveryCase.tenantId,
            planScenarioId: created.id,
            teachingGroupId: session.teachingGroupId,
            roomId: session.roomId,
            date: new Date(
              `${session.date}T00:00:00.000Z`,
            ),
            startMinute: session.startMinute,
            endMinute: session.endMinute,
            origin: "REPLANNED",
            changeReason:
              `Recovery case v${recoveryCase.version} with ` +
              `${disruptions.length} active disruption(s).`,
            instructors: {
              create: session.staffingAssignments.map(
                (assignment) => ({
                  tenantId: recoveryCase.tenantId,
                  instructorId: assignment.instructorId,
                  role: assignment.role,
                }),
              ),
            },
            students: {
              create: (
                studentsByGroup.get(
                  session.teachingGroupId,
                ) ?? []
              ).map((studentId) => ({
                tenantId: recoveryCase.tenantId,
                studentId,
              })),
            },
          },
          select: {
            id: true,
          },
        });

      scenarioSessionByOccurrence.set(
        session.occurrenceId,
        createdSession.id,
      );
    }

    for (const change of changes) {
      await tx.scenarioChange.create({
        data: {
          tenantId: recoveryCase.tenantId,
          planScenarioId: created.id,
          scenarioSessionId:
            scenarioSessionByOccurrence.get(
              change.occurrenceId,
            ) ?? null,
          changeType: scenarioChangeType(
            change.changedFields,
          ),
          explanationCode: change.direct
            ? "RESOURCE_RECOVERY_DIRECT"
            : "RESOURCE_RECOVERY_CASCADE",
          explanation: change.direct
            ? "Session directly affected by one or more active recovery disruptions."
            : "Session changed to keep the combined recovery case feasible.",
          beforeState: change.before
            ? toPrismaJson(change.before)
            : undefined,
          afterState: change.after
            ? toPrismaJson(change.after)
            : undefined,
        },
      });
    }

    /*
     * ScenarioMetricType intentionally stays within the existing enum.
     * Detailed counts are differentiated by `key`, matching the established
     * persistence pattern used by create-resource-recovery-scenario.ts.
     */
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
      {
        metricType: "OTHER" as const,
        key: "disruptionCount",
        value: disruptions.length,
        unit: "count",
      },
    ];

    for (const metric of metrics) {
      await tx.scenarioMetric.create({
        data: {
          tenantId: recoveryCase.tenantId,
          planScenarioId: created.id,
          ...metric,
        },
      });
    }

    await tx.recoveryCaseProposal.create({
      data: {
        tenantId: recoveryCase.tenantId,
        recoveryCaseId,
        scenarioId: created.id,
        caseVersion: recoveryCase.version,
        status: "CURRENT",
      },
    });

    await tx.recoveryCase.update({
      where: {
        id: recoveryCaseId,
      },
      data: {
        status: "READY",
      },
    });

    await writeAuditEvent(tx, {
      tenantId: recoveryCase.tenantId,
      eventType: "GENERATED",
      entityType: "RecoveryCase",
      entityId: recoveryCaseId,
      description:
        `Recovery case v${recoveryCase.version} generated with ` +
        `${disruptions.length} disruption(s) and ` +
        `${changes.length} session change(s).`,
      source: "planning.recovery-case.generate",
      planId: recoveryCase.planId,
      scenarioId: created.id,
      afterState: {
        recoveryCaseId,
        caseVersion: recoveryCase.version,
        scenarioId: created.id,
        disruptionCount: disruptions.length,
        changedSessionCount: changes.length,
        directChangeCount,
        cascadingChangeCount,
        solverStatus: recoveredOutput.status,
      },
      context: {
        basedOnScenarioId: recoveryCase.baseScenarioId,
        disruptions: recoveryCase.disruptions.map(
          (item) => ({
            id: item.id,
            type: item.type,
            resourceId: item.resourceId,
            resourceLabel: item.resourceLabel,
            startDate: item.startDate
              .toISOString()
              .slice(0, 10),
            endDate: item.endDate
              .toISOString()
              .slice(0, 10),
          }),
        ),
        multiInstructorSessionCount:
          recoveredSessions.filter(
            (session) =>
              session.instructorIds.length > 1,
          ).length,
        persistedInstructorAssignmentCount:
          recoveredSessions.reduce(
            (sum, session) =>
              sum + session.instructorIds.length,
            0,
          ),
      },
    });

    for (const change of changes) {
      await writeAuditEvent(tx, {
        tenantId: recoveryCase.tenantId,
        eventType: "UPDATED",
        entityType: "ScenarioSession",
        entityId:
          scenarioSessionByOccurrence.get(
            change.occurrenceId,
          ) ?? null,
        description: change.direct
          ? `Direct recovery-case change for occurrence ${change.occurrenceId}.`
          : `Cascading recovery-case change for occurrence ${change.occurrenceId}.`,
        source: "planning.recovery-case.generate",
        planId: recoveryCase.planId,
        scenarioId: created.id,
        beforeState: change.before,
        afterState: change.after,
        context: {
          recoveryCaseId,
          caseVersion: recoveryCase.version,
          occurrenceId: change.occurrenceId,
          teachingGroupId: change.teachingGroupId,
          direct: change.direct,
          changedFields: change.changedFields,
          beforeStaffing:
            change.before?.staffingAssignments ?? [],
          afterStaffing:
            change.after?.staffingAssignments ?? [],
        },
      });
    }

    return created;
  });

  const report = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    recoveryCaseId,
    caseVersion: recoveryCase.version,
    planId: recoveryCase.planId,
    solverStatus: recoveredOutput.status,
    solverScore: score,
    sessions: recoveredSessions.length,
    instructorAssignments: recoveredSessions.reduce(
      (sum, session) =>
        sum + session.instructorIds.length,
      0,
    ),
    multiInstructorSessions:
      recoveredSessions.filter(
        (session) => session.instructorIds.length > 1,
      ).length,
    disruptionCount: disruptions.length,
    changedSessionCount: changes.length,
    directChangeCount,
    cascadingChangeCount,
  };

  await writeFile(
    REPORT_PATH,
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );

  console.log("=== YOUTILEYES RECOVERY CASE ===");
  console.log(`Case: ${recoveryCase.id}`);
  console.log(`Case version: ${recoveryCase.version}`);
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Scenario ID: ${scenario.id}`);
  console.log(`Disruptions: ${disruptions.length}`);
  console.log(`Solver: ${recoveredOutput.status}`);
  console.log(`Sessions: ${recoveredSessions.length}`);
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
