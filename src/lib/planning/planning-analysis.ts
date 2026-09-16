export type PlanningAnalysisSeverity =
  | "PASS"
  | "WARNING"
  | "BLOCKING";

export type PlanningAnalysisPhase =
  | "DATA_READINESS"
  | "AGGREGATE_CAPACITY"
  | "RESOURCE_CAPACITY"
  | "DOMAIN_VALIDATION"
  | "OPTIMIZATION";

export type PlanningAnalysisCheck = {
  id: string;
  phase: PlanningAnalysisPhase;
  severity: PlanningAnalysisSeverity;
  title: string;
  scopeLabel: string | null;
  weekStartDate: string | null;
  required: number | null;
  available: number | null;
  unit: "MINUTES" | "SESSIONS" | "COUNT" | null;
  message: string;
  suggestedAction: string | null;
};

export type PlanningAnalysisPhaseResult = {
  phase: PlanningAnalysisPhase;
  status:
    | PlanningAnalysisSeverity
    | "NOT_RUN";
  checks: PlanningAnalysisCheck[];
};

export type PlanningAnalysisResult = {
  status: "READY" | "WARNING" | "BLOCKED";
  canRunSolver: boolean;
  checks: PlanningAnalysisCheck[];
  phases: PlanningAnalysisPhaseResult[];
  counts: {
    blocking: number;
    warning: number;
    passed: number;
  };
};

const PHASES: PlanningAnalysisPhase[] = [
  "DATA_READINESS",
  "AGGREGATE_CAPACITY",
  "RESOURCE_CAPACITY",
  "DOMAIN_VALIDATION",
  "OPTIMIZATION",
];

export function summarizePlanningAnalysis(
  checks: PlanningAnalysisCheck[],
): PlanningAnalysisResult {
  const blocking = checks.filter(
    (check) => check.severity === "BLOCKING",
  ).length;

  const warning = checks.filter(
    (check) => check.severity === "WARNING",
  ).length;

  const passed = checks.filter(
    (check) => check.severity === "PASS",
  ).length;

  const implementedPhases = new Set<PlanningAnalysisPhase>(
    checks.map((check) => check.phase),
  );

  const phases = PHASES.map((phase) => {
    const phaseChecks = checks.filter(
      (check) => check.phase === phase,
    );

    if (!implementedPhases.has(phase)) {
      return {
        phase,
        status: "NOT_RUN" as const,
        checks: [],
      };
    }

    const status: PlanningAnalysisSeverity =
      phaseChecks.some(
        (check) => check.severity === "BLOCKING",
      )
        ? "BLOCKING"
        : phaseChecks.some(
              (check) => check.severity === "WARNING",
            )
          ? "WARNING"
          : "PASS";

    return {
      phase,
      status,
      checks: phaseChecks,
    };
  });

  return {
    status:
      blocking > 0
        ? "BLOCKED"
        : warning > 0
          ? "WARNING"
          : "READY",
    canRunSolver: blocking === 0,
    checks,
    phases,
    counts: {
      blocking,
      warning,
      passed,
    },
  };
}
