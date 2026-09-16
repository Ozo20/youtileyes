import {
  CheckCircle2,
  CircleDashed,
  ChevronDown,
  Play,
  TriangleAlert,
} from "lucide-react";

import { BasePlanGenerationStatus } from "@/components/planning/base-plan-generation-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { generateBasePlanScenario } from "@/lib/planning/base-plan-solver-actions";
import type {
  PlanningAnalysisCheck,
  PlanningAnalysisPhase,
  PlanningAnalysisResult,
} from "@/lib/planning/planning-analysis";

type GenerationJob =
  Parameters<typeof BasePlanGenerationStatus>[0]["job"];

type AdvisoryGroup = {
  id: string;
  title: string;
  summary: string;
  checks: PlanningAnalysisCheck[];
};

const PHASE_LABELS: Record<PlanningAnalysisPhase, string> = {
  DATA_READINESS: "Data readiness",
  AGGREGATE_CAPACITY: "Aggregate capacity",
  RESOURCE_CAPACITY: "Resource capacity",
  DOMAIN_VALIDATION: "Domain validation",
  OPTIMIZATION: "Optimization",
};

const PHASE_DESCRIPTIONS: Record<
  PlanningAnalysisPhase,
  string
> = {
  DATA_READINESS:
    "Calendar, Base Plan allocations and required planning data.",
  AGGREGATE_CAPACITY:
    "Teaching load, sessions, rooms and total instructor capacity.",
  RESOURCE_CAPACITY:
    "Qualified instructor capacity for hard staffing requirements.",
  DOMAIN_VALIDATION:
    "Candidate rooms and instructors available to each teaching group.",
  OPTIMIZATION:
    "Detailed timetable generation and constraint optimization.",
};

function tone(
  status:
    | "PASS"
    | "WARNING"
    | "BLOCKING"
    | "NOT_RUN",
) {
  if (status === "PASS") return "success" as const;
  if (status === "WARNING") return "warning" as const;
  if (status === "BLOCKING") return "danger" as const;
  return "neutral" as const;
}

function overallTone(
  analysis: PlanningAnalysisResult,
) {
  return analysis.canRunSolver
    ? ("success" as const)
    : ("danger" as const);
}

function overallLabel(
  analysis: PlanningAnalysisResult,
) {
  if (!analysis.canRunSolver) {
    return "ACTION REQUIRED";
  }

  if (analysis.counts.warning > 0) {
    return "READY · ADVISORIES";
  }

  return "READY";
}

function phaseLabel(
  phase: PlanningAnalysisResult["phases"][number],
  canRunSolver: boolean,
) {
  if (
    phase.phase === "OPTIMIZATION" &&
    phase.status === "NOT_RUN" &&
    canRunSolver
  ) {
    return "READY TO RUN";
  }

  if (phase.status === "BLOCKING") {
    return "BLOCKED";
  }

  if (phase.status === "WARNING") {
    const advisoryCount = phase.checks.filter(
      (check) => check.severity === "WARNING",
    ).length;

    return advisoryCount > 0
      ? `FEASIBLE · ${advisoryCount} ${
          advisoryCount === 1
            ? "ADVISORY"
            : "ADVISORIES"
        }`
      : "FEASIBLE";
  }

  if (phase.status === "PASS") {
    return "FEASIBLE";
  }

  return "WAITING";
}

function phaseTone(
  phase: PlanningAnalysisResult["phases"][number],
  canRunSolver: boolean,
) {
  if (phase.status === "BLOCKING") {
    return "danger" as const;
  }

  if (
    phase.phase === "OPTIMIZATION" &&
    phase.status === "NOT_RUN" &&
    canRunSolver
  ) {
    return "success" as const;
  }

  if (
    phase.status === "PASS" ||
    phase.status === "WARNING"
  ) {
    return "success" as const;
  }

  return "neutral" as const;
}

function formatValue(
  value: number | null,
  unit: PlanningAnalysisCheck["unit"],
) {
  if (value === null) return "—";

  const formatted =
    value.toLocaleString("en-GB");

  if (unit === "MINUTES") {
    return `${formatted} min`;
  }

  if (unit === "SESSIONS") {
    return `${formatted} session${
      value === 1 ? "" : "s"
    }`;
  }

  return formatted;
}

function uniqueScopeCount(
  checks: PlanningAnalysisCheck[],
) {
  return new Set(
    checks
      .map((check) => check.scopeLabel)
      .filter(Boolean),
  ).size;
}

