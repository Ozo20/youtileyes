import "dotenv/config";

import {
  dateKey,
  distributeMinutes,
  endOfUtcDay,
  overlapsDay,
  rebalanceCohortWeeklyCapacity,
  startOfUtcMonday,
  type WeekCapacity,
} from "../src/lib/planning/base-plan";
import { prisma } from "../src/lib/prisma";

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
  });

  if (!tenant) {
    throw new Error(
      'Demo tenant "DEMO" was not found. Run npm run db:seed first.',
    );
  }

  const period = await prisma.academicPeriod.findFirst({
    where: {
      tenantId: tenant.id,
      code: "2026-AUTUMN",
      active: true,
    },
  });

  if (!period) {
    throw new Error('Academic period "2026-AUTUMN" was not found.');
  }

  const plan = await prisma.plan.findFirst({
    where: {
      tenantId: tenant.id,
      academicPeriodId: period.id,
      status: { not: "ARCHIVED" },
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });

  if (!plan) {
    throw new Error(
      `No Plan revision found for academic period "${period.code}".`,
    );
  }

  if (!["DRAFT", "GENERATED", "REVIEWED"].includes(plan.status)) {
    throw new Error(
      `Plan v${plan.version} is ${plan.status}. Weekly Base Plan allocations may only be regenerated on an editable revision.`,
    );
  }

  const calendarDays = await prisma.calendarDay.findMany({
    where: {
      tenantId: tenant.id,
      academicPeriodId: period.id,
      date: {
        gte: period.startDate,
        lte: period.endDate,
      },
    },
    orderBy: { date: "asc" },
  });

  if (calendarDays.length === 0) {
    throw new Error("No CalendarDay rows found for the academic period.");
  }

  const exceptions = await prisma.planningException.findMany({
    where: {
      tenantId: tenant.id,
      status: "ACTIVE",
      impactMode: "BLOCK",
      startAt: { lt: endOfUtcDay(period.endDate) },
      endAt: { gt: period.startDate },
    },
  });

  const requirements = await prisma.teachingRequirement.findMany({
    where: {
      tenantId: tenant.id,
      planId: plan.id,
      academicPeriodId: period.id,
      active: true,
    },
    include: {
      teachingGroup: {
        include: {
          course: true,
          studentCohort: true,
        },
      },
    },
    orderBy: {
      teachingGroup: {
        code: "asc",
      },
    },
  });

  if (requirements.length === 0) {
    throw new Error("No active TeachingRequirement rows found.");
  }

  const loadProfile = await prisma.loadProfile.findFirst({
    where: {
      tenantId: tenant.id,
      active: true,
    },
    orderBy: {
      code: "asc",
    },
  });

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

          const targetsGroup =
            exception.teachingGroupId === requirement.teachingGroupId;

          const targetsCohort =
            Boolean(requirement.teachingGroup.studentCohortId) &&
            exception.studentCohortId ===
              requirement.teachingGroup.studentCohortId;

          return (
            (globalClosure || targetsGroup || targetsCohort) &&
            overlapsDay(exception.startAt, exception.endAt, day.date)
          );
        });

        if (!blocked) {
          current.availableTeachingDays += 1;
        } else {
          current.adjustmentReason =
            "Blocking planning exception reduces teaching capacity";
        }
      }

      weekMap.set(key, current);
    }

    const weeks = Array.from(weekMap.values()).sort(
      (left, right) =>
        left.weekStartDate.getTime() - right.weekStartDate.getTime(),
    );

    const quantumMinutes = Math.max(
      requirement.teachingGroup.course.minSessionMinutes ?? 45,
      1,
    );

    const sessionMinutes = Math.max(
      requirement.teachingGroup.course.preferredSessionMinutes ??
        requirement.teachingGroup.course.minSessionMinutes ??
        45,
      1,
    );

    const allocations = distributeMinutes({
      totalMinutes: requirement.totalMinutes,
      quantumMinutes,
      minWeeklyMinutes: requirement.minWeeklyMinutes,
      preferredWeeklyMinutes: requirement.preferredWeeklyMinutes,
      maxWeeklyMinutes: requirement.maxWeeklyMinutes,
      mode: requirement.distributionMode,
      weeks,
    });

    return {
      requirement,
      allocations,
      quantumMinutes,
      sessionMinutes,
    };
  });

  const rebalanced = rebalanceCohortWeeklyCapacity({
    items: generated.map((item) => ({
      id: item.requirement.id,
      cohortId: item.requirement.teachingGroup.studentCohortId,
      priority: item.requirement.priority,
      carryoverAllowed: item.requirement.carryoverAllowed,
      minWeeklyMinutes: item.requirement.minWeeklyMinutes,
      maxWeeklyMinutes: item.requirement.maxWeeklyMinutes,
      quantumMinutes: item.quantumMinutes,
      sessionMinutes: item.sessionMinutes,
      allocations: item.allocations,
    })),
    limits: {
      maxSessionsPerDay: loadProfile?.maxSessionsPerDay ?? null,
      maxTeachingMinutesPerDay: loadProfile?.maxTeachingMinutesPerDay ?? null,
    },
  });

  const rebalancedByRequirementId = new Map(
    rebalanced.map((item) => [item.id, item]),
  );

  for (const item of generated) {
    const adjusted = rebalancedByRequirementId.get(item.requirement.id);

    if (!adjusted) {
      throw new Error(
        `Rebalanced allocation missing for requirement ${item.requirement.id}.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.teachingRequirementWeek.deleteMany({
        where: {
          tenantId: tenant.id,
          teachingRequirementId: item.requirement.id,
        },
      });

      await tx.teachingRequirementWeek.createMany({
        data: adjusted.allocations.map((allocation) => ({
          tenantId: tenant.id,
          teachingRequirementId: item.requirement.id,
          weekStartDate: allocation.weekStartDate,
          targetMinutes: allocation.targetMinutes,
          minMinutes: item.requirement.minWeeklyMinutes,
          maxMinutes: item.requirement.maxWeeklyMinutes,
          availableTeachingDays: allocation.availableTeachingDays,
          adjustmentReason: allocation.adjustmentReason,
        })),
      });
    });

    const total = adjusted.allocations.reduce(
      (sum, allocation) => sum + allocation.targetMinutes,
      0,
    );

    const affectedWeeks = adjusted.allocations.filter(
      (allocation) =>
        allocation.availableTeachingDays < allocation.calendarTeachingDays,
    );

    console.log(
      `${item.requirement.teachingGroup.code ?? item.requirement.teachingGroup.id}: ` +
        `${total} minutes across ${adjusted.allocations.length} weeks; ` +
        `${affectedWeeks.length} week(s) adjusted by exceptions/capacity`,
    );
  }

  console.log(
    `Teaching requirement allocations generated for Plan v${plan.version}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
