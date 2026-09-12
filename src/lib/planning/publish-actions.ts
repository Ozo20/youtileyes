"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PlanStatus,
  Prisma,
  RecoveryCaseReviewStatus,
  RecoveryCaseStatus,
  RecoveryProposalStatus,
  ScenarioStatus,
} from "../../generated/prisma/client";

import { writeAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const DEMO_ACTOR = {
  name: "Ola Solem",
};

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function utcDate(value: string, key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${key} must use YYYY-MM-DD.`);
  }

  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function jsonDate(value: Prisma.JsonValue | null) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const candidate = value.date;

  return typeof candidate === "string"
    ? candidate.slice(0, 10)
    : null;
}

function cloneJson(value: Prisma.JsonValue | null) {
  if (value === null) return undefined;

  return JSON.parse(
    JSON.stringify(value),
  ) as Prisma.InputJsonValue;
}

export async function publishRecoveryCase(formData: FormData) {
  const recoveryCaseId = requiredText(
    formData,
    "recoveryCaseId",
  );
  const effectiveFrom = utcDate(
    requiredText(formData, "effectiveFrom"),
    "effectiveFrom",
  );
  const correlationId = randomUUID();

  const result = await prisma.$transaction(
    async (tx) => {
      const recoveryCase = await tx.recoveryCase.findUnique({
        where: {
          id: recoveryCaseId,
        },
        include: {
          plan: {
            include: {
              teachingRequirements: {
                include: {
                  weeklyAllocations: {
                    orderBy: {
                      weekStartDate: "asc",
                    },
                  },
                },
              },
              reviewWorkflows: {
                include: {
                  steps: {
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
          },
          proposals: {
            where: {
              status: RecoveryProposalStatus.ACCEPTED,
            },
            include: {
              scenario: {
                include: {
                  sessions: {
                    include: {
                      instructors: true,
                      students: true,
                    },
                    orderBy: [
                      { date: "asc" },
                      { startMinute: "asc" },
                    ],
                  },
                  changes: {
                    select: {
                      beforeState: true,
                      afterState: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              updatedAt: "desc",
            },
          },
          reviewSteps: {
            where: {
              required: true,
            },
          },
        },
      });

      if (!recoveryCase) {
        throw new Error("Recovery case not found.");
      }

      if (recoveryCase.publishedPlanId) {
        return {
          planId: recoveryCase.publishedPlanId,
          alreadyPublished: true,
        };
      }

      if (
        recoveryCase.status !== RecoveryCaseStatus.ACCEPTED ||
        !recoveryCase.acceptedScenarioId
      ) {
        throw new Error(
          "Only an accepted Recovery Case can be published.",
        );
      }

      const proposal = recoveryCase.proposals.find(
        (item) =>
          item.scenarioId ===
          recoveryCase.acceptedScenarioId,
      );

      if (!proposal) {
        throw new Error(
          "The accepted Recovery Case proposal was not found.",
        );
      }

      if (
        proposal.caseVersion !== recoveryCase.version ||
        proposal.status !== RecoveryProposalStatus.ACCEPTED ||
        proposal.scenario.status !== ScenarioStatus.ACCEPTED
      ) {
        throw new Error(
          "The accepted proposal is stale. Recalculate and review the Recovery Case again.",
        );
      }

      if (
        recoveryCase.approvalRequired &&
        recoveryCase.reviewStatus !==
          RecoveryCaseReviewStatus.APPROVED
      ) {
        throw new Error(
          "Required Recovery Case approval is not complete.",
        );
      }

      if (
        !recoveryCase.approvalRequired &&
        recoveryCase.reviewStatus !==
          RecoveryCaseReviewStatus.NOT_REQUIRED
      ) {
        throw new Error(
          "Recovery Case approval state is inconsistent.",
        );
      }

      if (
        recoveryCase.plan.version !==
        recoveryCase.basePlanVersion
      ) {
        throw new Error(
          "The Recovery Case baseline has changed. Recalculation is required.",
        );
      }

      const newerPlan = await tx.plan.findFirst({
        where: {
          tenantId: recoveryCase.tenantId,
          planningScopeId:
            recoveryCase.plan.planningScopeId,
          version: {
            gt: recoveryCase.basePlanVersion,
          },
          status: {
            not: PlanStatus.ARCHIVED,
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
      });

      if (newerPlan) {
        throw new Error(
          `Plan v${newerPlan.version} already exists for this planning scope. Rebase the Recovery Case before publishing.`,
        );
      }

      const minimumEffectiveFrom =
        recoveryCase.plan.frozenThroughDate
          ? addUtcDays(
              recoveryCase.plan.frozenThroughDate,
              1,
            )
          : recoveryCase.plan.planningStartDate;

      if (
        minimumEffectiveFrom &&
        effectiveFrom < minimumEffectiveFrom
      ) {
        throw new Error(
          `Effective date cannot be before ${dateKey(minimumEffectiveFrom)}.`,
        );
      }

      if (
        recoveryCase.plan.planningEndDate &&
        effectiveFrom >
          recoveryCase.plan.planningEndDate
      ) {
        throw new Error(
          "Effective date cannot be after the planning horizon.",
        );
      }

      const changedDates =
        proposal.scenario.changes.flatMap((change) => {
          const before = jsonDate(change.beforeState);
          const after = jsonDate(change.afterState);

          return [before, after].filter(
            (value): value is string => Boolean(value),
          );
        });

      const earliestChangedDate =
        changedDates.sort()[0] ?? null;

      if (
        earliestChangedDate &&
        dateKey(effectiveFrom) >
          earliestChangedDate
      ) {
        throw new Error(
          `The accepted proposal changes the timetable from ${earliestChangedDate}. Choose that date or an earlier permitted effective date.`,
        );
      }

      const publishableSessions =
        proposal.scenario.sessions.filter(
          (session) => session.date >= effectiveFrom,
        );

      if (publishableSessions.length === 0) {
        throw new Error(
          "The accepted proposal contains no sessions on or after the effective date.",
        );
      }

      const highestVersion = await tx.plan.aggregate({
        where: {
          tenantId: recoveryCase.tenantId,
          planningScopeId:
            recoveryCase.plan.planningScopeId,
        },
        _max: {
          version: true,
        },
      });

      const nextVersion =
        (highestVersion._max.version ?? 0) + 1;
      const now = new Date();

      const newPlan = await tx.plan.create({
        data: {
          tenantId: recoveryCase.tenantId,
          planningScopeId:
            recoveryCase.plan.planningScopeId,
          academicPeriodId:
            recoveryCase.plan.academicPeriodId,
          name: recoveryCase.plan.name,
          version: nextVersion,
          status: PlanStatus.PUBLISHED,
          basedOnPlanId: recoveryCase.plan.id,
          planningAsOfDate:
            recoveryCase.plan.planningAsOfDate,
          frozenThroughDate:
            recoveryCase.plan.frozenThroughDate,
          planningStartDate:
            recoveryCase.plan.planningStartDate,
          planningEndDate:
            recoveryCase.plan.planningEndDate,
          effectiveFrom,
          effectiveTo: null,
          approvedAt:
            recoveryCase.approvedAt ?? now,
          publishedAt: now,
        },
      });

      // A recovery publication creates a new Plan revision. The structural
      // Base Plan demand is unchanged by the recovery itself, so clone the
      // source revision's teaching requirements and weekly allocations.
      // This ensures every Plan revision remains self-contained and can be
      // used safely as the baseline for a later structural Base Plan revision.
      for (const requirement of recoveryCase.plan.teachingRequirements) {
        await tx.teachingRequirement.create({
          data: {
            tenantId: recoveryCase.tenantId,
            planId: newPlan.id,
            teachingGroupId: requirement.teachingGroupId,
            academicPeriodId: requirement.academicPeriodId,
            totalMinutes: requirement.totalMinutes,
            distributionMode: requirement.distributionMode,
            minWeeklyMinutes: requirement.minWeeklyMinutes,
            preferredWeeklyMinutes:
              requirement.preferredWeeklyMinutes,
            maxWeeklyMinutes: requirement.maxWeeklyMinutes,
            carryoverAllowed: requirement.carryoverAllowed,
            priority: requirement.priority,
            active: requirement.active,
            weeklyAllocations: {
              create: requirement.weeklyAllocations.map((week) => ({
                tenantId: recoveryCase.tenantId,
                weekStartDate: week.weekStartDate,
                targetMinutes: week.targetMinutes,
                minMinutes: week.minMinutes,
                maxMinutes: week.maxMinutes,
                availableTeachingDays:
                  week.availableTeachingDays,
                adjustmentReason: week.adjustmentReason,
              })),
            },
          },
        });
      }

      const baselineScenario =
        await tx.planScenario.create({
          data: {
            tenantId: recoveryCase.tenantId,
            planId: newPlan.id,
            name: `Published baseline v${nextVersion}`,
            status: ScenarioStatus.ACCEPTED,
            solverScore:
              proposal.scenario.solverScore,
            objectiveSummary: cloneJson(
              proposal.scenario.objectiveSummary,
            ),
            generationConfig: {
              type: "PUBLISHED_BASELINE",
              sourceRecoveryCaseId:
                recoveryCase.id,
              sourceScenarioId:
                proposal.scenario.id,
              sourcePlanId:
                recoveryCase.plan.id,
              sourcePlanVersion:
                recoveryCase.basePlanVersion,
              publishedPlanVersion:
                nextVersion,
              effectiveFrom:
                dateKey(effectiveFrom),
            },
            generatedAt: now,
          },
        });

      for (const source of publishableSessions) {
        const session = await tx.session.create({
          data: {
            tenantId: recoveryCase.tenantId,
            planId: newPlan.id,
            teachingGroupId:
              source.teachingGroupId,
            roomId: source.roomId,
            date: source.date,
            startMinute: source.startMinute,
            endMinute: source.endMinute,
            status: "PLANNED",
            origin: "REPLANNED",
            locked: source.locked,
            changeReason:
              source.changeReason ??
              `Published from Recovery Case v${recoveryCase.version}.`,
            instructors: {
              create: source.instructors.map(
                (assignment) => ({
                  tenantId:
                    recoveryCase.tenantId,
                  instructorId:
                    assignment.instructorId,
                  role: assignment.role,
                }),
              ),
            },
            students: {
              create: source.students.map(
                (membership) => ({
                  tenantId:
                    recoveryCase.tenantId,
                  studentId:
                    membership.studentId,
                }),
              ),
            },
          },
          include: {
            instructors: true,
            students: true,
          },
        });

        await tx.scenarioSession.create({
          data: {
            tenantId: recoveryCase.tenantId,
            planScenarioId:
              baselineScenario.id,
            sourceSessionId: session.id,
            teachingGroupId:
              session.teachingGroupId,
            roomId: session.roomId,
            date: session.date,
            startMinute:
              session.startMinute,
            endMinute: session.endMinute,
            origin: session.origin,
            locked: session.locked,
            changeReason:
              session.changeReason,
            instructors: {
              create:
                session.instructors.map(
                  (assignment) => ({
                    tenantId:
                      recoveryCase.tenantId,
                    instructorId:
                      assignment.instructorId,
                    role: assignment.role,
                  }),
                ),
            },
            students: {
              create: session.students.map(
                (membership) => ({
                  tenantId:
                    recoveryCase.tenantId,
                  studentId:
                    membership.studentId,
                }),
              ),
            },
          },
        });
      }

      for (const workflow of
        recoveryCase.plan.reviewWorkflows) {
        await tx.planReviewWorkflow.create({
          data: {
            tenantId: recoveryCase.tenantId,
            planId: newPlan.id,
            name: workflow.name,
            status: "DRAFT",
            steps: {
              create: workflow.steps.map((step) => ({
                tenantId:
                  recoveryCase.tenantId,
                stage: step.stage,
                position: step.position,
                name: step.name,
                reviewerRole:
                  step.reviewerRole,
                reviewerId:
                  step.reviewerId,
                reviewerName: null,
                required: step.required,
                status: "PENDING",
              })),
            },
          },
        });
      }

      const oldEffectiveTo = addUtcDays(
        effectiveFrom,
        -1,
      );

      const supersededPlan = await tx.plan.update({
        where: {
          id: recoveryCase.plan.id,
        },
        data: {
          status: PlanStatus.SUPERSEDED,
          effectiveTo: oldEffectiveTo,
          supersededAt: now,
        },
      });

      const closedCase =
        await tx.recoveryCase.update({
          where: {
            id: recoveryCase.id,
          },
          data: {
            status: RecoveryCaseStatus.CLOSED,
            publishedPlanId: newPlan.id,
            publishedAt: now,
            publishedByName:
              DEMO_ACTOR.name,
          },
        });

      await writeAuditEvent(tx, {
        tenantId: recoveryCase.tenantId,
        eventType: "SUPERSEDED",
        entityType: "Plan",
        entityId: supersededPlan.id,
        actor: DEMO_ACTOR,
        description:
          `Plan v${recoveryCase.plan.version} superseded by published Plan v${nextVersion}.`,
        source: "planning.publish",
        correlationId,
        planId: supersededPlan.id,
        scenarioId: proposal.scenario.id,
        beforeState: {
          status: recoveryCase.plan.status,
          effectiveTo:
            recoveryCase.plan.effectiveTo,
        },
        afterState: {
          status:
            supersededPlan.status,
          effectiveTo:
            supersededPlan.effectiveTo,
          supersededAt:
            supersededPlan.supersededAt,
        },
        context: {
          recoveryCaseId:
            recoveryCase.id,
          successorPlanId:
            newPlan.id,
          successorPlanVersion:
            nextVersion,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: recoveryCase.tenantId,
        eventType: "PUBLISHED",
        entityType: "Plan",
        entityId: newPlan.id,
        actor: DEMO_ACTOR,
        description:
          `Plan v${nextVersion} published from Recovery Case v${recoveryCase.version}.`,
        source: "planning.publish",
        correlationId,
        planId: newPlan.id,
        scenarioId: baselineScenario.id,
        afterState: {
          id: newPlan.id,
          version: nextVersion,
          status: newPlan.status,
          effectiveFrom:
            newPlan.effectiveFrom,
          sessionCount:
            publishableSessions.length,
          baselineScenarioId:
            baselineScenario.id,
        },
        context: {
          recoveryCaseId:
            recoveryCase.id,
          sourcePlanId:
            recoveryCase.plan.id,
          sourcePlanVersion:
            recoveryCase.plan.version,
          sourceScenarioId:
            proposal.scenario.id,
          effectiveFrom:
            dateKey(effectiveFrom),
          copiedReviewWorkflowCount:
            recoveryCase.plan
              .reviewWorkflows.length,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: recoveryCase.tenantId,
        eventType: "PUBLISHED",
        entityType: "RecoveryCase",
        entityId: recoveryCase.id,
        actor: DEMO_ACTOR,
        description:
          `Recovery Case v${recoveryCase.version} published as Plan v${nextVersion}.`,
        source: "planning.publish",
        correlationId,
        planId: newPlan.id,
        scenarioId: proposal.scenario.id,
        beforeState: {
          status: recoveryCase.status,
          publishedPlanId:
            recoveryCase.publishedPlanId,
        },
        afterState: {
          status: closedCase.status,
          publishedPlanId:
            closedCase.publishedPlanId,
          publishedAt:
            closedCase.publishedAt,
        },
        context: {
          effectiveFrom:
            dateKey(effectiveFrom),
          publishedSessionCount:
            publishableSessions.length,
        },
      });

      return {
        planId: newPlan.id,
        alreadyPublished: false,
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable,
    },
  );

  revalidatePath("/");
  revalidatePath("/planning");
  revalidatePath("/schedule");
  revalidatePath("/history");

  redirect(
    `/planning?published=${result.planId}#change-publish`,
  );
}


