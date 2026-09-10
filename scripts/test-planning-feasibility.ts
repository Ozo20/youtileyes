import {
  analyzeRequirementFeasibility,
  summarizeFeasibility,
  type FeasibilityRequirementInput,
} from "../src/lib/planning/feasibility";

function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const base: FeasibilityRequirementInput = {
  requirementId: "REQ",
  groupCode: "8C-MAT",
  groupName: "8C Mathematics",
  courseCode: "MAT",
  courseName: "Mathematics",
  carryoverAllowed: true,
  preferredWeeklyMinutes: 90,
  courseMaxSessionsPerDay: 2,
  coursePreferredSessionMinutes: 45,
  courseMaxSessionMinutes: 90,
  qualifiedInstructorCount: 2,
  eligibleRoomCount: 3,
  blockedTeachingDays: 0,
  weeks: [
    { weekStartDate: "2026-11-30", targetMinutes: 90, availableTeachingDays: 5, maxWeeklyMinutes: 180 },
    { weekStartDate: "2026-12-07", targetMinutes: 90, availableTeachingDays: 5, maxWeeklyMinutes: 180 },
  ],
};

const green = analyzeRequirementFeasibility(base);
expect(green.status === "GREEN", `Expected GREEN, got ${green.status}`);

const amber = analyzeRequirementFeasibility({
  ...base,
  weeks: [
    { weekStartDate: "2026-11-30", targetMinutes: 170, availableTeachingDays: 5, maxWeeklyMinutes: 180 },
  ],
});
expect(amber.status === "AMBER", `Expected AMBER, got ${amber.status}`);

const red = analyzeRequirementFeasibility({
  ...base,
  blockedTeachingDays: 1,
  weeks: [
    { weekStartDate: "2026-12-07", targetMinutes: 240, availableTeachingDays: 4, maxWeeklyMinutes: 180 },
  ],
});
expect(red.status === "RED", `Expected RED, got ${red.status}`);
expect(red.recoveryOptions.some((option) => option.code === "RESTORE_ACTIVITY_DAY"), "Expected activity-day recovery option.");
expect(red.recoveryOptions.some((option) => option.code === "CARRY_OVER"), "Expected carry-over recovery option.");

const missingTeacher = analyzeRequirementFeasibility({ ...base, qualifiedInstructorCount: 0 });
expect(missingTeacher.status === "RED", "Missing qualified instructor must be RED.");
expect(
  missingTeacher.recoveryOptions.some((option) => option.code === "ADD_QUALIFIED_INSTRUCTOR"),
  "Expected qualified-instructor recovery option.",
);

const summary = summarizeFeasibility([green, amber, red]);
expect(summary.status === "RED", "Summary should inherit highest severity.");
expect(summary.counts.GREEN === 1 && summary.counts.AMBER === 1 && summary.counts.RED === 1, "Unexpected summary counts.");

console.log("Planning feasibility test: PASS");
