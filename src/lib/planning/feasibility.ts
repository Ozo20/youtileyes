export type FeasibilityStatus = "GREEN" | "AMBER" | "RED";

export type FeasibilityWeekInput = {
  weekStartDate: string;
  targetMinutes: number;
  availableTeachingDays: number;
  maxWeeklyMinutes: number | null;
};

export type FeasibilityRequirementInput = {
  requirementId: string;
  groupCode: string;
  groupName: string;
  courseCode: string | null;
  courseName: string;
  carryoverAllowed: boolean;
  preferredWeeklyMinutes: number | null;
  courseMaxSessionsPerDay: number | null;
  coursePreferredSessionMinutes: number | null;
  courseMaxSessionMinutes: number | null;
  qualifiedInstructorCount: number;
  eligibleRoomCount: number;
  blockedTeachingDays: number;
  weeks: FeasibilityWeekInput[];
};

export type RecoveryOption = {
  code:
    | "CARRY_OVER"
    | "RESTORE_ACTIVITY_DAY"
    | "INCREASE_WEEKLY_CAPACITY"
    | "ADD_QUALIFIED_INSTRUCTOR"
    | "ADD_ELIGIBLE_ROOM"
    | "EXTEND_HORIZON";
  title: string;
  description: string;
  estimatedRecoveredMinutes: number | null;
  requiresApproval: boolean;
};

export type RequirementFeasibilityResult = {
  requirementId: string;
  groupCode: string;
  groupName: string;
  courseCode: string | null;
  courseName: string;
  status: FeasibilityStatus;
  requiredMinutes: number;
  estimatedCapacityMinutes: number;
  marginMinutes: number;
  marginPercent: number | null;
  blockedTeachingDays: number;
  qualifiedInstructorCount: number;
  eligibleRoomCount: number;
  reasons: string[];
  recoveryOptions: RecoveryOption[];
};

export type FeasibilitySummary = {
  status: FeasibilityStatus;
  requirements: RequirementFeasibilityResult[];
  counts: Record<FeasibilityStatus, number>;
};

function weekCapacity(input: FeasibilityRequirementInput, week: FeasibilityWeekInput): number {
  if (week.availableTeachingDays <= 0) return 0;
  if (input.qualifiedInstructorCount <= 0) return 0;
  if (input.eligibleRoomCount <= 0) return 0;

  const sessionMinutes =
    input.courseMaxSessionMinutes ??
    input.coursePreferredSessionMinutes ??
    input.preferredWeeklyMinutes ??
    45;

  const sessionsPerDay = Math.max(input.courseMaxSessionsPerDay ?? 4, 1);
  const calendarCapacity = week.availableTeachingDays * sessionsPerDay * Math.max(sessionMinutes, 1);

  return week.maxWeeklyMinutes === null
    ? calendarCapacity
    : Math.min(calendarCapacity, Math.max(week.maxWeeklyMinutes, 0));
}

function resultStatus(required: number, capacity: number): FeasibilityStatus {
  if (capacity < required) return "RED";
  if (required === 0) return "GREEN";

  const marginRatio = (capacity - required) / required;
  return marginRatio < 0.2 ? "AMBER" : "GREEN";
}

