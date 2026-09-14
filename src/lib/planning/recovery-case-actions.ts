"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PlanReviewDecisionType,
  PlanReviewStepStatus,
  Prisma,
  RecoveryCaseReviewStatus,
  RecoveryCaseStatus,
  RecoveryDisruptionType,
  RecoveryProposalStatus,
  SolverJobStatus,
} from "../../generated/prisma/client";

import { writeAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const DEMO_ACTOR = { name: "Ola Solem" };

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
  return value.trim() || null;
}

function dateValue(value: string, key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${key} must use YYYY-MM-DD.`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

async function resourceLabel(
  tenantId: string,
  type: RecoveryDisruptionType,
  resourceId: string,
) {
  if (type === RecoveryDisruptionType.INSTRUCTOR_UNAVAILABLE) {
    const instructor = await prisma.instructor.findFirst({
      where: { id: resourceId, tenantId },
      select: { firstName: true, lastName: true },
    });
    if (!instructor) throw new Error("Instructor not found.");
    return `${instructor.firstName} ${instructor.lastName}`;
  }

  const room = await prisma.room.findFirst({
    where: { id: resourceId, tenantId },
    select: { code: true, name: true },
  });
  if (!room) throw new Error("Room not found.");
  return room.code ? `${room.code} · ${room.name}` : room.name;
}

async function invalidateCurrentRecoveryProposal(
  tx: Prisma.TransactionClient,
  recoveryCaseId: string,
) {
  await tx.recoveryCaseProposal.updateMany({
    where: {
      recoveryCaseId,
      status: {
        in: [
          RecoveryProposalStatus.CURRENT,
          RecoveryProposalStatus.ACCEPTED,
        ],
      },
    },
    data: {
      status: RecoveryProposalStatus.STALE,
    },
  });

  return tx.recoveryCase.update({
    where: {
      id: recoveryCaseId,
    },
    data: {
      version: {
        increment: 1,
      },
      status: RecoveryCaseStatus.OPEN,
      acceptedScenarioId: null,
      reviewStatus: RecoveryCaseReviewStatus.DRAFT,
      submittedForReviewAt: null,
      approvedAt: null,
    },
  });
}

export async function addRecoveryDisruption(formData: FormData) {
  const planId = requiredText(formData, "planId");
  const baseScenarioId = requiredText(formData, "baseScenarioId");
  const existingCaseId = optionalText(formData, "recoveryCaseId");
  const rawType = requiredText(formData, "resourceType");
  const resourceId = requiredText(formData, "resourceId");
  const startDate = dateValue(requiredText(formData, "startDate"), "startDate");
  const endDate = dateValue(requiredText(formData, "endDate"), "endDate");

  if (endDate < startDate) {
    throw new Error("endDate cannot be before startDate.");
  }

  if (
    rawType !== RecoveryDisruptionType.INSTRUCTOR_UNAVAILABLE &&
    rawType !== RecoveryDisruptionType.ROOM_UNAVAILABLE
  ) {
    throw new Error("Invalid disruption type.");
  }
  const type = rawType as RecoveryDisruptionType;

  const baseScenario = await prisma.planScenario.findFirst({
    where: { id: baseScenarioId, planId },
    include: { plan: true },
  });
  if (!baseScenario) throw new Error("Base scenario not found.");

  const label = await resourceLabel(
    baseScenario.tenantId,
    type,
    resourceId,
  );
  const correlationId = randomUUID();

  const recoveryCase = await prisma.$transaction(async (tx) => {
    let createdNewCase = false;

    let currentCase = existingCaseId
      ? await tx.recoveryCase.findFirst({
          where: {
            id: existingCaseId,
            tenantId: baseScenario.tenantId,
            planId,
            status: {
              in: [
                RecoveryCaseStatus.OPEN,
                RecoveryCaseStatus.READY,
              ],
            },
          },
          include: { disruptions: true },
        })
      : null;

    if (!currentCase) {
      const tenantPolicy = await tx.tenant.findUniqueOrThrow({
        where: { id: baseScenario.tenantId },
        select: { recoveryApprovalRequired: true },
      });

      currentCase = await tx.recoveryCase.create({
        data: {
          tenantId: baseScenario.tenantId,
          planId,
          baseScenarioId,
          basePlanVersion: baseScenario.plan.version,
          name: `Recovery case · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          status: RecoveryCaseStatus.OPEN,
          approvalRequired: tenantPolicy.recoveryApprovalRequired,
          reviewStatus: tenantPolicy.recoveryApprovalRequired
            ? RecoveryCaseReviewStatus.DRAFT
            : RecoveryCaseReviewStatus.NOT_REQUIRED,
          createdByName: DEMO_ACTOR.name,
        },
        include: { disruptions: true },
      });

      createdNewCase = true;

      await writeAuditEvent(tx, {
        tenantId: baseScenario.tenantId,
        eventType: "CREATED",
        entityType: "RecoveryCase",
        entityId: currentCase.id,
        actor: DEMO_ACTOR,
        description: `Recovery case created from ${baseScenario.name}.`,
        source: "planning.recovery-case",
        correlationId,
        planId,
        scenarioId: baseScenarioId,
        afterState: {
          status: currentCase.status,
          version: currentCase.version,
          baseScenarioId,
        },
      });
    }

    const duplicate = currentCase.disruptions.some(
      (item) =>
        item.active &&
        item.type === type &&
        item.resourceId === resourceId &&
        item.startDate.getTime() === startDate.getTime() &&
        item.endDate.getTime() === endDate.getTime(),
    );

    if (duplicate) {
      throw new Error("This disruption is already in the recovery case.");
    }

    const disruption = await tx.recoveryDisruption.create({
      data: {
        tenantId: baseScenario.tenantId,
        recoveryCaseId: currentCase.id,
        type,
        resourceId,
        resourceLabel: label,
        startDate,
        endDate,
        createdByName: DEMO_ACTOR.name,
      },
    });

    await tx.recoveryCaseProposal.updateMany({
      where: {
        recoveryCaseId: currentCase.id,
        status: RecoveryProposalStatus.CURRENT,
      },
      data: { status: RecoveryProposalStatus.STALE },
    });

    const updatedCase = await tx.recoveryCase.update({
      where: { id: currentCase.id },
      data: {
        ...(createdNewCase
          ? {}
          : {
              version: {
                increment: 1,
              },
            }),
        status: RecoveryCaseStatus.OPEN,
        acceptedScenarioId: null,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: baseScenario.tenantId,
      eventType: "CREATED",
      entityType: "RecoveryDisruption",
      entityId: disruption.id,
      actor: DEMO_ACTOR,
      description: `${label} added to recovery case.`,
      source: "planning.recovery-case",
      correlationId,
      planId,
      scenarioId: baseScenarioId,
      beforeState: {
        caseVersion: currentCase.version,
      },
      afterState: {
        caseVersion: updatedCase.version,
        type,
        resourceId,
        resourceLabel: label,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
      },
      context: {
        recoveryCaseId: currentCase.id,
        previousCurrentProposalMarkedStale: true,
      },
    });

    return updatedCase;
  });

  revalidatePath("/planning");
  redirect(`/planning?case=${recoveryCase.id}#change-define`);
}


