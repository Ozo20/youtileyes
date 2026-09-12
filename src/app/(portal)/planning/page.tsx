import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  GitCompareArrows,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { BasePlanGenerationStatus } from "@/components/planning/base-plan-generation-status";
import { PlanningReviewPanel } from "@/components/planning/planning-review-panel";
import { RecoveryApprovalPanel } from "@/components/planning/recovery-approval-panel";
import { RecoveryPublishPanel } from "@/components/planning/recovery-publish-panel";
import { PublishedRevisionPanel } from "@/components/planning/published-revision-panel";
import { PlanRevisionTimeline } from "@/components/planning/plan-revision-timeline";
import { RecoveryWorkflowStepper } from "@/components/planning/recovery-workflow-stepper";
import { ScenarioComparison } from "@/components/planning/scenario-comparison";
import { ScenarioReviewPanel } from "@/components/planning/scenario-review-panel";
import { SolverJobPanel } from "@/components/planning/solver-job-panel";
import { RecoveryCasePanel } from "@/components/planning/recovery-case-panel";
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
import { generateBasePlanScenario } from "@/lib/planning/base-plan-solver-actions";
import { prisma } from "@/lib/prisma";
import { getPlanRevisionHistory } from "@/lib/planning/revision-history";

type PageProps = {
  searchParams: Promise<{
    scenario?: string;
    job?: string;
    review?: string;
    case?: string;
    published?: string;
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

function recoveryDisruption(value: unknown) {
  const config = jsonRecord(value);
  const disruption = jsonRecord(config?.disruption);

  const text = (key: string) => {
    const candidate = disruption?.[key];
    return typeof candidate === "string" ? candidate : null;
  };

  return {
    type: text("type"),
    resourceId: text("resourceId"),
    startDate: text("startDate"),
    endDate: text("endDate") ?? text("startDate"),
  };
}

function humanRecoveryDate(startDate: string | null, endDate: string | null) {
  if (!startDate) return null;

  const start = dateFormatter.format(
    new Date(`${startDate.slice(0, 10)}T00:00:00.000Z`),
  );

  if (!endDate || endDate === startDate) return start;

  const end = dateFormatter.format(
    new Date(`${endDate.slice(0, 10)}T00:00:00.000Z`),
  );

  return `${start} – ${end}`;
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

  const publishedPlan =
    params.published
      ? await prisma.plan.findFirst({
          where: {
            id: params.published,
            tenantId: tenant.id,
            status: "PUBLISHED",
          },
          select: {
            id: true,
            name: true,
            version: true,
            status: true,
            effectiveFrom: true,
            publishedAt: true,
            _count: {
              select: {
                sessions: true,
              },
            },
          },
        })
      : null;

  const revisionHistory = await getPlanRevisionHistory({
    tenantId: tenant.id,
    planningScopeId: plan.planningScopeId,
  });

  const [
    scenarios,
    feasibility,
    instructors,
    rooms,
    recentJobs,
    basePlanJob,
    recoveryCases,
    teachingGroups,
  ] = await Promise.all([
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
    prisma.instructor.findMany({
      where: {
        tenantId: tenant.id,
        status: "ACTIVE",
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
      orderBy: [
        { lastName: "asc" },
        { firstName: "asc" },
      ],
    }),
    prisma.room.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: {
        code: "asc",
      },
    }),
    prisma.solverJob.findMany({
      where: {
        tenantId: tenant.id,
        planScenario: {
          planId: plan.id,
        },
      },
      include: {
        planScenario: {
          select: {
            id: true,
            name: true,
          },
        },
        runs: {
          select: {
            id: true,
            status: true,
            objectiveValue: true,
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
      take: 8,
    }),
    prisma.solverJob.findFirst({
      where: {
        tenantId: tenant.id,
        planScenario: {
          planId: plan.id,
          generationConfig: {
            path: ["type"],
            equals: "BASE_PLAN",
          },
        },
      },
      include: {
        planScenario: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        queuedAt: "desc",
      },
    }),
    prisma.recoveryCase.findMany({
      where: {
        tenantId: tenant.id,
        planId: plan.id,
        status: {
          in: ["OPEN", "GENERATING", "READY", "ACCEPTED"],
        },
      },
      include: {
        disruptions: {
          where: { active: true },
          orderBy: { createdAt: "asc" },
        },
        proposals: {
          include: {
            scenario: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        reviewSteps: {
          include: {
            decisions: {
              orderBy: { decidedAt: "desc" },
            },
          },
          orderBy: [
            { caseVersion: "desc" },
            { stage: "asc" },
            { position: "asc" },
          ],
        },
        plan: {
          select: {
            id: true,
            version: true,
            planningScopeId: true,
          },
        },
        solverJobs: {
          select: {
            id: true,
            status: true,
            failureMessage: true,
            queuedAt: true,
            completedAt: true,
            config: true,
            runs: {
              select: {
                diagnostics: true,
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
          take: 5,
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.teachingGroup.findMany({
      where: {
        tenantId: tenant.id,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    }),
  ]);

  const currentRecoveryCaseScenarioId =
    recoveryCases
      .flatMap((recoveryCase) => recoveryCase.proposals)
      .find(
        (proposal) =>
          proposal.status === "CURRENT" ||
          proposal.status === "ACCEPTED",
      )
      ?.scenario.id;

  const selectedScenarioId =
    params.scenario ??
    currentRecoveryCaseScenarioId ??
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
  const basePlanGenerationActive = Boolean(
    basePlanJob &&
      (basePlanJob.status === "QUEUED" ||
        basePlanJob.status === "RUNNING"),
  );

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

  const planStartDate = plan.planningStartDate
    ? plan.planningStartDate.toISOString().slice(0, 10)
    : "";
  const planEndDate = plan.planningEndDate
    ? plan.planningEndDate.toISOString().slice(0, 10)
    : "";

  const baseScenarios = scenarios
    .filter(
      (scenario) =>
        generationType(scenario.generationConfig) !==
        "RESOURCE_RECOVERY",
    )
    .map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      status: scenario.status,
    }));

  const instructorNames = Object.fromEntries(
    instructors.map((instructor) => [
      instructor.id,
      `${instructor.firstName} ${instructor.lastName}`,
    ]),
  );
  const roomNames = Object.fromEntries(
    rooms.map((room) => [
      room.id,
      room.code ? `${room.code} · ${room.name}` : room.name,
    ]),
  );

  const disruption = selectedScenario
    ? recoveryDisruption(selectedScenario.generationConfig)
    : null;
  const disruptionLabel =
    disruption?.type === "INSTRUCTOR_UNAVAILABLE"
      ? disruption.resourceId
        ? instructorNames[disruption.resourceId] ?? "Instructor"
        : "Instructor"
      : disruption?.type === "ROOM_UNAVAILABLE"
        ? disruption.resourceId
          ? roomNames[disruption.resourceId] ?? "Room"
          : "Room"
        : null;
  const scenarioHeading =
    disruption?.type === "INSTRUCTOR_UNAVAILABLE"
      ? `${disruptionLabel} unavailable`
      : disruption?.type === "ROOM_UNAVAILABLE"
        ? `Room ${disruptionLabel} unavailable`
        : selectedScenario?.name ?? "";
  const scenarioPeriod = disruption
    ? humanRecoveryDate(disruption.startDate, disruption.endDate)
    : null;
  const reviewingScenario =
    params.review === "1" &&
    selectedScenario?.status === "GENERATED";

  const selectedRecoveryCase =
    (params.case
      ? recoveryCases.find((item) => item.id === params.case)
      : null) ??
    recoveryCases.find((item) =>
      ["OPEN", "GENERATING", "READY"].includes(item.status),
    ) ??
    null;

  const recoveryProposal =
    selectedRecoveryCase?.proposals.find(
      (proposal) =>
        proposal.status === "CURRENT" ||
        proposal.status === "ACCEPTED",
    ) ?? null;

  const proposalAccepted =
    recoveryProposal?.status === "ACCEPTED" &&
    selectedRecoveryCase?.acceptedScenarioId ===
      recoveryProposal.scenario.id;

  const newerControlledPlan = selectedRecoveryCase
    ? await prisma.plan.findFirst({
        where: {
          tenantId: selectedRecoveryCase.tenantId,
          planningScopeId:
            selectedRecoveryCase.plan.planningScopeId,
          version: {
            gt: selectedRecoveryCase.basePlanVersion,
          },
          status: {
            in: ["APPROVED", "PUBLISHED"],
          },
        },
        select: {
          id: true,
          version: true,
          status: true,
        },
        orderBy: {
          version: "desc",
        },
      })
    : null;

  const baselineFresh =
    !selectedRecoveryCase ||
    (
      selectedRecoveryCase.basePlanVersion ===
        selectedRecoveryCase.plan.version &&
      !newerControlledPlan
    );

  const approvalComplete =
    Boolean(selectedRecoveryCase) &&
    (
      !selectedRecoveryCase!.approvalRequired ||
      selectedRecoveryCase!.reviewStatus === "APPROVED" ||
      selectedRecoveryCase!.reviewStatus === "NOT_REQUIRED"
    );

  const addUtcDays = (value: Date, days: number) => {
    const result = new Date(value);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  };

  const minimumPublishDate =
    plan.frozenThroughDate
      ? addUtcDays(plan.frozenThroughDate, 1)
      : plan.planningStartDate;

  const defaultPublishDate =
    minimumPublishDate ?? plan.planningStartDate;

  const initialScenario =
    scenarios.find(
      (scenario) =>
        generationType(scenario.generationConfig) !==
        "RESOURCE_RECOVERY" &&
        generationType(scenario.generationConfig) !==
        "RECOVERY_CASE",
    ) ?? scenarios[scenarios.length - 1] ?? null;

  const teachingGroupNames = Object.fromEntries(
    teachingGroups.map((group) => [
      group.id,
      group.code
        ? `${group.code} · ${group.name}`
        : group.name,
    ]),
  );

  if (selectedRecoveryCase) {
    for (const job of selectedRecoveryCase.solverJobs) {
      const run = job.runs[0];
      const diagnostics =
        run?.diagnostics &&
        typeof run.diagnostics === "object" &&
        !Array.isArray(run.diagnostics)
          ? (run.diagnostics as Record<string, unknown>)
          : null;
      const teachingGroupId =
        typeof diagnostics?.teachingGroupId === "string"
          ? diagnostics.teachingGroupId
          : null;

      if (
        diagnostics &&
        teachingGroupId &&
        teachingGroupNames[teachingGroupId]
      ) {
        diagnostics.teachingGroupLabel =
          teachingGroupNames[teachingGroupId];
      }
    }
  }

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

            {["DRAFT", "GENERATED", "REVIEWED"].includes(
              plan.status,
            ) ? (
              <div className="planning-scenario-actions">
                <div>
                  <CalendarClock size={16} />
                  <span>
                    Calculate a new timetable proposal from the
                    requirements and weekly allocations in Base Plan
                    v{plan.version}.
                  </span>
                </div>

                <form action={generateBasePlanScenario}>
                  <input
                    type="hidden"
                    name="planId"
                    value={plan.id}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={basePlanGenerationActive}
                  >
                    {basePlanGenerationActive
                      ? "Generation in progress"
                      : "Generate Base Plan proposal"}
                  </Button>
                </form>

                <BasePlanGenerationStatus job={basePlanJob} />
              </div>
            ) : null}

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

      <div className="planning-revision-summary">
        <PlanRevisionTimeline revisions={revisionHistory} compact />
      </div>

      {publishedPlan ? (
        <PublishedRevisionPanel
          plan={{
            id: publishedPlan.id,
            name: publishedPlan.name,
            version: publishedPlan.version,
            status: publishedPlan.status,
            effectiveFrom:
              publishedPlan.effectiveFrom,
            publishedAt:
              publishedPlan.publishedAt,
            sessionCount:
              publishedPlan._count.sessions,
          }}
        />
      ) : null}

      <RecoveryWorkflowStepper
        hasCase={Boolean(selectedRecoveryCase)}
        disruptionCount={
          selectedRecoveryCase?.disruptions.length ?? 0
        }
        hasProposal={Boolean(recoveryProposal)}
        proposalAccepted={proposalAccepted}
        approvalRequired={
          selectedRecoveryCase?.approvalRequired ??
          tenant.recoveryApprovalRequired
        }
        approvalComplete={approvalComplete}
        baselineFresh={baselineFresh}
      />

      {planStartDate && planEndDate && initialScenario ? (
        <div className="planning-solver-section">
          <RecoveryCasePanel
            planId={plan.id}
            baseScenarioId={initialScenario.id}
            planStartDate={planStartDate}
            planEndDate={planEndDate}
            recoveryCase={selectedRecoveryCase}
            instructors={instructors.map((item) => ({
              id: item.id,
              label: `${item.firstName} ${item.lastName}`,
            }))}
            rooms={rooms.map((item) => ({
              id: item.id,
              label: item.code ? `${item.code} · ${item.name}` : item.name,
            }))}
          />
        </div>
      ) : null}

      {planStartDate && planEndDate ? (
        <details className="planning-legacy-jobs">
          <summary>Recent individual solver jobs</summary>
          <div className="planning-solver-section">
          <SolverJobPanel
            planStartDate={planStartDate}
            planEndDate={planEndDate}
            baseScenarios={baseScenarios}
            instructors={instructors}
            rooms={rooms}
            jobs={recentJobs}
          />
          </div>
        </details>
      ) : null}

      <div id="change-review" className="planning-scenario-workspace planning-anchor-section">
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
                    <h2>{scenarioHeading}</h2>
                    {scenarioPeriod ? (
                      <p className="planning-scenario-period">
                        {scenarioPeriod}
                      </p>
                    ) : null}
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
                        <ShieldCheck size={16} />
                        <span>
                          Review the affected sessions and impact before
                          deciding whether this recovery proposal should
                          continue.
                        </span>
                      </div>

                      <div>
                        <Link
                          href={`/planning?scenario=${selectedScenario.id}&review=1#scenario-review`}
                        >
                          <Button type="button" variant="primary">
                            Review proposal
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {reviewingScenario ? (
                <div id="scenario-review">
                  <ScenarioReviewPanel
                    scenario={{
                      id: selectedScenario.id,
                      name: selectedScenario.name,
                      status: selectedScenario.status,
                      generationConfig:
                        selectedScenario.generationConfig,
                      sessionCount:
                        selectedScenario.sessions.length,
                      changes: selectedScenario.changes,
                    }}
                    solverStatus={
                      latestRun?.status ??
                      (jsonRecord(
                        selectedScenario.objectiveSummary,
                      )?.solverStatus as string | undefined) ??
                      "UNKNOWN"
                    }
                    blockingViolations={blockingViolations}
                    instructorNames={instructorNames}
                    roomNames={roomNames}
                  />
                </div>
              ) : null}

              <ScenarioComparison
                changes={selectedScenario.changes}
                instructorNames={instructorNames}
                roomNames={roomNames}
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

      <RecoveryApprovalPanel
        tenantId={tenant.id}
        tenantApprovalRequired={
          tenant.recoveryApprovalRequired
        }
        recoveryCase={selectedRecoveryCase}
        baselineFresh={baselineFresh}
      />

      {!publishedPlan ? (
        <RecoveryPublishPanel
          recoveryCaseId={
            selectedRecoveryCase?.id ?? null
          }
          proposalAccepted={proposalAccepted}
          baselineFresh={baselineFresh}
          approvalSatisfied={approvalComplete}
          currentPlanVersion={plan.version}
          minimumEffectiveFrom={
            minimumPublishDate
              ? minimumPublishDate
                  .toISOString()
                  .slice(0, 10)
              : null
          }
          defaultEffectiveFrom={
            defaultPublishDate
              ? defaultPublishDate
                  .toISOString()
                  .slice(0, 10)
              : null
          }
          maximumEffectiveFrom={
            plan.planningEndDate
              ? plan.planningEndDate
                  .toISOString()
                  .slice(0, 10)
              : null
          }
        />
      ) : null}

      <details className="planning-current-plan-review">
        <summary>Current plan approval history</summary>
        <PlanningReviewPanel
          planId={plan.id}
          planStatus={plan.status}
          workflow={workflow}
        />
      </details>
    </div>
  );
}
