import { simulateRequirementRecovery } from "../src/lib/planning/recovery";
import type { FeasibilityRequirementInput } from "../src/lib/planning/feasibility";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const redInput: FeasibilityRequirementInput = {
  requirementId: "REQ-RED",
  groupCode: "ST2A-MAT",
  groupName: "ST2A Mathematics",
  courseCode: "MAT",
  courseName: "Mathematics",
  carryoverAllowed: true,
  preferredWeeklyMinutes: 90,
  courseMaxSessionsPerDay: 1,
  coursePreferredSessionMinutes: 90,
  courseMaxSessionMinutes: 90,
  qualifiedInstructorCount: 1,
  eligibleRoomCount: 1,
  blockedTeachingDays: 1,
  weeks: [
    {
      weekStartDate: "2026-12-07",
      targetMinutes: 270,
      availableTeachingDays: 2,
      maxWeeklyMinutes: 180,
    },
  ],
};

const options = simulateRequirementRecovery(redInput);

assert(options.length >= 3, "Expected multiple recovery simulations.");
assert(
  options.some((option) => option.code === "INCREASE_WEEKLY_CAPACITY"),
  "Missing capacity option.",
);
assert(
  options.some((option) => option.code === "CARRY_OVER_SHORTFALL"),
  "Missing carry-over option.",
);
assert(
  options.some((option) => option.closesShortfall),
  "Expected at least one option to close the shortfall.",
);

// Ranking policy:
// 1. Options that close the shortfall come before options that do not.
// 2. Within each of those groups, lower disruptionScore ranks first.
// 3. For equal disruption, the larger resulting margin ranks first.
for (let index = 1; index < options.length; index += 1) {
  const previous = options[index - 1];
  const current = options[index];

  if (previous.closesShortfall !== current.closesShortfall) {
    assert(
      previous.closesShortfall && !current.closesShortfall,
      "A non-closing recovery option was ranked ahead of an option that closes the shortfall.",
    );
    continue;
  }

  if (previous.disruptionScore !== current.disruptionScore) {
    assert(
      previous.disruptionScore <= current.disruptionScore,
      "Recovery options with the same feasibility outcome are not ordered by disruption.",
    );
    continue;
  }

  assert(
    previous.resultingMarginMinutes >= current.resultingMarginMinutes,
    "Recovery options with equal disruption are not ordered by resulting margin.",
  );
}

console.log("Planning recovery simulation test: PASS");

for (const [index, option] of options.entries()) {
  console.log(
    `${index + 1}. ${option.title} -> ${option.resultingStatus} · margin ${option.resultingMarginMinutes} min · disruption ${option.disruptionScore}`,
  );
}
