"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { writeAuditEvent } from "@/lib/audit";
import {
  dateKey,
  distributeMinutes,
  endOfUtcDay,
  overlapsDay,
  startOfUtcMonday,
  type WeekCapacity,
} from "@/lib/planning/base-plan";
import { prisma } from "@/lib/prisma";

const DEMO_ACTOR = { name: "Ola Solem" };

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function hoursToMinutes(formData: FormData, key: string, required = false) {
  const raw = formData.get(key);
  if (typeof raw !== "string" || !raw.trim()) {
    if (required) throw new Error(`${key} is required.`);
    return null;
  }

  const hours = Number(raw.replace(",", "."));
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`${key} must be a non-negative number.`);
  }

  return Math.round(hours * 60);
}

function returnToBasePlan(message: string) {
  revalidatePath("/planning/base-plan");
  revalidatePath("/planning");
  revalidatePath("/history");
  redirect(`/planning/base-plan?status=${encodeURIComponent(message)}`);
}

function returnToBasePlanError(message: string): never {
  redirect(`/planning/base-plan?error=${encodeURIComponent(message)}`);
}

function displayHours(minutes: number) {
  const value = minutes / 60;
  return Number.isInteger(value)
    ? `${value} h`
    : `${Number(value.toFixed(2))} h`;
}

export async function saveTeachingRequirement(formData: FormData) {
  const tenantId = requiredText(formData, "tenantId");
  const planId = requiredText(formData, "planId");
  const academicPeriodId = requiredText(formData, "academicPeriodId");
  const teachingGroupId = requiredText(formData, "teachingGroupId");
  const totalMinutes = hoursToMinutes(formData, "totalHours", true)!;
  const minWeeklyMinutes = hoursToMinutes(formData, "minWeeklyHours");
  const preferredWeeklyMinutes = hoursToMinutes(formData, "preferredWeeklyHours");
  const maxWeeklyMinutes = hoursToMinutes(formData, "maxWeeklyHours");
  const distributionMode = requiredText(formData, "distributionMode");
  const priority = requiredText(formData, "priority");
  const carryoverAllowed = formData.get("carryoverAllowed") === "on";

  if (![
    "EVEN_BY_TEACHING_CAPACITY",
    "EVEN_BY_WEEK",
    "FLEXIBLE",
  ].includes(distributionMode)) {
    throw new Error("Invalid distribution mode.");
  }

  if (!["LOW", "NORMAL", "HIGH", "CRITICAL"].includes(priority)) {
    throw new Error("Invalid requirement priority.");
  }

  if (
    minWeeklyMinutes !== null &&
    preferredWeeklyMinutes !== null &&
    minWeeklyMinutes > preferredWeeklyMinutes
  ) {
    throw new Error("Minimum weekly hours cannot exceed preferred weekly hours.");
  }

  if (
    preferredWeeklyMinutes !== null &&
    maxWeeklyMinutes !== null &&
    preferredWeeklyMinutes > maxWeeklyMinutes
  ) {
    throw new Error("Preferred weekly hours cannot exceed maximum weekly hours.");
  }

  if (
    minWeeklyMinutes !== null &&
    maxWeeklyMinutes !== null &&
    minWeeklyMinutes > maxWeeklyMinutes
  ) {
    throw new Error("Minimum weekly hours cannot exceed maximum weekly hours.");
  }

  const plan = await prisma.plan.findFirst({
    where: {
      id: planId,
      tenantId,
      academicPeriodId,
    },
  });

  if (!plan) {
    throw new Error("Base Plan revision not found.");
  }

  if (!["DRAFT", "GENERATED", "REVIEWED"].includes(plan.status)) {
    throw new Error(
      `Plan v${plan.version} is ${plan.status.toLowerCase()} and cannot be edited. Create a new revision first.`,
    );
  }

  const group = await prisma.teachingGroup.findFirst({
    where: {
      id: teachingGroupId,
      tenantId,
      academicPeriodId,
      status: { not: "ARCHIVED" },
    },
    include: { course: true },
  });

  if (!group) throw new Error("Teaching group not found in this academic period.");

  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.teachingRequirement.findUnique({
      where: {
        tenantId_planId_teachingGroupId: {
          tenantId,
          planId,
          teachingGroupId,
        },
      },
    });

    const after = await tx.teachingRequirement.upsert({
      where: {
        tenantId_planId_teachingGroupId: {
          tenantId,
          planId,
          teachingGroupId,
        },
      },
      update: {
        totalMinutes,
        minWeeklyMinutes,
        preferredWeeklyMinutes,
        maxWeeklyMinutes,
        distributionMode: distributionMode as
          | "EVEN_BY_TEACHING_CAPACITY"
          | "EVEN_BY_WEEK"
          | "FLEXIBLE",
        carryoverAllowed,
        priority: priority as "LOW" | "NORMAL" | "HIGH" | "CRITICAL",
        active: true,
      },
      create: {
        tenantId,
        planId,
        academicPeriodId,
        teachingGroupId,
        totalMinutes,
        minWeeklyMinutes,
        preferredWeeklyMinutes,
        maxWeeklyMinutes,
        distributionMode: distributionMode as
          | "EVEN_BY_TEACHING_CAPACITY"
          | "EVEN_BY_WEEK"
          | "FLEXIBLE",
        carryoverAllowed,
        priority: priority as "LOW" | "NORMAL" | "HIGH" | "CRITICAL",
      },
    });

    // Any requirement change invalidates the old week-by-week target distribution.
    await tx.teachingRequirementWeek.deleteMany({
      where: {
        tenantId,
        teachingRequirementId: after.id,
      },
    });

    await writeAuditEvent(tx, {
      tenantId,
      eventType: before ? "UPDATED" : "CREATED",
      entityType: "TeachingRequirement",
      entityId: after.id,
      actor: DEMO_ACTOR,
      description: `${group.code ?? group.name} ${group.course.code ?? group.course.name} teaching requirement ${before ? "updated" : "created"}.`,
      source: "planning.base-plan.requirement",
      correlationId,
      beforeState: before,
      afterState: after,
      context: {
        planId,
        planVersion: plan.version,
        academicPeriodId,
        teachingGroupId,
        weeklyAllocationsInvalidated: true,
      },
    });
  });

  returnToBasePlan("requirement-saved");
}