export async function updateRecoveryDisruption(formData: FormData) {
  const disruptionId = requiredText(formData, "disruptionId");
  const rawType = requiredText(formData, "resourceType");
  const resourceId = requiredText(formData, "resourceId");
  const startDate = dateValue(
    requiredText(formData, "startDate"),
    "startDate",
  );
  const endDate = dateValue(
    requiredText(formData, "endDate"),
    "endDate",
  );

  if (endDate < startDate) {
    throw new Error("endDate cannot be before startDate.");
  }

  if (
    rawType !== RecoveryDisruptionType.INSTRUCTOR_UNAVAILABLE &&
    rawType !== RecoveryDisruptionType.ROOM_UNAVAILABLE
  ) {
    throw new Error("Invalid disruption type.");
  }

  const type = rawType as RecoveryDisruptionType;
  const before = await prisma.recoveryDisruption.findUnique({
    where: {
      id: disruptionId,
    },
    include: {
      recoveryCase: true,
    },
  });

  if (!before || !before.active) {
    throw new Error("Active recovery disruption not found.");
  }

  if (
    before.recoveryCase.status === RecoveryCaseStatus.GENERATING ||
    before.recoveryCase.status === RecoveryCaseStatus.ACCEPTED ||
    before.recoveryCase.status === RecoveryCaseStatus.CLOSED
  ) {
    throw new Error(
      `Recovery case cannot be edited while ${before.recoveryCase.status}.`,
    );
  }

  const label = await resourceLabel(
    before.tenantId,
    type,
    resourceId,
  );
  const correlationId = randomUUID();

  const updatedCase = await prisma.$transaction(async (tx) => {
    const after = await tx.recoveryDisruption.update({
      where: {
        id: before.id,
      },
      data: {
        type,
        resourceId,
        resourceLabel: label,
        startDate,
        endDate,
      },
    });

    const recoveryCase = await invalidateCurrentRecoveryProposal(
      tx,
      before.recoveryCaseId,
    );

    await writeAuditEvent(tx, {
      tenantId: before.tenantId,
      eventType: "UPDATED",
      entityType: "RecoveryDisruption",
      entityId: before.id,
      actor: DEMO_ACTOR,
      description: `Recovery disruption updated: ${label}.`,
      source: "planning.recovery-case",
      correlationId,
      planId: before.recoveryCase.planId,
      scenarioId: before.recoveryCase.baseScenarioId,
      beforeState: {
        type: before.type,
        resourceId: before.resourceId,
        resourceLabel: before.resourceLabel,
        startDate: before.startDate.toISOString().slice(0, 10),
        endDate: before.endDate.toISOString().slice(0, 10),
        caseVersion: before.recoveryCase.version,
      },
      afterState: {
        type: after.type,
        resourceId: after.resourceId,
        resourceLabel: after.resourceLabel,
        startDate: after.startDate.toISOString().slice(0, 10),
        endDate: after.endDate.toISOString().slice(0, 10),
        caseVersion: recoveryCase.version,
      },
      context: {
        recoveryCaseId: before.recoveryCaseId,
        previousCurrentProposalMarkedStale: true,
      },
    });

    return recoveryCase;
  });

  revalidatePath("/planning");
  revalidatePath("/history");
  redirect(`/planning?case=${updatedCase.id}#change-define`);
}

