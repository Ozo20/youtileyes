"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PlanReviewDecisionType,
  PlanReviewStepStatus,
  PlanReviewWorkflowStatus,
  PlanStatus,
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


function generationType(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

function inputFingerprint(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const fingerprint = (
    value as Record<string, unknown>
  ).inputFingerprint;

  return typeof fingerprint === "string"
    ? fingerprint
    : null;
}

async function basePlanInputFingerprint(
  tx: Parameters<
    Parameters<typeof prisma.$transaction>[0]
  >[0],
  planId: string,
) {
  const requirements =
    await tx.teachingRequirement.findMany({
      where: {
        planId,
        active: true,
      },
      select: {
        teachingGroupId: true,
        totalMinutes: true,
        distributionMode: true,
        minWeeklyMinutes: true,
        preferredWeeklyMinutes: true,
        maxWeeklyMinutes: true,
        carryoverAllowed: true,
        priority: true,
        weeklyAllocations: {
          select: {
            weekStartDate: true,
            targetMinutes: true,
            minMinutes: true,
            maxMinutes: true,
            availableTeachingDays: true,
            adjustmentReason: true,
          },
          orderBy: {
            weekStartDate: "asc",
          },
        },
      },
      orderBy: {
        teachingGroupId: "asc",
      },
    });

  const canonical = requirements.map((requirement) => ({
    ...requirement,
    weeklyAllocations: requirement.weeklyAllocations.map(
      (week) => ({
        ...week,
        weekStartDate:
          week.weekStartDate.toISOString().slice(0, 10),
      }),
    ),
  }));

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

function optionalText(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function refreshPlanning(path = "/planning") {
  revalidatePath("/");
  revalidatePath("/planning");
  revalidatePath("/history");
  redirect(path);
}

export async function updateScenarioDecision(formData: FormData) {
  const scenarioId = requiredText(formData, "scenarioId");
  const decision = requiredText(formData, "decision");

  if (decision !== "ACCEPT" && decision !== "REJECT") {
    throw new Error("Invalid scenario decision.");
  }

  const correlationId = randomUUID();

  const scenario = await prisma.$transaction(async (tx) => {
    const before = await tx.planScenario.findUnique({
      where: {
        id: scenarioId,
      },
      include: {
        plan: true,
        recoveryProposals: {
          include: {
            recoveryCase: {
              include: {
                plan: true,
              },
            },
          },
        },
        changes: {
          select: {
            explanationCode: true,
            scenarioSession: {
              select: {
                teachingGroupId: true,
              },
            },
          },
        },
      },
    });

    if (!before) {
      throw new Error("Scenario not found.");
    }

    if (before.status !== ScenarioStatus.GENERATED) {
      throw new Error(
        `Scenario ${before.name} is already ${before.status} and cannot be decided again.`,
      );
    }

    const recoveryProposal =
      before.recoveryProposals[0] ?? null;

    if (recoveryProposal) {
      if (
        recoveryProposal.status !== RecoveryProposalStatus.CURRENT
      ) {
        throw new Error(
          "This recovery proposal is no longer current.",
        );
      }

      if (
        recoveryProposal.caseVersion !==
        recoveryProposal.recoveryCase.version
      ) {
        throw new Error(
          "This recovery proposal is stale. Recalculate the Recovery Case before deciding.",
        );
      }

      if (
        recoveryProposal.recoveryCase.basePlanVersion !==
        recoveryProposal.recoveryCase.plan.version
      ) {
        throw new Error(
          "The Recovery Case baseline has changed. Recalculation is required.",
        );
      }

      const newerControlledPlan = await tx.plan.findFirst({
        where: {
          tenantId: before.tenantId,
          planningScopeId:
            recoveryProposal.recoveryCase.plan.planningScopeId,
          version: {
            gt: recoveryProposal.recoveryCase.basePlanVersion,
          },
          status: {
            in: [
              PlanStatus.APPROVED,
              PlanStatus.PUBLISHED,
            ],
          },
        },
        select: {
          version: true,
          status: true,
        },
        orderBy: {
          version: "desc",
        },
      });

      if (newerControlledPlan) {
        throw new Error(
          `This proposal is stale because plan v${newerControlledPlan.version} is ${newerControlledPlan.status}. Recalculate before accepting.`,
        );
      }
    }

    const directChangeCount = before.changes.filter(
      (change) =>
        change.explanationCode === "RESOURCE_RECOVERY_DIRECT",
    ).length;
    const cascadingChangeCount =
      before.changes.length - directChangeCount;
    const affectedTeachingGroupCount = new Set(
      before.changes.flatMap((change) =>
        change.scenarioSession?.teachingGroupId
          ? [change.scenarioSession.teachingGroupId]
          : [],
      ),
    ).size;

    const nextStatus =
      decision === "ACCEPT"
        ? ScenarioStatus.ACCEPTED
        : ScenarioStatus.REJECTED;

    const after = await tx.planScenario.update({
      where: {
        id: before.id,
      },
      data: {
        status: nextStatus,
      },
    });

    const scenarioType = generationType(
      before.generationConfig,
    );

    if (
      !recoveryProposal &&
      scenarioType === "BASE_PLAN" &&
      decision === "ACCEPT"
    ) {
      // A Plan may contain several generated alternatives, but only one
      // Base Plan proposal may represent the controlled revision.
      await tx.planScenario.updateMany({
        where: {
          tenantId: before.tenantId,
          planId: before.planId,
          id: {
            not: before.id,
          },
          status: {
            in: [
              ScenarioStatus.GENERATED,
              ScenarioStatus.ACCEPTED,
            ],
          },
          generationConfig: {
            path: ["type"],
            equals: "BASE_PLAN",
          },
        },
        data: {
          status: ScenarioStatus.REJECTED,
        },
      });

      await tx.plan.update({
        where: {
          id: before.planId,
        },
        data: {
          status: PlanStatus.GENERATED,
        },
      });
    }

    if (recoveryProposal) {
      if (decision === "ACCEPT") {
        await tx.recoveryCaseProposal.update({
          where: {
            id: recoveryProposal.id,
          },
          data: {
            status: RecoveryProposalStatus.ACCEPTED,
          },
        });

        await tx.recoveryCase.update({
          where: {
            id: recoveryProposal.recoveryCaseId,
          },
          data: {
            status: RecoveryCaseStatus.ACCEPTED,
            acceptedScenarioId: before.id,
            reviewStatus:
              recoveryProposal.recoveryCase.approvalRequired
                ? RecoveryCaseReviewStatus.DRAFT
                : RecoveryCaseReviewStatus.NOT_REQUIRED,
            submittedForReviewAt: null,
            approvedAt: null,
          },
        });
      } else {
        await tx.recoveryCaseProposal.update({
          where: {
            id: recoveryProposal.id,
          },
          data: {
            status: RecoveryProposalStatus.REJECTED,
          },
        });

        await tx.recoveryCase.update({
          where: {
            id: recoveryProposal.recoveryCaseId,
          },
          data: {
            status: RecoveryCaseStatus.OPEN,
            acceptedScenarioId: null,
            reviewStatus:
              recoveryProposal.recoveryCase.approvalRequired
                ? RecoveryCaseReviewStatus.DRAFT
                : RecoveryCaseReviewStatus.NOT_REQUIRED,
            submittedForReviewAt: null,
            approvedAt: null,
          },
        });
      }

      await writeAuditEvent(tx, {
        tenantId: before.tenantId,
        eventType:
          decision === "ACCEPT" ? "APPROVED" : "REJECTED",
        entityType: "RecoveryCaseProposal",
        entityId: recoveryProposal.id,
        actor: DEMO_ACTOR,
        description:
          decision === "ACCEPT"
            ? `Recovery proposal accepted for case v${recoveryProposal.caseVersion}.`
            : `Recovery proposal rejected for case v${recoveryProposal.caseVersion}.`,
        source: "planning.recovery-proposal-decision",
        correlationId,
        planId: before.planId,
        scenarioId: before.id,
        beforeState: {
          proposalStatus: recoveryProposal.status,
          caseStatus:
            recoveryProposal.recoveryCase.status,
        },
        afterState: {
          proposalStatus:
            decision === "ACCEPT"
              ? RecoveryProposalStatus.ACCEPTED
              : RecoveryProposalStatus.REJECTED,
          caseStatus:
            decision === "ACCEPT"
              ? RecoveryCaseStatus.ACCEPTED
              : RecoveryCaseStatus.OPEN,
        },
        context: {
          recoveryCaseId:
            recoveryProposal.recoveryCaseId,
          caseVersion: recoveryProposal.caseVersion,
          approvalRequired:
            recoveryProposal.recoveryCase.approvalRequired,
        },
      });
    }

    await writeAuditEvent(tx, {
      tenantId: before.tenantId,
      eventType:
        decision === "ACCEPT" ? "APPROVED" : "REJECTED",
      entityType: "PlanScenario",
      entityId: before.id,
      actor: DEMO_ACTOR,
      description:
        decision === "ACCEPT"
          ? `Planning scenario accepted: ${before.name}.`
          : `Planning scenario rejected: ${before.name}.`,
      source: "planning.workspace.scenario-decision",
      correlationId,
      planId: before.planId,
      scenarioId: before.id,
      beforeState: {
        id: before.id,
        name: before.name,
        status: before.status,
      },
      afterState: after,
      context: {
        decision,
        changedSessionCount: before.changes.length,
        directChangeCount,
        cascadingChangeCount,
        affectedTeachingGroupCount,
        note:
          "Scenario acceptance records the planning decision only; it does not overwrite the current plan.",
      },
    });

    return {
      scenario: after,
      recoveryCaseId:
        recoveryProposal?.recoveryCaseId ?? null,
    };
  });

  refreshPlanning(
    scenario.recoveryCaseId
      ? `/planning?case=${scenario.recoveryCaseId}&scenario=${scenario.scenario.id}#change-approval`
      : `/planning?scenario=${scenario.scenario.id}`,
  );
}

export async function submitPlanForReview(formData: FormData) {
  const planId = requiredText(formData, "planId");
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const plan = await tx.plan.findUnique({
      where: {
        id: planId,
      },
      include: {
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
    });

    if (!plan) {
      throw new Error("Plan not found.");
    }

    if (
      plan.status !== PlanStatus.DRAFT &&
      plan.status !== PlanStatus.GENERATED &&
      plan.status !== PlanStatus.REVIEWED
    ) {
      throw new Error(
        `Plan ${plan.name} cannot be submitted from status ${plan.status}.`,
      );
    }

    const acceptedBasePlanScenarios =
      await tx.planScenario.findMany({
        where: {
          tenantId: plan.tenantId,
          planId: plan.id,
          status: ScenarioStatus.ACCEPTED,
          generationConfig: {
            path: ["type"],
            equals: "BASE_PLAN",
          },
        },
        select: {
          id: true,
          name: true,
          generationConfig: true,
        },
      });

    if (acceptedBasePlanScenarios.length !== 1) {
      throw new Error(
        `Plan ${plan.name} v${plan.version} requires exactly one ` +
          `accepted Base Plan proposal before review. ` +
          `Found ${acceptedBasePlanScenarios.length}.`,
      );
    }

    const acceptedScenario =
      acceptedBasePlanScenarios[0];

    const acceptedFingerprint = inputFingerprint(
      acceptedScenario.generationConfig,
    );

    const currentFingerprint =
      await basePlanInputFingerprint(tx, plan.id);

    if (
      !acceptedFingerprint ||
      acceptedFingerprint !== currentFingerprint
    ) {
      throw new Error(
        `The accepted Base Plan proposal is stale because the ` +
          `teaching requirements or weekly allocations changed after ` +
          `it was generated. Generate and accept a new proposal first.`,
      );
    }

    const workflow = plan.reviewWorkflows[0];

    if (!workflow) {
      throw new Error("No review workflow is configured for this plan.");
    }

    const orderedSteps = workflow.steps;
    const firstRequired =
      orderedSteps.find((step) => step.required) ??
      orderedSteps[0];

    if (!firstRequired) {
      throw new Error("The review workflow has no steps.");
    }

    const now = new Date();

    const afterPlan = await tx.plan.update({
      where: {
        id: plan.id,
      },
      data: {
        status: PlanStatus.SUBMITTED,
        submittedAt: now,
      },
    });

    const afterWorkflow = await tx.planReviewWorkflow.update({
      where: {
        id: workflow.id,
      },
      data: {
        status: PlanReviewWorkflowStatus.PENDING,
        submittedAt: now,
        completedAt: null,
      },
    });

    for (const step of orderedSteps) {
      await tx.planReviewStep.update({
        where: {
          id: step.id,
        },
        data: {
          status:
            step.id === firstRequired.id
              ? PlanReviewStepStatus.READY
              : PlanReviewStepStatus.PENDING,
          startedAt: null,
          completedAt: null,
        },
      });
    }

    await writeAuditEvent(tx, {
      tenantId: plan.tenantId,
      eventType: "SUBMITTED",
      entityType: "Plan",
      entityId: plan.id,
      actor: DEMO_ACTOR,
      description: `Plan submitted for review: ${plan.name} v${plan.version}.`,
      source: "planning.workspace.review",
      correlationId,
      planId: plan.id,
      beforeState: {
        planStatus: plan.status,
        workflowStatus: workflow.status,
      },
      afterState: {
        planStatus: afterPlan.status,
        workflowStatus: afterWorkflow.status,
        firstReadyStepId: firstRequired.id,
      },
    });
  });

  refreshPlanning();
}

export async function decidePlanReviewStep(formData: FormData) {
  const stepId = requiredText(formData, "stepId");
  const decisionValue = requiredText(formData, "decision");
  const comment = optionalText(formData, "comment");

  if (
    !Object.values(PlanReviewDecisionType).includes(
      decisionValue as PlanReviewDecisionType,
    )
  ) {
    throw new Error("Invalid review decision.");
  }

  const decision =
    decisionValue as PlanReviewDecisionType;
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const step = await tx.planReviewStep.findUnique({
      where: {
        id: stepId,
      },
      include: {
        workflow: {
          include: {
            plan: true,
            steps: {
              orderBy: [
                { stage: "asc" },
                { position: "asc" },
              ],
            },
          },
        },
      },
    });

    if (!step) {
      throw new Error("Review step not found.");
    }

    if (
      step.status !== PlanReviewStepStatus.READY &&
      step.status !== PlanReviewStepStatus.IN_REVIEW
    ) {
      throw new Error(
        `Review step ${step.name} is not ready for a decision.`,
      );
    }

    const workflow = step.workflow;
    const plan = workflow.plan;
    const now = new Date();

    await tx.planReviewDecision.create({
      data: {
        tenantId: step.tenantId,
        stepId: step.id,
        decision,
        actorName: DEMO_ACTOR.name,
        comment,
        decidedAt: now,
      },
    });

    if (decision === PlanReviewDecisionType.APPROVE) {
      await tx.planReviewStep.update({
        where: {
          id: step.id,
        },
        data: {
          status: PlanReviewStepStatus.APPROVED,
          startedAt: step.startedAt ?? now,
          completedAt: now,
          reviewerName: step.reviewerName ?? DEMO_ACTOR.name,
        },
      });

      const nextStep = workflow.steps.find(
        (candidate) =>
          candidate.required &&
          (
            candidate.stage > step.stage ||
            (
              candidate.stage === step.stage &&
              candidate.position > step.position
            )
          ) &&
          candidate.status !== PlanReviewStepStatus.APPROVED,
      );

      if (nextStep) {
        await tx.planReviewStep.update({
          where: {
            id: nextStep.id,
          },
          data: {
            status: PlanReviewStepStatus.READY,
          },
        });

        await tx.planReviewWorkflow.update({
          where: {
            id: workflow.id,
          },
          data: {
            status: PlanReviewWorkflowStatus.IN_REVIEW,
          },
        });

        await tx.plan.update({
          where: {
            id: plan.id,
          },
          data: {
            status: PlanStatus.IN_REVIEW,
          },
        });
      } else {
        await tx.planReviewWorkflow.update({
          where: {
            id: workflow.id,
          },
          data: {
            status: PlanReviewWorkflowStatus.APPROVED,
            completedAt: now,
          },
        });

        await tx.plan.update({
          where: {
            id: plan.id,
          },
          data: {
            status: PlanStatus.APPROVED,
            approvedAt: now,
          },
        });
      }
    } else {
      const returned =
        decision ===
        PlanReviewDecisionType.RETURN_FOR_CHANGES;

      await tx.planReviewStep.update({
        where: {
          id: step.id,
        },
        data: {
          status: returned
            ? PlanReviewStepStatus.RETURNED
            : PlanReviewStepStatus.REJECTED,
          startedAt: step.startedAt ?? now,
          completedAt: now,
          reviewerName: step.reviewerName ?? DEMO_ACTOR.name,
        },
      });

      await tx.planReviewWorkflow.update({
        where: {
          id: workflow.id,
        },
        data: {
          status: PlanReviewWorkflowStatus.REJECTED,
          completedAt: now,
        },
      });

      await tx.plan.update({
        where: {
          id: plan.id,
        },
        data: {
          status: PlanStatus.DRAFT,
        },
      });
    }

    await writeAuditEvent(tx, {
      tenantId: step.tenantId,
      eventType:
        decision === PlanReviewDecisionType.APPROVE
          ? "APPROVED"
          : "REJECTED",
      entityType: "PlanReviewStep",
      entityId: step.id,
      actor: DEMO_ACTOR,
      description:
        decision === PlanReviewDecisionType.APPROVE
          ? `Review step approved: ${step.name}.`
          : decision ===
              PlanReviewDecisionType.RETURN_FOR_CHANGES
            ? `Plan returned for changes from review step: ${step.name}.`
            : `Review step rejected: ${step.name}.`,
      source: "planning.workspace.review",
      correlationId,
      planId: plan.id,
      beforeState: {
        stepStatus: step.status,
        workflowStatus: workflow.status,
        planStatus: plan.status,
      },
      afterState: {
        decision,
        comment,
      },
      context: {
        workflowId: workflow.id,
        reviewerRole: step.reviewerRole,
      },
    });
  });

  refreshPlanning();
}