function groupAdvisories(
  warnings: PlanningAnalysisCheck[],
): AdvisoryGroup[] {
  const groups: AdvisoryGroup[] = [];

  const roomChecks = warnings.filter(
    (check) =>
      check.title === "Room candidate domain",
  );

  const cohortChecks = warnings.filter(
    (check) =>
      check.title ===
        "Cohort teaching capacity" ||
      check.title ===
        "Cohort session capacity",
  );

  const groupedIds = new Set([
    ...roomChecks.map((check) => check.id),
    ...cohortChecks.map((check) => check.id),
  ]);

  if (cohortChecks.length > 0) {
    const count =
      uniqueScopeCount(cohortChecks);

    groups.push({
      id: "high-weekly-utilisation",
      title: "High weekly utilisation",
      summary:
        `${count} cohort${
          count === 1 ? "" : "s"
        } use a high share of available weekly teaching capacity. ` +
        "The plan remains feasible, but there is less flexibility for additional changes.",
      checks: cohortChecks,
    });
  }

  if (roomChecks.length > 0) {
    const count =
      uniqueScopeCount(roomChecks);

    groups.push({
      id: "limited-room-flexibility",
      title: "Limited room flexibility",
      summary:
        `${count} teaching group${
          count === 1 ? " has" : "s have"
        } only a small number of suitable room alternatives. ` +
        "Timetable generation can proceed, but room conflicts may be harder to resolve.",
      checks: roomChecks,
    });
  }

  const remaining = warnings.filter(
    (check) => !groupedIds.has(check.id),
  );

  const byTitle = new Map<
    string,
    PlanningAnalysisCheck[]
  >();

  for (const check of remaining) {
    const existing =
      byTitle.get(check.title) ?? [];
    existing.push(check);
    byTitle.set(check.title, existing);
  }

  for (const [title, checks] of byTitle) {
    groups.push({
      id: `advisory:${title}`,
      title,
      summary:
        checks.length === 1
          ? checks[0].message
          : `${checks.length} related advisory findings were identified.`,
      checks,
    });
  }

  return groups;
}

