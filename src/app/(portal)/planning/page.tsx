import Link from "next/link";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  GitCompareArrows,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { PlanningReviewPanel } from "@/components/planning/planning-review-panel";
import { ScenarioComparison } from "@/components/planning/scenario-comparison";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import {
  getPlanFeasibility,
  jsonNumber,
  jsonRecord,
} from "@/lib/planning/workspace-data";
import { updateScenarioDecision } from "@/lib/planning/workspace-actions";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<{
    scenario?: string;
  }>;
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function dateLabel(value: Date | null) {
  return value ? dateFormatter.format(value) : "—";
}

function toneForStatus(status: string) {
  if (
    status === "APPROVED" ||
    status === "ACCEPTED" ||
    status === "GENERATED"
  ) {
    return "success" as const;
  }

  if (
    status === "FAILED" ||
    status === "REJECTED"
  ) {
    return "danger" as const;
  }

  if (
    status === "SUBMITTED" ||
    status === "IN_REVIEW" ||
    status === "PENDING" ||
    status === "READY"
  ) {
    return "warning" as const;
  }

  return "neutral" as const;
}

function feasibilityTone(status: string) {
  if (status === "GREEN") return "success" as const;
  if (status === "AMBER") return "warning" as const;
  return "danger" as const;
}

function generationType(value: unknown) {
  const record = jsonRecord(value);
  const type = record?.type;

  return typeof type === "string" ? type : null;
}