export async function generateBasePlanAllocations(formData: FormData) {
  const tenantId = requiredText(formData, "tenantId");
  const planId = requiredText(formData, "planId");
  const academicPeriodId = requiredText(formData, "academicPeriodId");

  const plan = await prisma.plan.findFirst({
    where: {
      id: planId,
      tenantId,
      academicPeriodId,
    },
  });

  if (!plan) {
    throw new Error("Base Plan revision not found.");
  }

  if (!["DRAFT", "GENERATED", "REVIEWED"].includes(plan.status)) {
    throw new Error(
      `Plan v${plan.version} is ${plan.status.toLowerCase()} and cannot be recalculated. Create a new revision first.`,
    );
  }

  const period = await prisma.academicPeriod.findFirst({
    where: { id: academicPeriodId, tenantId, active: true },
  });

  if (!period) throw new Error("Academic period not found.");

  const [calendarDays, exceptions, requirements] = await Promise.all([
    prisma.calendarDay.findMany({
      where: {
        tenantId,
        academicPeriodId,
        date: { gte: period.startDate, lte: period.endDate },
      },
      orderBy: { date: "asc" },
    }),
    prisma.planningException.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        impactMode: "BLOCK",
        startAt: { lt: endOfUtcDay(period.endDate) },
        endAt: { gt: period.startDate },
      },
    }),
    prisma.teachingRequirement.findMany({
      where: {
        tenantId,
        planId,
        academicPeriodId,
        active: true,
      },
      include: {
        teachingGroup: {
          include: { course: true, studentCohort: true },
        },
      },
      orderBy: { teachingGroup: { code: "asc" } },
    }),
  ]);

  if (calendarDays.length === 0) {
    throw new Error("The academic period has no materialised calendar days.");
  }

  if (requirements.length === 0) {
    throw new Error("No active teaching requirements are configured.");
  }

  const generated = requirements.map((requirement) => {
    const weekMap = new Map<string, WeekCapacity>();

    for (const day of calendarDays) {
      const monday = startOfUtcMonday(day.date);
      const key = dateKey(monday);
      const current = weekMap.get(key) ?? {
        weekStartDate: monday,
        calendarTeachingDays: 0,
        availableTeachingDays: 0,
        adjustmentReason: null,
      };

      if (day.teachingAllowed) {
        current.calendarTeachingDays += 1;

        const blocked = exceptions.some((exception) => {
          const globalClosure =
            exception.type === "SCHOOL_CLOSED" &&
            !exception.instructorId &&
            !exception.studentId &&
            !exception.roomId &&
            !exception.locationId &&
            !exception.organisationUnitId &&
            !exception.studentCohortId &&
            !exception.teachingGroupId;
          const targetsGroup = exception.teachingGroupId === requirement.teachingGroupId;
          const targetsCohort =
            Boolean(requirement.teachingGroup.studentCohortId) &&
            exception.studentCohortId === requirement.teachingGroup.studentCohortId;

          return (globalClosure || targetsGroup || targetsCohort) &&
            overlapsDay(exception.startAt, exception.endAt, day.date);
        });

        if (!blocked) {
          current.availableTeachingDays += 1;
        } else {
          current.adjustmentReason = "Blocking planning exception reduces teaching capacity";
        }
      }

      weekMap.set(key, current);
    }

    const weeks = Array.from(weekMap.values()).sort(
      (left, right) => left.weekStartDate.getTime() - right.weekStartDate.getTime(),
    );

    const quantumMinutes = Math.max(
      requirement.teachingGroup.course.minSessionMinutes ?? 45,
      1,
    );

    const activeWeekCount = weeks.filter(
      (week) => week.availableTeachingDays > 0,
    ).length;

    const groupLabel =
      requirement.teachingGroup.code ??
      requirement.teachingGroup.name;
    const courseLabel =
      requirement.teachingGroup.course.code ??
      requirement.teachingGroup.course.name;
    const requirementLabel = `${groupLabel} · ${courseLabel}`;

    if (
      requirement.minWeeklyMinutes !== null &&
      requirement.totalMinutes <
        requirement.minWeeklyMinutes * activeWeekCount
    ) {
      returnToBasePlanError(
        `${requirementLabel}: ${displayHours(requirement.totalMinutes)} for the period is too low for a minimum of ${displayHours(requirement.minWeeklyMinutes)} per teaching week across ${activeWeekCount} weeks. Reduce Min h/w or increase the period total.`,
      );
    }

    if (
      requirement.maxWeeklyMinutes !== null &&
      requirement.totalMinutes >
        requirement.maxWeeklyMinutes * activeWeekCount
    ) {
      returnToBasePlanError(
        `${requirementLabel}: ${displayHours(requirement.totalMinutes)} cannot fit within a maximum of ${displayHours(requirement.maxWeeklyMinutes)} per teaching week across ${activeWeekCount} weeks. Increase Max h/w or reduce the period total.`,
      );
    }

    let allocations;

    try {
      allocations = distributeMinutes({
        totalMinutes: requirement.totalMinutes,
        quantumMinutes,
        minWeeklyMinutes: requirement.minWeeklyMinutes,
        preferredWeeklyMinutes: requirement.preferredWeeklyMinutes,
        maxWeeklyMinutes: requirement.maxWeeklyMinutes,
        mode: requirement.distributionMode,
        weeks,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The weekly teaching demand could not be allocated.";

      returnToBasePlanError(
        `${requirementLabel}: ${message}`,
      );
    }

    return { requirement, allocations };
  });

  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    for (const item of generated) {
      await tx.teachingRequirementWeek.deleteMany({
        where: {
          tenantId,
          teachingRequirementId: item.requirement.id,
        },
      });

      await tx.teachingRequirementWeek.createMany({
        data: item.allocations.map((allocation) => ({
          tenantId,
          teachingRequirementId: item.requirement.id,
          weekStartDate: allocation.weekStartDate,
          targetMinutes: allocation.targetMinutes,
          minMinutes: item.requirement.minWeeklyMinutes,
          maxMinutes: item.requirement.maxWeeklyMinutes,
          availableTeachingDays: allocation.availableTeachingDays,
          adjustmentReason: allocation.adjustmentReason,
        })),
      });
    }

    await writeAuditEvent(tx, {
      tenantId,
      eventType: "GENERATED",
      entityType: "TeachingRequirementWeek",
      entityId: academicPeriodId,
      actor: DEMO_ACTOR,
      description: `Weekly base-plan demand generated for ${period.name}.`,
      source: "planning.base-plan.weekly-allocation",
      correlationId,
      context: {
        planId,
        planVersion: plan.version,
        academicPeriodId,
        requirementCount: generated.length,
        startDate: dateKey(period.startDate),
        endDate: dateKey(period.endDate),
        weekCount: generated[0]?.allocations.length ?? 0,
        totalMinutes: generated.reduce(
          (sum, item) => sum + item.requirement.totalMinutes,
          0,
        ),
      },
    });
  });


  returnToBasePlan("allocations-generated");
}

