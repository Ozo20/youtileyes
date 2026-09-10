import {
  prepareRecoveryCandidate,
  runSolverVerification,
  type SolverInputLike,
} from "../src/lib/planning/recovery-verification";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const input: SolverInputLike = {
  schemaVersion: "1.2",
  tenantId: "TEST",
  planScenarioId: "SCENARIO",
  planningWindow: {
    asOfDate: "2026-09-01",
    frozenThroughDate: "2026-09-13",
    startDate: "2026-09-14",
    endDate: "2026-09-18",
  },
  // Only one start time is deliberately available.
  startTimes: [8 * 60 + 15],
  instructors: [
    {
      id: "I1",
      name: "Instructor 1",
      courseIds: ["MAT"],
      coursePenalties: { MAT: 0 },
    },
  ],
  rooms: [
    {
      id: "R1",
      name: "Room 1",
      capacity: 30,
    },
  ],
  teachingGroups: [
    {
      id: "G1",
      courseId: "MAT",
      studentIds: ["S1", "S2"],
      durationMinutes: 45,
      allowedRoomIds: ["R1"],
      roomPenalties: {},
      instructorPenalties: {},
    },
  ],
  calendarDays: [
    { date: "2026-09-14", teachingAllowed: true },
    { date: "2026-09-15", teachingAllowed: true },
  ],
  // Two occurrences both initially have only Monday available.
  // Each has a valid candidate, but both cannot occupy the same
  // instructor/room/student slot, so the model is genuinely INFEASIBLE.
  teachingOccurrences: [
    {
      id: "O1",
      teachingGroupId: "G1",
      weekStartDate: "2026-09-14",
      durationMinutes: 45,
      allowedDates: ["2026-09-14"],
    },
    {
      id: "O2",
      teachingGroupId: "G1",
      weekStartDate: "2026-09-14",
      durationMinutes: 45,
      allowedDates: ["2026-09-14"],
    },
  ],
  resourceBlocks: {
    instructors: [],
    students: [],
    rooms: [],
  },
  travel: [
    {
      fromRoomId: "R1",
      toRoomId: "R1",
      minutes: 0,
    },
  ],
  studentLoadProfile: {
    maxTeachingMinutesPerDay: 270,
    maxContinuousTeachingMinutes: 120,
    minBreakMinutes: 15,
    minBreakAfterDoubleMinutes: 20,
    maxSessionsPerDay: 4,
    minLunchMinutes: 30,
    lunchWindowStart: 11 * 60,
    lunchWindowEnd: 13 * 60 + 30,
    travelConsumesBreakTime: true,
  },
  metadata: {},
};

async function main() {
  const baseline = await runSolverVerification(input);

  assert(
    baseline.status !== "OPTIMAL" && baseline.status !== "FEASIBLE",
    `Synthetic baseline should be infeasible, got ${baseline.status}.`,
  );

  const prepared = prepareRecoveryCandidate(input, "G1", {
    code: "RESTORE_BLOCKED_DAY",
    title: "Restore blocked day",
  });

  assert(
    prepared.status === "READY",
    "Restore-day candidate was not prepared.",
  );
  assert(prepared.input, "Restore-day candidate has no solver input.");

  const restoredOccurrences =
    prepared.input.teachingOccurrences ?? [];

  assert(
    restoredOccurrences.every((occurrence) =>
      occurrence.allowedDates.includes("2026-09-15"),
    ),
    "The recovery transform did not restore Tuesday for all affected occurrences.",
  );

  const recovered = await runSolverVerification(prepared.input);

  assert(
    recovered.status === "OPTIMAL" || recovered.status === "FEASIBLE",
    `Expected solver-verified recovery, got ${recovered.status}.`,
  );

  const policyOnly = prepareRecoveryCandidate(input, "G1", {
    code: "ADD_QUALIFIED_INSTRUCTOR",
    title: "Add instructor",
  });

  assert(
    policyOnly.status === "REQUIRES_POLICY_CHANGE",
    "Adding an unspecified instructor must not be falsely solver-verified.",
  );

  console.log("Solver-verified recovery test: PASS");
  console.log(`Baseline solver status: ${baseline.status}`);
  console.log(`Recovery solver status: ${recovered.status}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