function recoveryOptions(
  input: FeasibilityRequirementInput,
  required: number,
  capacity: number,
): RecoveryOption[] {
  const shortfall = Math.max(required - capacity, 0);
  if (shortfall === 0) return [];

  const options: RecoveryOption[] = [];

  if (input.qualifiedInstructorCount === 0) {
    options.push({
      code: "ADD_QUALIFIED_INSTRUCTOR",
      title: "Provide a qualified instructor",
      description: "Add or reallocate a qualified instructor for this course within the planning horizon.",
      estimatedRecoveredMinutes: null,
      requiresApproval: true,
    });
  }

  if (input.eligibleRoomCount === 0) {
    options.push({
      code: "ADD_ELIGIBLE_ROOM",
      title: "Provide an eligible room",
      description: "Make a suitable room available or relax the room suitability restriction.",
      estimatedRecoveredMinutes: null,
      requiresApproval: true,
    });
  }

  if (input.blockedTeachingDays > 0) {
    const sessionMinutes =
      input.coursePreferredSessionMinutes ?? input.courseMaxSessionMinutes ?? 45;
    const estimated = input.blockedTeachingDays * Math.max(sessionMinutes, 1);

    options.push({
      code: "RESTORE_ACTIVITY_DAY",
      title: "Restore blocked teaching capacity",
      description:
        "Review cohort activity days or other blocking exceptions. Cancelling or shortening one may recover teaching capacity.",
      estimatedRecoveredMinutes: estimated,
      requiresApproval: true,
    });
  }

  const activeWeeks = input.weeks.filter((week) => week.availableTeachingDays > 0).length;
  if (activeWeeks > 0 && input.weeks.some((week) => week.maxWeeklyMinutes !== null)) {
    const extraPerWeek = Math.ceil(shortfall / activeWeeks);
    options.push({
      code: "INCREASE_WEEKLY_CAPACITY",
      title: "Increase weekly teaching capacity",
      description: `Approximately ${extraPerWeek} additional minute(s) per available week would close the current shortfall.`,
      estimatedRecoveredMinutes: shortfall,
      requiresApproval: true,
    });
  }

  if (input.carryoverAllowed) {
    options.push({
      code: "CARRY_OVER",
      title: "Carry teaching into the next academic period",
      description: `Move approximately ${shortfall} minute(s) beyond the current target date.`,
      estimatedRecoveredMinutes: shortfall,
      requiresApproval: true,
    });
  }

  options.push({
    code: "EXTEND_HORIZON",
    title: "Extend the planning horizon",
    description: "Move the target date later and re-run feasibility analysis before generating a new schedule.",
    estimatedRecoveredMinutes: shortfall,
    requiresApproval: true,
  });

  return options;
}

export function analyzeRequirementFeasibility(
  input: FeasibilityRequirementInput,
): RequirementFeasibilityResult {
  const requiredMinutes = input.weeks.reduce((sum, week) => sum + week.targetMinutes, 0);
  const estimatedCapacityMinutes = input.weeks.reduce(
    (sum, week) => sum + weekCapacity(input, week),
    0,
  );
  const marginMinutes = estimatedCapacityMinutes - requiredMinutes;
  const marginPercent = requiredMinutes === 0 ? null : (marginMinutes / requiredMinutes) * 100;
  const status = resultStatus(requiredMinutes, estimatedCapacityMinutes);
  const reasons: string[] = [];

  if (input.qualifiedInstructorCount === 0) reasons.push("No qualified instructor is available for the course.");
  if (input.eligibleRoomCount === 0) reasons.push("No eligible room is configured for the course.");
  if (input.blockedTeachingDays > 0) {
    reasons.push(`${input.blockedTeachingDays} teaching day(s) are blocked by planning exceptions.`);
  }
  if (status === "RED") {
    reasons.push(`Estimated capacity is ${Math.abs(marginMinutes)} minute(s) below the requirement.`);
  } else if (status === "AMBER") {
    reasons.push("The requirement is feasible, but the remaining capacity margin is below 20%.");
  }

  return {
    requirementId: input.requirementId,
    groupCode: input.groupCode,
    groupName: input.groupName,
    courseCode: input.courseCode,
    courseName: input.courseName,
    status,
    requiredMinutes,
    estimatedCapacityMinutes,
    marginMinutes,
    marginPercent,
    blockedTeachingDays: input.blockedTeachingDays,
    qualifiedInstructorCount: input.qualifiedInstructorCount,
    eligibleRoomCount: input.eligibleRoomCount,
    reasons,
    recoveryOptions: recoveryOptions(input, requiredMinutes, estimatedCapacityMinutes),
  };
}

export function summarizeFeasibility(
  requirements: RequirementFeasibilityResult[],
): FeasibilitySummary {
  const counts: Record<FeasibilityStatus, number> = { GREEN: 0, AMBER: 0, RED: 0 };
  for (const requirement of requirements) counts[requirement.status] += 1;

  const status: FeasibilityStatus = counts.RED > 0 ? "RED" : counts.AMBER > 0 ? "AMBER" : "GREEN";
  return { status, requirements, counts };
}