export default async function PlanningPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  const tenant = await prisma.tenant.findUnique({
    where: {
      code: "DEMO",
    },
  });

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader
          title="Planning"
          description="No tenant is available."
        />
      </div>
    );
  }

  const plan = await prisma.plan.findFirst({
    where: {
      tenantId: tenant.id,
      status: {
        not: "ARCHIVED",
      },
    },
    orderBy: [
      { version: "desc" },
      { createdAt: "desc" },
    ],
    include: {
      planningScope: true,
      academicPeriod: true,
      reviewWorkflows: {
        include: {
          steps: {
            include: {
              decisions: {
                orderBy: {
                  decidedAt: "desc",
                },
                take: 1,
              },
            },
            orderBy: [
              { stage: "asc" },
              { position: "asc" },
            ],
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!plan) {
    return (
      <div className="page-container">
        <PageHeader
          title="Planning"
          description={`${tenant.name} · planning workspace`}
        />

        <EmptyState
          icon={<CalendarClock size={20} />}
          title="No plan available"
          description="Create a plan before working with scenarios and review."
        />
      </div>
    );
  }

  const [scenarios, feasibility] = await Promise.all([
    prisma.planScenario.findMany({
      where: {
        tenantId: tenant.id,
        planId: plan.id,
      },
      include: {
        metrics: true,
        changes: true,
        sessions: {
          select: {
            id: true,
          },
        },
        solverJobs: {
          include: {
            runs: {
              orderBy: {
                startedAt: "desc",
              },
              take: 1,
            },
          },
          orderBy: {
            queuedAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    getPlanFeasibility(tenant.id, plan),
  ]);

  const selectedScenarioId =
    params.scenario ??
    scenarios.find(
      (scenario) =>
        generationType(scenario.generationConfig) ===
        "RESOURCE_RECOVERY",
    )?.id ??
    scenarios[0]?.id;

  const selectedScenario = selectedScenarioId
    ? await prisma.planScenario.findFirst({
        where: {
          id: selectedScenarioId,
          tenantId: tenant.id,
          planId: plan.id,
        },
        include: {
          metrics: true,
          changes: {
            include: {
              scenarioSession: {
                include: {
                  teachingGroup: true,
                  room: true,
                  instructors: {
                    include: {
                      instructor: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          sessions: {
            select: {
              id: true,
            },
          },
          solverJobs: {
            include: {
              runs: {
                include: {
                  violations: true,
                },
                orderBy: {
                  startedAt: "desc",
                },
                take: 1,
              },
            },
            orderBy: {
              queuedAt: "desc",
            },
            take: 1,
          },
        },
      })
    : null;

  const workflow = plan.reviewWorkflows[0] ?? null;

  const directChanges =
    selectedScenario?.changes.filter(
      (change) =>
        change.explanationCode ===
        "RESOURCE_RECOVERY_DIRECT",
    ).length ?? 0;

  const cascadingChanges =
    selectedScenario?.changes.filter(
      (change) =>
        change.explanationCode ===
        "RESOURCE_RECOVERY_CASCADE",
    ).length ?? 0;

  const latestRun =
    selectedScenario?.solverJobs[0]?.runs[0] ?? null;

  const blockingViolations =
    latestRun?.violations.filter(
      (violation) => violation.severity === "BLOCKING",
    ).length ?? 0;

  const changedSessionMetric =
    selectedScenario?.metrics.find(
      (metric) =>
        metric.metricType === "SESSION_CHANGE_COUNT",
    )?.value ??
    selectedScenario?.changes.length ??
    0;

  const canDecideScenario =
  selectedScenario?.status === "GENERATED";

  return (
    <div className="page-container">
      <PageHeader
        title="Planning"
        description={`${tenant.name} · ${plan.name} v${plan.version}`}
        actions={
          <div className="planning-header-actions">
            <Badge tone={toneForStatus(plan.status)}>
              {plan.status}
            </Badge>

            <Link href="/schedule?view=week">
              <Button type="button" variant="secondary">
                Open schedule
              </Button>
            </Link>
          </div>
        }
      />

      <div className="planning-stats">
        <StatCard
          label="Plan"
          value={`v${plan.version}`}
          detail={`${plan.planningScope.name} · ${plan.academicPeriod.name}`}
          icon={<CalendarClock size={17} />}
          tone="info"
        />

        <StatCard
          label="Feasibility"
          value={feasibility?.status ?? "—"}
          detail={
            feasibility
              ? `${feasibility.counts.GREEN} green · ${feasibility.counts.AMBER} amber · ${feasibility.counts.RED} red`
              : "Planning horizon is incomplete"
          }
          icon={
            feasibility?.status === "GREEN" ? (
              <CheckCircle2 size={17} />
            ) : (
              <TriangleAlert size={17} />
            )
          }
          tone={
            feasibility
              ? feasibilityTone(feasibility.status)
              : "neutral"
          }
        />

        <StatCard
          label="Scenarios"
          value={scenarios.length}
          detail={`${scenarios.filter((scenario) => scenario.status === "GENERATED").length} generated proposals`}
          icon={<Sparkles size={17} />}
          tone="info"
        />

        <StatCard
          label="Review"
          value={workflow?.status ?? "—"}
          detail={
            workflow
              ? `${workflow.steps.filter((step) => step.status === "APPROVED").length}/${workflow.steps.length} steps approved`
              : "No workflow configured"
          }
          icon={<ShieldCheck size={17} />}
          tone={toneForStatus(workflow?.status ?? "")}
        />
      </div>

      <div className="planning-primary-grid">
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Current plan</span>
              <h2>{plan.name}</h2>
            </div>

            <Badge tone={toneForStatus(plan.status)}>
              {plan.status}
            </Badge>
          </CardHeader>

          <CardContent>
            <dl className="planning-plan-grid">
              <div>
                <dt>As-of date</dt>
                <dd>{dateLabel(plan.planningAsOfDate)}</dd>
              </div>
              <div>
                <dt>Frozen through</dt>
                <dd>{dateLabel(plan.frozenThroughDate)}</dd>
              </div>
              <div>
                <dt>Editable from</dt>
                <dd>{dateLabel(plan.planningStartDate)}</dd>
              </div>
              <div>
                <dt>Planning end</dt>
                <dd>{dateLabel(plan.planningEndDate)}</dd>
              </div>
              <div>
                <dt>Effective from</dt>
                <dd>{dateLabel(plan.effectiveFrom)}</dd>
              </div>
              <div>
                <dt>Effective to</dt>
                <dd>{dateLabel(plan.effectiveTo)}</dd>
              </div>
            </dl>

            <div className="planning-principle-note">
              <ShieldCheck size={16} />
              <div>
                <strong>Controlled revision principle</strong>
                <span>
                  Dates before the frozen boundary remain untouched.
                  Generated recovery scenarios are proposals and do not
                  overwrite the current plan.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Feasibility</span>
              <h2>Requirement capacity</h2>
            </div>

            {feasibility ? (
              <Badge tone={feasibilityTone(feasibility.status)}>
                {feasibility.status}
              </Badge>
            ) : null}
          </CardHeader>

          <CardContent className="planning-feasibility-list">
            {!feasibility ? (
              <p className="planning-muted">
                Planning start/end dates are required before
                feasibility can be calculated.
              </p>
            ) : feasibility.requirements.length === 0 ? (
              <p className="planning-muted">
                No active teaching requirements were found.
              </p>
            ) : (
              feasibility.requirements.map((requirement) => (
                <div
                  key={requirement.requirementId}
                  className="planning-feasibility-row"
                >
                  <div className="planning-feasibility-heading">
                    <div>
                      <strong>
                        {requirement.groupCode} ·{" "}
                        {requirement.courseCode ??
                          requirement.courseName}
                      </strong>
                      <span>{requirement.courseName}</span>
                    </div>

                    <Badge
                      tone={feasibilityTone(
                        requirement.status,
                      )}
                    >
                      {requirement.status}
                    </Badge>
                  </div>

                  <div className="planning-feasibility-metrics">
                    <span>
                      Required{" "}
                      <strong>
                        {requirement.requiredMinutes} min
                      </strong>
                    </span>
                    <span>
                      Capacity{" "}
                      <strong>
                        {requirement.estimatedCapacityMinutes} min
                      </strong>
                    </span>
                    <span>
                      Margin{" "}
                      <strong>
                        {requirement.marginMinutes >= 0
                          ? "+"
                          : ""}
                        {requirement.marginMinutes} min
                      </strong>
                    </span>
                  </div>

                  {requirement.reasons.length > 0 ? (
                    <p>{requirement.reasons[0]}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="planning-scenario-workspace">
        <Card className="planning-scenario-list-card">
          <CardHeader>
            <div>
              <span className="eyebrow">Scenarios</span>
              <h2>Alternatives & recovery</h2>
            </div>

            <Badge tone="neutral">
              {scenarios.length}
            </Badge>
          </CardHeader>

          <CardContent className="planning-scenario-list">
            {scenarios.length === 0 ? (
              <p className="planning-muted">
                No scenarios have been created.
              </p>
            ) : (
              scenarios.map((scenario) => {
                const direct = scenario.changes.filter(
                  (change) =>
                    change.explanationCode ===
                    "RESOURCE_RECOVERY_DIRECT",
                ).length;
                const cascading = scenario.changes.filter(
                  (change) =>
                    change.explanationCode ===
                    "RESOURCE_RECOVERY_CASCADE",
                ).length;
                const type =
                  generationType(
                    scenario.generationConfig,
                  ) ?? "BASE";

                return (
                  <Link
                    key={scenario.id}
                    href={`/planning?scenario=${scenario.id}`}
                    className="planning-scenario-row"
                    data-selected={
                      selectedScenario?.id === scenario.id
                    }
                  >
                    <div>
                      <strong>{scenario.name}</strong>
                      <span>
                        {type} · {scenario.sessions.length} sessions
                      </span>
                      <small>
                        {scenario.changes.length} changes
                        {direct || cascading
                          ? ` · ${direct} direct · ${cascading} cascading`
                          : ""}
                      </small>
                    </div>

                    <Badge tone={toneForStatus(scenario.status)}>
                      {scenario.status}
                    </Badge>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="planning-scenario-detail">
          {selectedScenario ? (
            <>
              <Card>
                <CardHeader>
                  <div>
                    <span className="eyebrow">
                      Scenario detail
                    </span>
                    <h2>{selectedScenario.name}</h2>
                  </div>

                  <div className="planning-header-actions">
                    <Badge
                      tone={toneForStatus(
                        selectedScenario.status,
                      )}
                    >
                      {selectedScenario.status}
                    </Badge>

                    {generationType(
                      selectedScenario.generationConfig,
                    ) === "RESOURCE_RECOVERY" ? (
                      <Badge tone="info">
                        Recovery
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="planning-scenario-metrics">
                    <div>
                      <span>Sessions</span>
                      <strong>
                        {selectedScenario.sessions.length}
                      </strong>
                    </div>
                    <div>
                      <span>Changed</span>
                      <strong>
                        {changedSessionMetric}
                      </strong>
                    </div>
                    <div>
                      <span>Direct</span>
                      <strong>{directChanges}</strong>
                    </div>
                    <div>
                      <span>Cascading</span>
                      <strong>{cascadingChanges}</strong>
                    </div>
                    <div>
                      <span>Solver</span>
                      <strong>
                        {latestRun?.status ??
                          (jsonRecord(
                            selectedScenario.objectiveSummary,
                          )?.solverStatus as string | undefined) ??
                          "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Blocking</span>
                      <strong>{blockingViolations}</strong>
                    </div>
                  </div>

                  {selectedScenario.solverScore !== null ? (
                    <p className="planning-muted">
                      Solver score:{" "}
                      {selectedScenario.solverScore}
                    </p>
                  ) : null}

                  {canDecideScenario ? (
                    <div className="planning-scenario-actions">
                      <div>
                        <Activity size={16} />
                        <span>
                          Accepting a scenario records the decision
                          only. The current plan is not overwritten.
                        </span>
                      </div>

                      <div>
                        <form action={updateScenarioDecision}>
                          <input
                            type="hidden"
                            name="scenarioId"
                            value={selectedScenario.id}
                          />
                          <input
                            type="hidden"
                            name="decision"
                            value="ACCEPT"
                          />
                          <Button
                            type="submit"
                            variant="primary"
                          >
                            Accept proposal
                          </Button>
                        </form>

                        <form action={updateScenarioDecision}>
                          <input
                            type="hidden"
                            name="scenarioId"
                            value={selectedScenario.id}
                          />
                          <input
                            type="hidden"
                            name="decision"
                            value="REJECT"
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                          >
                            Reject proposal
                          </Button>
                        </form>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <ScenarioComparison
                changes={selectedScenario.changes}
              />
            </>
          ) : (
            <Card>
              <EmptyState
                icon={<GitCompareArrows size={20} />}
                title="Select a scenario"
                description="Select a generated alternative to inspect solver outcome and changes."
              />
            </Card>
          )}
        </div>
      </div>

      <PlanningReviewPanel
        planId={plan.id}
        planStatus={plan.status}
        workflow={workflow}
      />
    </div>
  );
}