export async function removeRecoveryDisruption(formData: FormData) {
  const disruptionId = requiredText(formData, "disruptionId");

  const before = await prisma.recoveryDisruption.findUnique({
    where: {
      id: disruptionId,
    },
    include: {
      recoveryCase: true,
    },
  });

  if (!before || !before.active) {
    throw new Error("Active recovery disruption not found.");
  }

  if (
    before.recoveryCase.status === RecoveryCaseStatus.GENERATING ||
    before.recoveryCase.status === RecoveryCaseStatus.ACCEPTED ||
    before.recoveryCase.status === RecoveryCaseStatus.CLOSED
  ) {
    throw new Error(
      `Recovery case cannot be edited while ${before.recoveryCase.status}.`,
    );
  }

  const correlationId = randomUUID();

  const updatedCase = await prisma.$transaction(async (tx) => {
    const after = await tx.recoveryDisruption.update({
      where: {
        id: before.id,
      },
      data: {
        active: false,
      },
    });

    const recoveryCase = await invalidateCurrentRecoveryProposal(
      tx,
      before.recoveryCaseId,
    );

    await writeAuditEvent(tx, {
      tenantId: before.tenantId,
      eventType: "DEACTIVATED",
      entityType: "RecoveryDisruption",
      entityId: before.id,
      actor: DEMO_ACTOR,
      description: `Recovery disruption removed: ${before.resourceLabel}.`,
      source: "planning.recovery-case",
      correlationId,
      planId: before.recoveryCase.planId,
      scenarioId: before.recoveryCase.baseScenarioId,
      beforeState: {
        active: before.active,
        type: before.type,
        resourceId: before.resourceId,
        resourceLabel: before.resourceLabel,
        startDate: before.startDate.toISOString().slice(0, 10),
        endDate: before.endDate.toISOString().slice(0, 10),
        caseVersion: before.recoveryCase.version,
      },
      afterState: {
        active: after.active,
        caseVersion: recoveryCase.version,
      },
      context: {
        recoveryCaseId: before.recoveryCaseId,
        previousCurrentProposalMarkedStale: true,
      },
    });

    return recoveryCase;
  });

  revalidatePath("/planning");
  revalidatePath("/history");
  redirect(`/planning?case=${updatedCase.id}#change-define`);
}

