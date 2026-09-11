import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type RecoveryVerificationStatus =
  | "VERIFIED"
  | "NOT_FEASIBLE"
  | "ESTIMATED"
  | "REQUIRES_POLICY_CHANGE"
  | "NOT_APPLICABLE";

export type SolverSessionLike = {
  teaching_group_id?: string;
  teachingGroupId?: string;
  date?: string | null;
  start_minute?: number;
  startMinute?: number;
  end_minute?: number;
  endMinute?: number;
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
};


export type SolverOutputLike = {
  status: string;
  objective_value?: number | null;
  objectiveValue?: number | null;
  sessions?: SolverSessionLike[];
  diagnostics?: Record<string, unknown>;
};

export type SolverInputLike = {
  schemaVersion: string;
  tenantId: string;
  planScenarioId: string;
  planningWindow?: {
    asOfDate: string;
    frozenThroughDate?: string | null;
    startDate: string;
    endDate: string;
  };
  startTimes: number[];
  instructors: Array<{
    id: string;
    name: string;
    courseIds: string[];
    coursePenalties?: Record<string, number>;
    qualificationLevels?: Record<string, number>;
  }>;
  rooms: Array<{
    id: string;
    name: string;
    capacity: number;
    staffingRoles?: Array<{
      id: string;
      role: string;
      requiredQualificationId?: string | null;
      minimumQualificationLevel?: number | null;
    }>;
  }>;
  teachingGroups: Array<{
    id: string;
    courseId: string;
    studentIds: string[];
    durationMinutes: number;
    allowedRoomIds: string[];
    roomPenalties?: Record<string, number>;
    instructorPenalties?: Record<string, number>;
    staffingRoles?: Array<{
      id: string;
      role: string;
      requiredQualificationId?: string | null;
      minimumQualificationLevel?: number | null;
    }>;
  }>;
  calendarDays?: Array<{
    date: string;
    teachingAllowed: boolean;
  }>;
  teachingOccurrences?: Array<{
    id: string;
    teachingGroupId: string;
    weekStartDate: string;
    durationMinutes: number;
    allowedDates: string[];
  }>;
  resourceBlocks?: {
    instructors?: Array<{
      resourceId: string;
      date: string;
      startMinute: number;
      endMinute: number;
    }>;
    students?: Array<{
      resourceId: string;
      date: string;
      startMinute: number;
      endMinute: number;
    }>;
    rooms?: Array<{
      resourceId: string;
      date: string;
      startMinute: number;
      endMinute: number;
    }>;
  };
  travel?: Array<{
    fromRoomId: string;
    toRoomId: string;
    minutes: number;
  }>;
  studentLoadProfile: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type RecoveryCandidateDescriptor = {
  code: string;
  title: string;
  deferredMinutes?: number;
};

export type PreparedRecoveryCandidate = {
  status:
    | "READY"
    | "ESTIMATED"
    | "REQUIRES_POLICY_CHANGE"
    | "NOT_APPLICABLE";
  explanation: string;
  input?: SolverInputLike;
};

export type VerifiedRecoveryResult = {
  code: string;
  title: string;
  verificationStatus: RecoveryVerificationStatus;
  explanation: string;
  solverStatus: string | null;
  objectiveValue: number | null;
  scheduledSessionCount: number | null;
};

function cloneSolverInput(input: SolverInputLike): SolverInputLike {
  return structuredClone(input);
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function datesInOccurrenceWeek(
  input: SolverInputLike,
  weekStartDate: string,
): string[] {
  const endExclusive = addDays(weekStartDate, 7);
  const start = weekStartDate;

  return (input.calendarDays ?? [])
    .filter(
      (day) =>
        day.teachingAllowed &&
        day.date >= start &&
        day.date < endExclusive &&
        (!input.planningWindow ||
          (day.date >= input.planningWindow.startDate &&
            day.date <= input.planningWindow.endDate)),
    )
    .map((day) => day.date)
    .sort();
}

function prepareRestoreBlockedDay(
  baseInput: SolverInputLike,
  teachingGroupId: string,
): PreparedRecoveryCandidate {
  const input = cloneSolverInput(baseInput);
  const occurrences = (input.teachingOccurrences ?? []).filter(
    (item) => item.teachingGroupId === teachingGroupId,
  );

  if (occurrences.length === 0) {
    return {
      status: "NOT_APPLICABLE",
      explanation:
        "No solver occurrences were found for the affected teaching group.",
    };
  }

  let restoredDateCount = 0;

  for (const occurrence of occurrences) {
    const possibleDates = datesInOccurrenceWeek(input, occurrence.weekStartDate);
    const restoredDate = possibleDates.find(
      (date) => !occurrence.allowedDates.includes(date),
    );

    if (!restoredDate) continue;

    occurrence.allowedDates = [...occurrence.allowedDates, restoredDate].sort();
    restoredDateCount += 1;
  }

  if (restoredDateCount === 0) {
    return {
      status: "NOT_APPLICABLE",
      explanation:
        "No blocked teaching date could be restored from the current solver calendar.",
    };
  }

  input.metadata = {
    ...(input.metadata ?? {}),
    recoveryVerification: {
      action: "RESTORE_BLOCKED_DAY",
      teachingGroupId,
      restoredOccurrenceCount: restoredDateCount,
    },
  };

  return {
    status: "READY",
    explanation: `Restored an additional teaching date for ${restoredDateCount} occurrence(s) and prepared the candidate for solver verification.`,
    input,
  };
}

function prepareCarryOver(
  baseInput: SolverInputLike,
  teachingGroupId: string,
  deferredMinutes: number,
): PreparedRecoveryCandidate {
  if (deferredMinutes <= 0) {
    return {
      status: "NOT_APPLICABLE",
      explanation: "The recovery option does not defer any teaching minutes.",
    };
  }

  const input = cloneSolverInput(baseInput);
  const occurrences = input.teachingOccurrences ?? [];
  const affected = occurrences
    .filter((item) => item.teachingGroupId === teachingGroupId)
    .sort((a, b) => {
      if (a.weekStartDate !== b.weekStartDate) {
        return b.weekStartDate.localeCompare(a.weekStartDate);
      }
      return b.id.localeCompare(a.id);
    });

  let remaining = deferredMinutes;
  const removeIds = new Set<string>();

  for (const occurrence of affected) {
    if (remaining <= 0) break;

    if (occurrence.durationMinutes <= remaining) {
      remaining -= occurrence.durationMinutes;
      removeIds.add(occurrence.id);
      continue;
    }

    occurrence.durationMinutes -= remaining;
    remaining = 0;
  }

  if (remaining > 0) {
    return {
      status: "NOT_APPLICABLE",
      explanation:
        "The requested carry-over exceeds the teaching minutes present in the current solver input.",
    };
  }

  input.teachingOccurrences = occurrences.filter(
    (item) => !removeIds.has(item.id),
  );

  input.metadata = {
    ...(input.metadata ?? {}),
    recoveryVerification: {
      action: "CARRY_OVER_SHORTFALL",
      teachingGroupId,
      deferredMinutes,
    },
  };

  return {
    status: "READY",
    explanation:
      "Removed/decreased the deferred teaching occurrences from the current planning horizon. The remaining timetable can now be solver-verified; changing the formal period target still requires approval.",
    input,
  };
}

export function prepareRecoveryCandidate(
  baseInput: SolverInputLike,
  teachingGroupId: string,
  candidate: RecoveryCandidateDescriptor,
): PreparedRecoveryCandidate {
  switch (candidate.code) {
    case "RESTORE_BLOCKED_DAY":
      return prepareRestoreBlockedDay(baseInput, teachingGroupId);

    case "CARRY_OVER_SHORTFALL":
      return prepareCarryOver(
        baseInput,
        teachingGroupId,
        candidate.deferredMinutes ?? 0,
      );

    case "ADD_QUALIFIED_INSTRUCTOR":
      return {
        status: "REQUIRES_POLICY_CHANGE",
        explanation:
          "A solver verification cannot invent a real instructor. A qualified instructor must first be selected or made available in master data.",
      };

    case "ADD_ELIGIBLE_ROOM":
      return {
        status: "REQUIRES_POLICY_CHANGE",
        explanation:
          "A solver verification cannot invent a real room. An existing room must first be made eligible/available, or a real room must be added.",
      };

    case "EXTEND_HORIZON_ONE_WEEK":
      return {
        status: "REQUIRES_POLICY_CHANGE",
        explanation:
          "Extending the planning horizon changes the plan target and requires new calendar/allocation data before solver verification.",
      };

    case "INCREASE_WEEKLY_CAPACITY":
      return {
        status: "ESTIMATED",
        explanation:
          "The current solver contract contains concrete teaching occurrences rather than the weekly capacity ceiling. Feasibility can estimate this action, but exact verification requires regenerating allocations first.",
      };

    default:
      return {
        status: "ESTIMATED",
        explanation:
          "This recovery action does not yet have an exact solver-input transformation.",
      };
  }
}

function findPythonExecutable(): string {
  return process.env.YOUTILEYES_SOLVER_PYTHON ?? "solver/.venv/bin/python";
}

export async function runSolverVerification(
  input: SolverInputLike,
): Promise<SolverOutputLike> {
  const directory = await mkdtemp(join(tmpdir(), "youtileyes-recovery-"));
  const inputPath = join(directory, "input.json");
  const outputPath = join(directory, "output.json");

  try {
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");

    const result = spawnSync(
      findPythonExecutable(),
      [
        "-m",
        "solver.src.cli",
        "--input",
        inputPath,
        "--output",
        outputPath,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONPATH: ".",
        },
        encoding: "utf8",
      },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        [
          "Solver verification process failed.",
          result.stdout?.trim(),
          result.stderr?.trim(),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    return JSON.parse(await readFile(outputPath, "utf8")) as SolverOutputLike;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function verifyRecoveryCandidate(
  baseInput: SolverInputLike,
  teachingGroupId: string,
  candidate: RecoveryCandidateDescriptor,
): Promise<VerifiedRecoveryResult> {
  const prepared = prepareRecoveryCandidate(
    baseInput,
    teachingGroupId,
    candidate,
  );

  if (prepared.status !== "READY") {
    return {
      code: candidate.code,
      title: candidate.title,
      verificationStatus: prepared.status,
      explanation: prepared.explanation,
      solverStatus: null,
      objectiveValue: null,
      scheduledSessionCount: null,
    };
  }

  if (!prepared.input) {
    return {
      code: candidate.code,
      title: candidate.title,
      verificationStatus: "NOT_APPLICABLE",
      explanation:
        "The recovery candidate was marked READY but did not contain solver input.",
      solverStatus: null,
      objectiveValue: null,
      scheduledSessionCount: null,
    };
  }

  const output = await runSolverVerification(prepared.input);
  const feasible = output.status === "OPTIMAL" || output.status === "FEASIBLE";

  return {
    code: candidate.code,
    title: candidate.title,
    verificationStatus: feasible ? "VERIFIED" : "NOT_FEASIBLE",
    explanation: feasible
      ? `${prepared.explanation} OR-Tools found a valid timetable.`
      : `${prepared.explanation} OR-Tools did not find a valid timetable.`,
    solverStatus: output.status,
    objectiveValue:
      output.objective_value ?? output.objectiveValue ?? null,
    scheduledSessionCount: output.sessions?.length ?? 0,
  };
}