function BlockingFinding({
  check,
}: {
  check: PlanningAnalysisCheck;
}) {
  return (
    <div className="planning-analysis-finding">
      <div className="planning-analysis-finding-main">
        <div>
          <strong>{check.title}</strong>
          <span>
            {[
              check.scopeLabel,
              check.weekStartDate,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>

        <Badge tone="danger">
          BLOCKING
        </Badge>
      </div>

      <p>{check.message}</p>

      {check.required !== null ||
      check.available !== null ? (
        <div className="planning-analysis-metrics">
          {check.required !== null ? (
            <span>
              Required{" "}
              <strong>
                {formatValue(
                  check.required,
                  check.unit,
                )}
              </strong>
            </span>
          ) : null}

          {check.available !== null ? (
            <span>
              Available{" "}
              <strong>
                {formatValue(
                  check.available,
                  check.unit,
                )}
              </strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {check.suggestedAction ? (
        <div className="planning-analysis-action">
          <strong>Recommended action</strong>
          <span>
            {check.suggestedAction}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function AdvisoryDetail({
  check,
}: {
  check: PlanningAnalysisCheck;
}) {
  return (
    <div className="planning-analysis-advisory-detail">
      <div>
        <strong>
          {check.scopeLabel ?? check.title}
        </strong>

        {check.weekStartDate ? (
          <span>{check.weekStartDate}</span>
        ) : null}
      </div>

      <p>{check.message}</p>
    </div>
  );
}

export function PlanningAnalysisPanel({
  analysis,
  planId,
  generationActive,
  job,
}: {
  analysis: PlanningAnalysisResult;
  planId: string;
  generationActive: boolean;
  job: GenerationJob | null;
}) {
  const blocking = analysis.checks.filter(
    (check) =>
      check.severity === "BLOCKING",
  );

  const warnings = analysis.checks.filter(
    (check) =>
      check.severity === "WARNING",
  );

  const passed = analysis.checks.filter(
    (check) => check.severity === "PASS",
  );

  const advisoryGroups =
    groupAdvisories(warnings);

  return (
    <Card
      id="planning-analysis"
      className="planning-analysis-card"
    >
      <CardHeader>
        <div>
          <span className="eyebrow">
            Planning analysis
          </span>
          <h2>
            Ready the plan for timetable generation
          </h2>
        </div>

        <Badge tone={overallTone(analysis)}>
          {overallLabel(analysis)}
        </Badge>
      </CardHeader>

      <CardContent className="planning-analysis-content">
        <div className="planning-analysis-summary">
          <div>
            <strong>
              {analysis.canRunSolver
                ? "Ready for timetable generation"
                : `${analysis.counts.blocking} blocking issue${
                    analysis.counts.blocking ===
                    1
                      ? ""
                      : "s"
                  } must be resolved`}
            </strong>

            <span>
              {analysis.canRunSolver
                ? advisoryGroups.length > 0
                  ? `${advisoryGroups.length} advisory area${
                      advisoryGroups.length ===
                      1
                        ? ""
                        : "s"
                    } identified · timetable generation can proceed`
                  : "All preflight checks completed without blocking findings"
                : "Review the blocking findings below before continuing"}
            </span>
          </div>

          {analysis.canRunSolver ? (
            <CheckCircle2 size={20} />
          ) : (
            <TriangleAlert size={20} />
          )}
        </div>

        <div className="planning-analysis-phases">
          {analysis.phases.map(
            (phase, index) => (
              <div
                key={phase.phase}
                className="planning-analysis-phase"
              >
                <div className="planning-analysis-phase-index">
                  {phase.status === "PASS" ||
                  phase.status === "WARNING" ? (
                    <CheckCircle2 size={16} />
                  ) : phase.status ===
                    "BLOCKING" ? (
                    <TriangleAlert size={16} />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>

                <div className="planning-analysis-phase-copy">
                  <strong>
                    {
                      PHASE_LABELS[
                        phase.phase
                      ]
                    }
                  </strong>

                  <span>
                    {
                      PHASE_DESCRIPTIONS[
                        phase.phase
                      ]
                    }
                  </span>
                </div>

                <Badge
                  tone={phaseTone(
                    phase,
                    analysis.canRunSolver,
                  )}
                >
                  {phaseLabel(
                    phase,
                    analysis.canRunSolver,
                  )}
                </Badge>
              </div>
            ),
          )}
        </div>

        {blocking.length > 0 ? (
          <section className="planning-analysis-section">
            <div className="planning-analysis-section-heading">
              <div>
                <TriangleAlert size={16} />
                <strong>
                  Action required
                </strong>
              </div>

              <span>{blocking.length}</span>
            </div>

            <div className="planning-analysis-findings">
              {blocking.map((check) => (
                <BlockingFinding
                  key={check.id}
                  check={check}
                />
              ))}
            </div>
          </section>
        ) : null}

        {advisoryGroups.length > 0 ? (
          <details className="planning-analysis-advisories">
            <summary>
              <div>
                <TriangleAlert size={15} />

                <div>
                  <strong>
                    Advisories
                  </strong>

                  <span>
                    {advisoryGroups.length} area
                    {advisoryGroups.length ===
                    1
                      ? ""
                      : "s"}{" "}
                    worth reviewing, but none
                    block timetable generation
                  </span>
                </div>
              </div>

              <ChevronDown size={15} />
            </summary>

            <div className="planning-analysis-advisory-groups">
              {advisoryGroups.map(
                (group) => (
                  <details
                    key={group.id}
                    className="planning-analysis-advisory-group"
                  >
                    <summary>
                      <div>
                        <strong>
                          {group.title}
                        </strong>

                        <span>
                          {group.summary}
                        </span>
                      </div>

                      <span className="planning-analysis-advisory-count">
                        {group.checks.length}
                      </span>
                    </summary>

                    <div className="planning-analysis-advisory-details">
                      {group.checks.map(
                        (check) => (
                          <AdvisoryDetail
                            key={check.id}
                            check={check}
                          />
                        ),
                      )}
                    </div>
                  </details>
                ),
              )}
            </div>
          </details>
        ) : null}

        {passed.length > 0 ? (
          <details className="planning-analysis-passed">
            <summary>
              <CheckCircle2 size={14} />
              {passed.length} checks passed
            </summary>

            <div className="planning-analysis-passed-list">
              {passed.map((check) => (
                <div key={check.id}>
                  <CheckCircle2 size={13} />
                  <span>
                    {check.title}
                    {check.scopeLabel
                      ? ` · ${check.scopeLabel}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <div className="planning-analysis-run">
          <div>
            {analysis.canRunSolver ? (
              <CheckCircle2 size={18} />
            ) : (
              <CircleDashed size={18} />
            )}

            <div>
              <strong>
                {analysis.canRunSolver
                  ? "Timetable generation is available"
                  : "Timetable generation is blocked"}
              </strong>

              <span>
                {analysis.canRunSolver
                  ? advisoryGroups.length > 0
                    ? "The advisories above do not prevent generation. The optimizer will resolve the detailed timetable."
                    : "The preflight checks passed. The detailed optimizer can now be started."
                  : "Resolve the blocking findings above and recalculate the Base Plan before starting the optimizer."}
              </span>
            </div>
          </div>

          <form action={generateBasePlanScenario}>
            <input
              type="hidden"
              name="planId"
              value={planId}
            />

            <Button
              type="submit"
              variant="primary"
              disabled={
                !analysis.canRunSolver ||
                generationActive
              }
            >
              <Play size={15} />
              {generationActive
                ? "Generating timetable"
                : "Generate timetable proposal"}
            </Button>
          </form>
        </div>

        <BasePlanGenerationStatus job={job} />
      </CardContent>
    </Card>
  );
}
