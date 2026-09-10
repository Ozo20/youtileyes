import {
  analyzeRequirementFeasibility,
  type FeasibilityRequirementInput,
  type FeasibilityStatus,
  type RequirementFeasibilityResult,
} from "./feasibility";

export type RecoveryActionCode =
  | "RESTORE_BLOCKED_DAY"
  | "INCREASE_WEEKLY_CAPACITY"
  | "ADD_QUALIFIED_INSTRUCTOR"
  | "ADD_ELIGIBLE_ROOM"
  | "EXTEND_HORIZON_ONE_WEEK"
  | "CARRY_OVER_SHORTFALL";

export type RecoverySimulation = {
  code: RecoveryActionCode;
  title: string;
  description: string;
  requiresApproval: boolean;
  disruptionScore: number;
  baselineStatus: FeasibilityStatus;
  resultingStatus: FeasibilityStatus;
  baselineMarginMinutes: number;
  resultingMarginMinutes: number;
  recoveredMinutes: number;
  deferredMinutes: number;
  closesShortfall: boolean;
  simulatedInput: FeasibilityRequirementInput;
};

function cloneInput(input: FeasibilityRequirementInput): FeasibilityRequirementInput {
  return {
    ...input,
    weeks: input.weeks.map((week) => ({ ...week })),
  };
}

function typicalWeek(input: FeasibilityRequirementInput) {
  const usable = input.weeks.filter((week) => week.availableTeachingDays > 0);
  const source = usable.at(-1) ?? input.weeks.at(-1);
  if (!source) return null;
  return { ...source, targetMinutes: 0 };
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function simulate(
  baseline: RequirementFeasibilityResult,
  code: RecoveryActionCode,
  title: string,
  description: string,
  requiresApproval: boolean,
  disruptionScore: number,
  input: FeasibilityRequirementInput,
  deferredMinutes = 0,
): RecoverySimulation {
  const result = analyzeRequirementFeasibility(input);
  const recoveredMinutes = result.marginMinutes - baseline.marginMinutes + deferredMinutes;

  return {
    code,
    title,
    description,
    requiresApproval,
    disruptionScore,
    baselineStatus: baseline.status,
    resultingStatus: result.status,
    baselineMarginMinutes: baseline.marginMinutes,
    resultingMarginMinutes: result.marginMinutes,
    recoveredMinutes: Math.max(recoveredMinutes, 0),
    deferredMinutes,
    closesShortfall: result.status !== "RED",
    simulatedInput: input,
  };
}

export function simulateRequirementRecovery(
  source: FeasibilityRequirementInput,
): RecoverySimulation[] {
  const baseline = analyzeRequirementFeasibility(source);
  if (baseline.status !== "RED") return [];

  const shortfall = Math.max(-baseline.marginMinutes, 0);
  const simulations: RecoverySimulation[] = [];

  if (source.qualifiedInstructorCount === 0) {
    const input = cloneInput(source);
    input.qualifiedInstructorCount = 1;
    simulations.push(
      simulate(
        baseline,
        "ADD_QUALIFIED_INSTRUCTOR",
        "Use an additional qualified instructor",
        "Simulates making one qualified instructor available for this requirement.",
        true,
        35,
        input,
      ),
    );
  }

  if (source.eligibleRoomCount === 0) {
    const input = cloneInput(source);
    input.eligibleRoomCount = 1;
    simulations.push(
      simulate(
        baseline,
        "ADD_ELIGIBLE_ROOM",
        "Make an eligible room available",
        "Simulates adding one room that is permitted for the course.",
        true,
        30,
        input,
      ),
    );
  }

  if (source.blockedTeachingDays > 0) {
    const input = cloneInput(source);
    const candidate = input.weeks
      .filter((week) => week.availableTeachingDays < 5)
      .sort((a, b) => a.availableTeachingDays - b.availableTeachingDays)[0];
    if (candidate) {
      candidate.availableTeachingDays += 1;
      input.blockedTeachingDays = Math.max(input.blockedTeachingDays - 1, 0);
      simulations.push(
        simulate(
          baseline,
          "RESTORE_BLOCKED_DAY",
          "Restore one blocked teaching day",
          "Simulates releasing one activity/exception day back to ordinary teaching.",
          true,
          70,
          input,
        ),
      );
    }
  }

  const cappedWeeks = source.weeks.filter((week) => week.maxWeeklyMinutes !== null);
  if (cappedWeeks.length > 0) {
    const input = cloneInput(source);
    const active = input.weeks.filter(
      (week) => week.availableTeachingDays > 0 && week.maxWeeklyMinutes !== null,
    );
    if (active.length > 0) {
      const increment = Math.ceil(shortfall / active.length);
      for (const week of active) {
        week.maxWeeklyMinutes = Math.max(week.maxWeeklyMinutes ?? 0, 0) + increment;
      }
      simulations.push(
        simulate(
          baseline,
          "INCREASE_WEEKLY_CAPACITY",
          "Increase weekly teaching capacity",
          `Simulates adding approximately ${increment} minute(s) of capacity to each available capped week.`,
          true,
          45,
          input,
        ),
      );
    }
  }

  const template = typicalWeek(source);
  if (template && source.weeks.length > 0) {
    const input = cloneInput(source);
    const lastWeek = input.weeks.at(-1)!;
    input.weeks.push({
      ...template,
      weekStartDate: addDays(lastWeek.weekStartDate, 7),
      targetMinutes: shortfall,
    });
    simulations.push(
      simulate(
        baseline,
        "EXTEND_HORIZON_ONE_WEEK",
        "Extend the planning horizon by one week",
        "Simulates adding one further teaching week and moving the current shortfall into that week.",
        true,
        80,
        input,
      ),
    );
  }

  if (source.carryoverAllowed && shortfall > 0) {
    const input = cloneInput(source);
    let remaining = shortfall;
    for (let index = input.weeks.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const week = input.weeks[index];
      const reduction = Math.min(week.targetMinutes, remaining);
      week.targetMinutes -= reduction;
      remaining -= reduction;
    }
    simulations.push(
      simulate(
        baseline,
        "CARRY_OVER_SHORTFALL",
        "Defer the shortfall to the next academic period",
        `Simulates deferring ${shortfall} minute(s) beyond the current target period.`,
        true,
        100,
        input,
        shortfall,
      ),
    );
  }

  return simulations.sort((a, b) => {
    if (a.closesShortfall !== b.closesShortfall) return a.closesShortfall ? -1 : 1;
    if (a.disruptionScore !== b.disruptionScore) return a.disruptionScore - b.disruptionScore;
    return b.resultingMarginMinutes - a.resultingMarginMinutes;
  });
}