export async function createBasePlanRevision(formData: FormData) {
  const tenantId = requiredText(formData, "tenantId");
  const sourcePlanId = requiredText(formData, "sourcePlanId");
  const correlationId = randomUUID();

  const createdPlan = await prisma.$transaction(async (tx) => {
    const source = await tx.plan.findFirst({
      where: {
        id: sourcePlanId,
        tenantId,
      },
      include: {
        teachingRequirements: {
          include: {
            weeklyAllocations: {
              orderBy: { weekStartDate: "asc" },
            },
          },
        },
      },
    });

    if (!source) {
      throw new Error("Published Base Plan revision not found.");
    }

    if (source.status !== "PUBLISHED") {
      throw new Error(
        "A new Base Plan revision must be created from the published revision.",
      );
    }

    const newer = await tx.plan.findFirst({
      where: {
        tenantId,
        planningScopeId: source.planningScopeId,
        version: { gt: source.version },
        status: { not: "ARCHIVED" },
      },
      orderBy: { version: "desc" },
    });

    if (newer) {
      throw new Error(
        `Plan v${newer.version} already exists. Continue that revision instead.`,
      );
    }

    const highestVersion = await tx.plan.aggregate({
      where: {
        tenantId,
        planningScopeId: source.planningScopeId,
      },
      _max: { version: true },
    });

    const nextVersion =
      (highestVersion._max.version ?? source.version) + 1;

    const created = await tx.plan.create({
      data: {
        tenantId,
        planningScopeId: source.planningScopeId,
        academicPeriodId: source.academicPeriodId,
        name: source.name,
        version: nextVersion,
        status: "DRAFT",
        basedOnPlanId: source.id,
        planningAsOfDate: source.planningAsOfDate,
        frozenThroughDate: source.frozenThroughDate,
        planningStartDate: source.planningStartDate,
        planningEndDate: source.planningEndDate,
      },
    });

    for (const requirement of source.teachingRequirements) {
      await tx.teachingRequirement.create({
        data: {
          tenantId,
          planId: created.id,
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
              tenantId,
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

    await writeAuditEvent(tx, {
      tenantId,
      eventType: "CREATED",
      entityType: "Plan",
      entityId: created.id,
      actor: DEMO_ACTOR,
      description: `Base Plan revision v${created.version} created from published v${source.version}.`,
      source: "planning.base-plan.revision",
      correlationId,
      beforeState: {
        id: source.id,
        version: source.version,
        status: source.status,
      },
      afterState: created,
      context: {
        sourcePlanId: source.id,
        sourceVersion: source.version,
        newPlanId: created.id,
        newVersion: created.version,
        clonedRequirementCount:
          source.teachingRequirements.length,
      },
    });

    return created;
  });

  revalidatePath("/planning/base-plan");
  revalidatePath("/planning");
  revalidatePath("/planning/revisions");

  redirect(
    `/planning/base-plan?status=revision-created&version=${createdPlan.version}`,
  );
}