export async function publishBasePlanRevision(formData: FormData) {
  const planId = requiredText(formData, "planId");
  const correlationId = randomUUID();

  const publishedPlanId = await prisma.$transaction(
    async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        include: {
          basedOnPlan: true,
          reviewWorkflows: {
            include: {
              steps: true,
            },
            orderBy: { createdAt: "asc" },
          },
          scenarios: {
            where: {
              status: ScenarioStatus.ACCEPTED,
              generationConfig: {
                path: ["type"],
                equals: "BASE_PLAN",
              },
            },
            include: {
              sessions: {
                include: {
                  instructors: true,
                  students: true,
                },
                orderBy: [
                  { date: "asc" },
                  { startMinute: "asc" },
                ],
              },
            },
          },
          _count: {
            select: { sessions: true },
          },
        },
      });

      if (!plan) {
        throw new Error("Plan not found.");
      }

      if (plan.status === PlanStatus.PUBLISHED) {
        return plan.id;
      }

      if (plan.status !== PlanStatus.APPROVED) {
        throw new Error(
          `Plan ${plan.name} v${plan.version} must be APPROVED before publication. Current status: ${plan.status}.`,
        );
      }

      const workflow = plan.reviewWorkflows[0] ?? null;

      if (!workflow || workflow.status !== "APPROVED") {
        throw new Error(
          "The Base Plan review workflow must be fully approved before publication.",
        );
      }

      if (
        workflow.steps.some(
          (step) => step.required && step.status !== "APPROVED",
        )
      ) {
        throw new Error(
          "One or more required Base Plan review steps are not approved.",
        );
      }

      if (plan.scenarios.length !== 1) {
        throw new Error(
          `Plan ${plan.name} v${plan.version} requires exactly one accepted Base Plan proposal before publication. Found ${plan.scenarios.length}.`,
        );
      }

      const scenario = plan.scenarios[0];

      if (scenario.sessions.length === 0) {
        throw new Error(
          "The accepted Base Plan proposal contains no sessions to publish.",
        );
      }

      if (plan._count.sessions > 0) {
        throw new Error(
          "This Plan revision already contains official sessions and cannot be materialised again.",
        );
      }

      const newerPlan = await tx.plan.findFirst({
        where: {
          tenantId: plan.tenantId,
          planningScopeId: plan.planningScopeId,
          version: { gt: plan.version },
          status: { not: PlanStatus.ARCHIVED },
        },
        select: { version: true, status: true },
        orderBy: { version: "desc" },
      });

      if (newerPlan) {
        throw new Error(
          `Plan v${newerPlan.version} already exists for this planning scope. Publish or resolve the newer revision instead.`,
        );
      }

      if (
        plan.basedOnPlan &&
        plan.basedOnPlan.status !== PlanStatus.PUBLISHED
      ) {
        throw new Error(
          `The predecessor Plan v${plan.basedOnPlan.version} is ${plan.basedOnPlan.status}, not PUBLISHED.`,
        );
      }

      const now = new Date();
      const effectiveFrom =
        plan.effectiveFrom ??
        plan.planningStartDate ??
        now;

      // Generate official Session ids up front so the complete Base Plan can
      // be materialised with createMany rather than thousands of sequential
      // nested writes inside one transaction.
      const sessionRows = scenario.sessions.map((source) => ({
        id: randomUUID(),
        tenantId: plan.tenantId,
        planId: plan.id,
        teachingGroupId: source.teachingGroupId,
        roomId: source.roomId,
        date: source.date,
        startMinute: source.startMinute,
        endMinute: source.endMinute,
        status: "PLANNED" as const,
        origin: "GENERATED" as const,
        locked: source.locked,
        changeReason:
          source.changeReason ??
          `Published from ${scenario.name}.`,
      }));

      const sessionIdByScenarioSessionId = new Map(
        scenario.sessions.map((source, index) => [
          source.id,
          sessionRows[index].id,
        ]),
      );

      const instructorRows = scenario.sessions.flatMap((source) => {
        const sessionId = sessionIdByScenarioSessionId.get(source.id)!;
        return source.instructors.map((assignment) => ({
          tenantId: plan.tenantId,
          sessionId,
          instructorId: assignment.instructorId,
          role: assignment.role,
        }));
      });

      const studentRows = scenario.sessions.flatMap((source) => {
        const sessionId = sessionIdByScenarioSessionId.get(source.id)!;
        return source.students.map((membership) => ({
          tenantId: plan.tenantId,
          sessionId,
          studentId: membership.studentId,
        }));
      });

      for (let offset = 0; offset < sessionRows.length; offset += 500) {
        await tx.session.createMany({
          data: sessionRows.slice(offset, offset + 500),
        });
      }

      for (let offset = 0; offset < instructorRows.length; offset += 1000) {
        await tx.sessionInstructor.createMany({
          data: instructorRows.slice(offset, offset + 1000),
        });
      }

      for (let offset = 0; offset < studentRows.length; offset += 1000) {
        await tx.sessionStudent.createMany({
          data: studentRows.slice(offset, offset + 1000),
        });
      }

      const publishedPlan = await tx.plan.update({
        where: { id: plan.id },
        data: {
          status: PlanStatus.PUBLISHED,
          effectiveFrom,
          publishedAt: now,
        },
      });

      if (plan.basedOnPlan) {
        const predecessorEffectiveTo = addUtcDays(effectiveFrom, -1);

        const supersededPlan = await tx.plan.update({
          where: { id: plan.basedOnPlan.id },
          data: {
            status: PlanStatus.SUPERSEDED,
            effectiveTo: predecessorEffectiveTo,
            supersededAt: now,
          },
        });

        await writeAuditEvent(tx, {
          tenantId: plan.tenantId,
          eventType: "SUPERSEDED",
          entityType: "Plan",
          entityId: supersededPlan.id,
          actor: DEMO_ACTOR,
          description: `Plan v${plan.basedOnPlan.version} superseded by published Base Plan v${plan.version}.`,
          source: "planning.base-plan.publish",
          correlationId,
          planId: supersededPlan.id,
          scenarioId: scenario.id,
          beforeState: {
            status: plan.basedOnPlan.status,
            effectiveTo: plan.basedOnPlan.effectiveTo,
          },
          afterState: {
            status: supersededPlan.status,
            effectiveTo: supersededPlan.effectiveTo,
            supersededAt: supersededPlan.supersededAt,
          },
          context: {
            successorPlanId: plan.id,
            successorPlanVersion: plan.version,
          },
        });
      }

      await writeAuditEvent(tx, {
        tenantId: plan.tenantId,
        eventType: "PUBLISHED",
        entityType: "Plan",
        entityId: publishedPlan.id,
        actor: DEMO_ACTOR,
        description: `Base Plan v${plan.version} published with ${sessionRows.length} sessions.`,
        source: "planning.base-plan.publish",
        correlationId,
        planId: publishedPlan.id,
        scenarioId: scenario.id,
        beforeState: {
          status: plan.status,
          officialSessionCount: plan._count.sessions,
        },
        afterState: {
          status: publishedPlan.status,
          effectiveFrom: publishedPlan.effectiveFrom,
          publishedAt: publishedPlan.publishedAt,
          officialSessionCount: sessionRows.length,
        },
        context: {
          sourceScenarioId: scenario.id,
          sourceScenarioName: scenario.name,
          predecessorPlanId: plan.basedOnPlanId,
          predecessorPlanVersion: plan.basedOnPlan?.version ?? null,
          instructorAssignmentCount: instructorRows.length,
          studentMembershipCount: studentRows.length,
        },
      });

      return publishedPlan.id;
    },
    {
      maxWait: 10_000,
      timeout: 60_000,
    },
  );

  revalidatePath("/");
  revalidatePath("/planning");
  revalidatePath("/planning/base-plan");
  revalidatePath("/planning/revisions");
  revalidatePath("/schedule");
  revalidatePath("/history");
  redirect(`/planning?published=${publishedPlanId}`);
}
