import {
  runSolverVerification,
  type SolverInputLike,
  type SolverOutputLike,
} from "./recovery-verification";
import {
  normalizeSolverStaffing,
  staffingInstructorIds,
  type SolverStaffingAssignment,
} from "./solver-staffing";

export type ResourceDisruptionType =
  | "INSTRUCTOR_UNAVAILABLE"
  | "ROOM_UNAVAILABLE";

export type ResourceDisruption = {
  type: ResourceDisruptionType;
  resourceId: string;
  startDate: string;
  endDate: string;
  startMinute?: number;
  endMinute?: number;
};

export type ResourceRecoverySessionChange = {
  occurrenceId: string;
  teachingGroupId: string | null;
  direct: boolean;
  before: {
    date: string | null;
    startMinute: number | null;
    endMinute: number | null;
    instructorId: string | null;
    instructorIds: string[];
    staffingAssignments: SolverStaffingAssignment[];
    roomId: string | null;
  } | null;
  after: {
    date: string | null;
    startMinute: number | null;
    endMinute: number | null;
    instructorId: string | null;
    instructorIds: string[];
    staffingAssignments: SolverStaffingAssignment[];
    roomId: string | null;
  } | null;
  changedFields: string[];
};

export type ResourceRecoveryResult = {
  status: "VERIFIED" | "NOT_FEASIBLE";
  baselineSolverStatus: string;
  recoveredSolverStatus: string | null;
  disruption: ResourceDisruption;
  changedSessionCount: number;
  directChangeCount: number;
  indirectChangeCount: number;
  changes: ResourceRecoverySessionChange[];
  explanation: string;
};

type NormalizedSession = {
  occurrenceId: string;
  teachingGroupId: string | null;
  date: string | null;
  startMinute: number | null;
  endMinute: number | null;
  instructorId: string | null;
  instructorIds: string[];
  staffingAssignments: SolverStaffingAssignment[];
  roomId: string | null;
};

function dateKeyInRange(date: string, startDate: string, endDate: string) {
  return date >= startDate && date <= endDate;
}

function normalizeSession(session: unknown): NormalizedSession {
  const value = session as Record<string, unknown>;

  const occurrenceId =
    (value.occurrence_id as string | undefined) ??
    (value.occurrenceId as string | undefined);

  if (!occurrenceId) {
    throw new Error("Solver output session is missing occurrence id.");
  }

  const staffingAssignments = normalizeSolverStaffing(
    value as Parameters<typeof normalizeSolverStaffing>[0],
  );
  const instructorIds = staffingInstructorIds(staffingAssignments);

  return {
    occurrenceId,
    teachingGroupId:
      (value.teaching_group_id as string | undefined) ??
      (value.teachingGroupId as string | undefined) ??
      null,
    date: (value.date as string | null | undefined) ?? null,
    startMinute:
      (value.start_minute as number | undefined) ??
      (value.startMinute as number | undefined) ??
      null,
    endMinute:
      (value.end_minute as number | undefined) ??
      (value.endMinute as number | undefined) ??
      null,
    instructorId:
      (value.instructor_id as string | undefined) ??
      (value.instructorId as string | undefined) ??
      instructorIds[0] ??
      null,
    instructorIds,
    staffingAssignments,
    roomId:
      (value.room_id as string | undefined) ??
      (value.roomId as string | undefined) ??
      null,
  };
}

function sessionMap(output: SolverOutputLike) {
  return new Map(
    (output.sessions ?? []).map((session) => {
      const normalized = normalizeSession(session);
      return [normalized.occurrenceId, normalized] as const;
    }),
  );
}

function cloneInput(input: SolverInputLike): SolverInputLike {
  return structuredClone(input);
}

function activeTeachingDates(
  input: SolverInputLike,
  disruption: ResourceDisruption,
) {
  const dates = new Set<string>();

  for (const occurrence of input.teachingOccurrences ?? []) {
    for (const date of occurrence.allowedDates) {
      if (dateKeyInRange(date, disruption.startDate, disruption.endDate)) {
        dates.add(date);
      }
    }
  }

  return [...dates].sort();
}

export function applyResourceDisruption(
  baseInput: SolverInputLike,
  disruption: ResourceDisruption,
): SolverInputLike {
  const input = cloneInput(baseInput);
  const dates = activeTeachingDates(input, disruption);
  const startMinute = disruption.startMinute ?? 0;
  const endMinute = disruption.endMinute ?? 24 * 60;

  input.resourceBlocks ??= {};
  input.resourceBlocks.instructors ??= [];
  input.resourceBlocks.students ??= [];
  input.resourceBlocks.rooms ??= [];

  const target =
    disruption.type === "INSTRUCTOR_UNAVAILABLE"
      ? input.resourceBlocks.instructors
      : input.resourceBlocks.rooms;

  for (const date of dates) {
    const duplicate = target.some(
      (block) =>
        block.resourceId === disruption.resourceId &&
        block.date === date &&
        block.startMinute === startMinute &&
        block.endMinute === endMinute,
    );

    if (!duplicate) {
      target.push({
        resourceId: disruption.resourceId,
        date,
        startMinute,
        endMinute,
      });
    }
  }

  input.metadata = {
    ...(input.metadata ?? {}),
    resourceRecovery: {
      disruption,
      affectedTeachingDates: dates,
    },
  };

  return input;
}

