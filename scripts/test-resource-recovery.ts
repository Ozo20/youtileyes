import {
  verifyResourceDisruption,
  type ResourceRecoveryResult,
} from "../src/lib/planning/resource-recovery";
import type { SolverInputLike } from "../src/lib/planning/recovery-verification";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const input: SolverInputLike = {
  schemaVersion: "1.2",
  tenantId: "TEST",
  planScenarioId: "RESOURCE-RECOVERY",
  planningWindow: {
    asOfDate: "2026-09-01",
    frozenThroughDate: "2026-09-13",
    startDate: "2026-09-14",
    endDate: "2026-09-18",
  },
  startTimes: [8 * 60 + 15],
  instructors: [
    {
      id: "A",
      name: "Teacher A",
      courseIds: ["MAT"],
      coursePenalties: { MAT: 0 },
    },
    {
      id: "B",
      name: "Teacher B",
      courseIds: ["MAT", "ENG"],
      coursePenalties: { MAT: 10, ENG: 0 },
    },
    {
      id: "C",
      name: "Teacher C",
      courseIds: ["ENG"],
      coursePenalties: { ENG: 5 },
    },
  ],
  rooms: [
    { id: "R1", name: "Room 1", capacity: 30 },
    { id: "R2", name: "Room 2", capacity: 30 },
  ],
  teachingGroups: [
    {
      id: "G-MAT",
      courseId: "MAT",
      studentIds: ["S1"],
      durationMinutes: 45,
      allowedRoomIds: ["R1"],
      roomPenalties: { R1: 0 },
      instructorPenalties: { A: 0, B: 10 },
    },
    {
      id: "G-ENG",
      courseId: "ENG",
      studentIds: ["S2"],
      durationMinutes: 45,
      allowedRoomIds: ["R2"],
      roomPenalties: { R2: 0 },
      instructorPenalties: { B: 0, C: 5 },
    },
  ],
  calendarDays: [
    { date: "2026-09-14", teachingAllowed: true },
  ],
  teachingOccurrences: [
    {
      id: "O-MAT",
      teachingGroupId: "G-MAT",
      weekStartDate: "2026-09-14",
      durationMinutes: 45,
      allowedDates: ["2026-09-14"],
    },
    {
      id: "O-ENG",
      teachingGroupId: "G-ENG",
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
    { fromRoomId: "R1", toRoomId: "R1", minutes: 0 },
    { fromRoomId: "R2", toRoomId: "R2", minutes: 0 },
    { fromRoomId: "R1", toRoomId: "R2", minutes: 0 },
    { fromRoomId: "R2", toRoomId: "R1", minutes: 0 },
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

function findChange(result: ResourceRecoveryResult, occurrenceId: string) {
  return result.changes.find((item) => item.occurrenceId === occurrenceId);
}

async function main() {
  const result = await verifyResourceDisruption(input, {
    type: "INSTRUCTOR_UNAVAILABLE",
    resourceId: "A",
    startDate: "2026-09-14",
    endDate: "2026-09-14",
  });

  assert(result.status === "VERIFIED", "Expected verified resource recovery.");

  const math = findChange(result, "O-MAT");
  const english = findChange(result, "O-ENG");

  assert(math, "Mathematics occurrence was not changed.");
  assert(math.direct, "Mathematics change should be direct.");
  assert(math.before?.instructorId === "A", "Baseline MAT teacher should be A.");
  assert(math.after?.instructorId === "B", "Recovered MAT teacher should be B.");

  assert(english, "English occurrence was not changed.");
  assert(!english.direct, "English change should be a cascading change.");
  assert(english.before?.instructorId === "B", "Baseline ENG teacher should be B.");
  assert(english.after?.instructorId === "C", "Recovered ENG teacher should be C.");

  assert(
    result.indirectChangeCount >= 1,
    "Expected at least one cascading resource change.",
  );

  console.log("Resource recovery chain test: PASS");
  console.log(result.explanation);
  console.log("A unavailable -> B covers MAT -> C covers ENG");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
