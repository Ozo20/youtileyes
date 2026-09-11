"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PlanReviewDecisionType,
  PlanReviewStepStatus,
  PlanReviewWorkflowStatus,
  PlanStatus,
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
    });

    if (!before) {
      throw new Error("Scenario not found.");
    }

    if (
      before.status !== ScenarioStatus.GENERATED &&
      before.status !== ScenarioStatus.ACCEPTED &&
      before.status !== ScenarioStatus.REJECTED
    ) {
      throw new Error(
        `Scenario ${before.name} is not ready for a decision.`,
      );
    }

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
      beforeState: before,
      afterState: after,
      context: {
        decision,
        note:
          "Scenario acceptance records the planning decision only; it does not overwrite the current plan.",
      },
    });

    return after;
  });

  refreshPlanning(`/planning?scenario=${scenario.id}`);
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