function changedFields(
  before: NormalizedSession | undefined,
  after: NormalizedSession | undefined,
) {
  if (!before || !after) return ["presence"];

  const result: string[] = [];

  if (before.date !== after.date) result.push("date");
  if (before.startMinute !== after.startMinute) result.push("startMinute");
  if (before.endMinute !== after.endMinute) result.push("endMinute");
  if (before.instructorId !== after.instructorId) result.push("instructorId");

  if (
    JSON.stringify(before.instructorIds) !==
    JSON.stringify(after.instructorIds)
  ) {
    result.push("instructorIds");
  }

  if (
    JSON.stringify(before.staffingAssignments) !==
    JSON.stringify(after.staffingAssignments)
  ) {
    result.push("staffingAssignments");
  }

  if (before.roomId !== after.roomId) result.push("roomId");

  return result;
}

function isDirectChange(
  before: NormalizedSession | undefined,
  disruption: ResourceDisruption,
) {
  if (!before) return false;

  if (disruption.type === "INSTRUCTOR_UNAVAILABLE") {
    return before.instructorIds.includes(disruption.resourceId);
  }

  return before.roomId === disruption.resourceId;
}

export function compareRecoveryOutputs(
  baseline: SolverOutputLike,
  recovered: SolverOutputLike,
  disruption: ResourceDisruption,
): ResourceRecoverySessionChange[] {
  const beforeByOccurrence = sessionMap(baseline);
  const afterByOccurrence = sessionMap(recovered);

  const occurrenceIds = new Set([
    ...beforeByOccurrence.keys(),
    ...afterByOccurrence.keys(),
  ]);

  const changes: ResourceRecoverySessionChange[] = [];

  for (const occurrenceId of [...occurrenceIds].sort()) {
    const before = beforeByOccurrence.get(occurrenceId);
    const after = afterByOccurrence.get(occurrenceId);
    const fields = changedFields(before, after);

    if (fields.length === 0) continue;

    changes.push({
      occurrenceId,
      teachingGroupId:
        before?.teachingGroupId ?? after?.teachingGroupId ?? null,
      direct: isDirectChange(before, disruption),
      before: before
        ? {
            date: before.date,
            startMinute: before.startMinute,
            endMinute: before.endMinute,
            instructorId: before.instructorId,
            instructorIds: before.instructorIds,
            staffingAssignments: before.staffingAssignments,
            roomId: before.roomId,
          }
        : null,
      after: after
        ? {
            date: after.date,
            startMinute: after.startMinute,
            endMinute: after.endMinute,
            instructorId: after.instructorId,
            instructorIds: after.instructorIds,
            staffingAssignments: after.staffingAssignments,
            roomId: after.roomId,
          }
        : null,
      changedFields: fields,
    });
  }

  return changes;
}

export async function verifyResourceDisruption(
  baseInput: SolverInputLike,
  disruption: ResourceDisruption,
): Promise<ResourceRecoveryResult> {
  const baseline = await runSolverVerification(baseInput);

  if (baseline.status !== "OPTIMAL" && baseline.status !== "FEASIBLE") {
    throw new Error(
      `Baseline timetable must be feasible before resource recovery can be evaluated. Got ${baseline.status}.`,
    );
  }

  const disruptedInput = applyResourceDisruption(baseInput, disruption);

  try {
    const recovered = await runSolverVerification(disruptedInput);
    const feasible =
      recovered.status === "OPTIMAL" || recovered.status === "FEASIBLE";

    if (!feasible) {
      return {
        status: "NOT_FEASIBLE",
        baselineSolverStatus: baseline.status,
        recoveredSolverStatus: recovered.status,
        disruption,
        changedSessionCount: 0,
        directChangeCount: 0,
        indirectChangeCount: 0,
        changes: [],
        explanation:
          "The resource disruption was applied, but OR-Tools could not produce a valid replacement timetable.",
      };
    }

    const changes = compareRecoveryOutputs(
      baseline,
      recovered,
      disruption,
    );
    const directChangeCount = changes.filter((item) => item.direct).length;
    const indirectChangeCount = changes.length - directChangeCount;

    return {
      status: "VERIFIED",
      baselineSolverStatus: baseline.status,
      recoveredSolverStatus: recovered.status,
      disruption,
      changedSessionCount: changes.length,
      directChangeCount,
      indirectChangeCount,
      changes,
      explanation:
        indirectChangeCount > 0
          ? `OR-Tools found a valid replacement timetable with ${directChangeCount} direct and ${indirectChangeCount} cascading change(s).`
          : `OR-Tools found a valid replacement timetable with ${directChangeCount} direct change(s) and no cascading changes.`,
    };
  } catch (error) {
    return {
      status: "NOT_FEASIBLE",
      baselineSolverStatus: baseline.status,
      recoveredSolverStatus: null,
      disruption,
      changedSessionCount: 0,
      directChangeCount: 0,
      indirectChangeCount: 0,
      changes: [],
      explanation:
        error instanceof Error
          ? `No valid replacement timetable could be generated: ${error.message}`
          : "No valid replacement timetable could be generated.",
    };
  }
}