export async function queueRecoveryCaseJob(formData: FormData) {
  const recoveryCaseId = requiredText(formData, "recoveryCaseId");
  const correlationId = randomUUID();

  const recoveryCase = await prisma.recoveryCase.findUnique({
    where: { id: recoveryCaseId },
    include: {
      disruptions: { where: { active: true } },
      plan: true,
      baseScenario: true,
    },
  });
  if (!recoveryCase) throw new Error("Recovery case not found.");
  if (recoveryCase.disruptions.length === 0) {
    throw new Error("Recovery case has no active disruptions.");
  }

  const [existingActiveJob, previousFailedCount] =
    await Promise.all([
      prisma.solverJob.findFirst({
        where: {
          tenantId: recoveryCase.tenantId,
          recoveryCaseId,
          status: {
            in: [
              SolverJobStatus.QUEUED,
              SolverJobStatus.RUNNING,
            ],
          },
        },
      }),
      prisma.solverJob.count({
        where: {
          tenantId: recoveryCase.tenantId,
          recoveryCaseId,
          status: SolverJobStatus.FAILED,
        },
      }),
    ]);
  if (existingActiveJob) {
    redirect(`/planning?case=${recoveryCaseId}&job=${existingActiveJob.id}#change-calculate`);
  }

  const job = await prisma.$transaction(async (tx) => {
    await tx.recoveryCase.update({
      where: { id: recoveryCaseId },
      data: { status: RecoveryCaseStatus.GENERATING },
    });

    const created = await tx.solverJob.create({
      data: {
        tenantId: recoveryCase.tenantId,
        planScenarioId: recoveryCase.baseScenarioId,
        recoveryCaseId,
        status: SolverJobStatus.QUEUED,
        config: {
          schemaVersion: "1.0",
          type: "RECOVERY_CASE",
          recoveryCaseId,
          caseVersion: recoveryCase.version,
          baseScenarioId: recoveryCase.baseScenarioId,
          planId: recoveryCase.planId,
          correlationId,
          requestedByName: DEMO_ACTOR.name,
          disruptionCount: recoveryCase.disruptions.length,
          executionMode: "QUEUE_WORKER",
        } satisfies Prisma.InputJsonValue,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: recoveryCase.tenantId,
      eventType: "CREATED",
      entityType: "SolverJob",
      entityId: created.id,
      actor: DEMO_ACTOR,
      description:
        previousFailedCount > 0
          ? `Recovery case retry queued with ${recoveryCase.disruptions.length} disruption(s).`
          : `Recovery case queued with ${recoveryCase.disruptions.length} disruption(s).`,
      source: "planning.recovery-case.queue",
      correlationId,
      planId: recoveryCase.planId,
      scenarioId: recoveryCase.baseScenarioId,
      afterState: {
        status: created.status,
        recoveryCaseId,
        caseVersion: recoveryCase.version,
      },
      context: {
        attemptNumber: previousFailedCount + 1,
        retry: previousFailedCount > 0,
        disruptionCount: recoveryCase.disruptions.length,
      },
    });

    return created;
  });

  revalidatePath("/planning");
  redirect(`/planning?case=${recoveryCaseId}&job=${job.id}#change-calculate`);
}


export async function updateRecoveryApprovalPolicy(formData: FormData) {
  const tenantId = requiredText(formData, "tenantId");
  const value = requiredText(formData, "approvalRequired");
  const approvalRequired = value === "true";

  if (value !== "true" && value !== "false") {
    throw new Error("Invalid approval policy value.");
  }

  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        recoveryApprovalRequired: true,
      },
    });

    if (!before) throw new Error("Tenant not found.");

    const after = await tx.tenant.update({
      where: { id: tenantId },
      data: { recoveryApprovalRequired: approvalRequired },
      select: {
        id: true,
        recoveryApprovalRequired: true,
      },
    });

    await writeAuditEvent(tx, {
      tenantId,
      eventType: "UPDATED",
      entityType: "Tenant",
      entityId: tenantId,
      actor: DEMO_ACTOR,
      description: approvalRequired
        ? "Recovery approval policy enabled."
        : "Recovery approval policy disabled.",
      source: "planning.recovery-policy",
      correlationId,
      beforeState: {
        recoveryApprovalRequired: before.recoveryApprovalRequired,
      },
      afterState: {
        recoveryApprovalRequired: after.recoveryApprovalRequired,
      },
      context: {
        note:
          "The policy is snapshotted when a new Recovery Case is created. Existing cases keep their original approval requirement.",
      },
    });
  });

  revalidatePath("/planning");
  revalidatePath("/history");
  redirect("/planning#change-approval");
}

async function assertRecoveryBaselineFresh(
  tx: Prisma.TransactionClient,
  recoveryCaseId: string,
) {
  const recoveryCase = await tx.recoveryCase.findUnique({
    where: { id: recoveryCaseId },
    include: {
      plan: true,
    },
  });

  if (!recoveryCase) throw new Error("Recovery case not found.");

  if (recoveryCase.plan.version !== recoveryCase.basePlanVersion) {
    throw new Error(
      "Recovery case baseline is no longer current. Recalculation is required.",
    );
  }

  const newerControlledPlan = await tx.plan.findFirst({
    where: {
      tenantId: recoveryCase.tenantId,
      planningScopeId: recoveryCase.plan.planningScopeId,
      version: { gt: recoveryCase.basePlanVersion },
      status: {
        in: ["APPROVED", "PUBLISHED"],
      },
    },
    select: { id: true, version: true, status: true },
    orderBy: { version: "desc" },
  });

  if (newerControlledPlan) {
    throw new Error(
      `Recovery case baseline is stale because plan v${newerControlledPlan.version} is ${newerControlledPlan.status}. Recalculation is required.`,
    );
  }

  return recoveryCase;
}

export async function submitRecoveryCaseForReview(
  formData: FormData,
) {
  const recoveryCaseId = requiredText(formData, "recoveryCaseId");
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const recoveryCase =
      await assertRecoveryBaselineFresh(tx, recoveryCaseId);

    if (!recoveryCase.approvalRequired) {
      throw new Error("Approval is not required for this recovery case.");
    }

    if (
      recoveryCase.status !== RecoveryCaseStatus.ACCEPTED ||
      !recoveryCase.acceptedScenarioId
    ) {
      throw new Error(
        "Accept a recovery proposal before submitting for review.",
      );
    }

    const template = await tx.planReviewWorkflow.findFirst({
      where: {
        tenantId: recoveryCase.tenantId,
        planId: recoveryCase.planId,
      },
      include: {
        steps: {
          orderBy: [
            { stage: "asc" },
            { position: "asc" },
          ],
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!template || template.steps.length === 0) {
      throw new Error(
        "No review workflow is configured for this plan.",
      );
    }

    const existingSteps = await tx.recoveryCaseReviewStep.findMany({
      where: {
        recoveryCaseId,
        caseVersion: recoveryCase.version,
      },
      select: { id: true },
    });

    if (existingSteps.length === 0) {
      for (const step of template.steps) {
        await tx.recoveryCaseReviewStep.create({
          data: {
            tenantId: recoveryCase.tenantId,
            recoveryCaseId,
            caseVersion: recoveryCase.version,
            stage: step.stage,
            position: step.position,
            name: step.name,
            reviewerRole: step.reviewerRole,
            reviewerId: step.reviewerId,
            required: step.required,
            status: PlanReviewStepStatus.PENDING,
          },
        });
      }
    }

    const orderedSteps = await tx.recoveryCaseReviewStep.findMany({
      where: {
        recoveryCaseId,
        caseVersion: recoveryCase.version,
      },
      orderBy: [
        { stage: "asc" },
        { position: "asc" },
      ],
    });

    const firstRequired =
      orderedSteps.find((step) => step.required) ??
      orderedSteps[0];

    if (!firstRequired) {
      throw new Error("Recovery review workflow has no steps.");
    }

    for (const step of orderedSteps) {
      await tx.recoveryCaseReviewStep.update({
        where: { id: step.id },
        data: {
          status:
            step.id === firstRequired.id
              ? PlanReviewStepStatus.READY
              : PlanReviewStepStatus.PENDING,
          reviewerName: null,
          startedAt: null,
          completedAt: null,
        },
      });
    }

    const after = await tx.recoveryCase.update({
      where: { id: recoveryCaseId },
      data: {
        reviewStatus: RecoveryCaseReviewStatus.PENDING,
        submittedForReviewAt: new Date(),
        approvedAt: null,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: recoveryCase.tenantId,
      eventType: "SUBMITTED",
      entityType: "RecoveryCase",
      entityId: recoveryCase.id,
      actor: DEMO_ACTOR,
      description: `Recovery case v${recoveryCase.version} submitted for review.`,
      source: "planning.recovery-review",
      correlationId,
      planId: recoveryCase.planId,
      scenarioId: recoveryCase.acceptedScenarioId,
      beforeState: {
        reviewStatus: recoveryCase.reviewStatus,
      },
      afterState: {
        reviewStatus: after.reviewStatus,
        firstReadyStepId: firstRequired.id,
      },
      context: {
        caseVersion: recoveryCase.version,
        templateWorkflowId: template.id,
      },
    });
  });

  revalidatePath("/planning");
  revalidatePath("/history");
  redirect(`/planning?case=${recoveryCaseId}#change-approval`);
}

export async function decideRecoveryCaseReviewStep(
  formData: FormData,
) {
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

  const recoveryCaseId = await prisma.$transaction(
    async (tx) => {
      const step = await tx.recoveryCaseReviewStep.findUnique({
        where: { id: stepId },
        include: {
          recoveryCase: true,
        },
      });

      if (!step) throw new Error("Recovery review step not found.");

      if (
        step.status !== PlanReviewStepStatus.READY &&
        step.status !== PlanReviewStepStatus.IN_REVIEW
      ) {
        throw new Error("Recovery review step is not ready.");
      }

      await assertRecoveryBaselineFresh(
        tx,
        step.recoveryCaseId,
      );

      const now = new Date();

      await tx.recoveryCaseReviewDecision.create({
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
        await tx.recoveryCaseReviewStep.update({
          where: { id: step.id },
          data: {
            status: PlanReviewStepStatus.APPROVED,
            reviewerName:
              step.reviewerName ?? DEMO_ACTOR.name,
            startedAt: step.startedAt ?? now,
            completedAt: now,
          },
        });

        const remaining =
          await tx.recoveryCaseReviewStep.findFirst({
            where: {
              recoveryCaseId: step.recoveryCaseId,
              caseVersion: step.caseVersion,
              required: true,
              id: { not: step.id },
              status: {
                not: PlanReviewStepStatus.APPROVED,
              },
            },
            orderBy: [
              { stage: "asc" },
              { position: "asc" },
            ],
          });

        if (remaining) {
          await tx.recoveryCaseReviewStep.update({
            where: { id: remaining.id },
            data: {
              status: PlanReviewStepStatus.READY,
            },
          });

          await tx.recoveryCase.update({
            where: { id: step.recoveryCaseId },
            data: {
              reviewStatus:
                RecoveryCaseReviewStatus.IN_REVIEW,
            },
          });
        } else {
          await tx.recoveryCase.update({
            where: { id: step.recoveryCaseId },
            data: {
              reviewStatus:
                RecoveryCaseReviewStatus.APPROVED,
              approvedAt: now,
            },
          });
        }
      } else {
        const returned =
          decision ===
          PlanReviewDecisionType.RETURN_FOR_CHANGES;

        await tx.recoveryCaseReviewStep.update({
          where: { id: step.id },
          data: {
            status: returned
              ? PlanReviewStepStatus.RETURNED
              : PlanReviewStepStatus.REJECTED,
            reviewerName:
              step.reviewerName ?? DEMO_ACTOR.name,
            startedAt: step.startedAt ?? now,
            completedAt: now,
          },
        });

        await tx.recoveryCase.update({
          where: { id: step.recoveryCaseId },
          data: {
            reviewStatus: returned
              ? RecoveryCaseReviewStatus.RETURNED
              : RecoveryCaseReviewStatus.REJECTED,
            approvedAt: null,
          },
        });
      }

      await writeAuditEvent(tx, {
        tenantId: step.tenantId,
        eventType:
          decision === PlanReviewDecisionType.APPROVE
            ? "APPROVED"
            : "REJECTED",
        entityType: "RecoveryCaseReviewStep",
        entityId: step.id,
        actor: DEMO_ACTOR,
        description:
          decision === PlanReviewDecisionType.APPROVE
            ? `Recovery review step approved: ${step.name}.`
            : returnedDescription(decision, step.name),
        source: "planning.recovery-review",
        correlationId,
        planId: step.recoveryCase.planId,
        scenarioId:
          step.recoveryCase.acceptedScenarioId,
        beforeState: {
          stepStatus: step.status,
          reviewStatus: step.recoveryCase.reviewStatus,
        },
        afterState: {
          decision,
          comment,
        },
        context: {
          recoveryCaseId: step.recoveryCaseId,
          caseVersion: step.caseVersion,
          reviewerRole: step.reviewerRole,
        },
      });

      return step.recoveryCaseId;
    },
  );

  revalidatePath("/planning");
  revalidatePath("/history");
  redirect(`/planning?case=${recoveryCaseId}#change-approval`);
}

function returnedDescription(
  decision: PlanReviewDecisionType,
  stepName: string,
) {
  return decision === PlanReviewDecisionType.RETURN_FOR_CHANGES
    ? `Recovery case returned for changes from review step: ${stepName}.`
    : `Recovery review step rejected: ${stepName}.`;
}
