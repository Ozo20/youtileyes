import "dotenv/config";

import { prisma } from "../src/lib/prisma";

type WeekCapacity = {
  weekStartDate: Date;
  calendarTeachingDays: number;
  availableTeachingDays: number;
  adjustmentReason: string | null;
};

type Allocation = WeekCapacity & {
  targetMinutes: number;
};

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcMonday(date: Date): Date {
  const result = new Date(`${dateKey(date)}T00:00:00.000Z`);
  const day = result.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  result.setUTCDate(result.getUTCDate() + offset);
  return result;
}

function endOfUtcDay(date: Date): Date {
  const result = new Date(`${dateKey(date)}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function overlapsDay(startAt: Date, endAt: Date, date: Date): boolean {
  const dayStart = new Date(`${dateKey(date)}T00:00:00.000Z`);
  const dayEnd = endOfUtcDay(date);
  return startAt < dayEnd && endAt > dayStart;
}

function distributeMinutes(args: {
  totalMinutes: number;
  quantumMinutes: number;
  maxWeeklyMinutes: number | null;
  mode: "EVEN_BY_TEACHING_CAPACITY" | "EVEN_BY_WEEK" | "FLEXIBLE";
  weeks: WeekCapacity[];
}): Allocation[] {
  const { totalMinutes, quantumMinutes, maxWeeklyMinutes, mode, weeks } = args;

  if (totalMinutes < 0) {
    throw new Error("Teaching requirement totalMinutes cannot be negative.");
  }

  const eligible = weeks.filter((week) => week.availableTeachingDays > 0);

  if (totalMinutes > 0 && eligible.length === 0) {
    throw new Error("No teaching capacity is available for a non-zero requirement.");
  }

  const weightFor = (week: WeekCapacity) => {
    if (week.availableTeachingDays === 0) {
      return 0;
    }

    if (mode === "EVEN_BY_WEEK") {
      return 1;
    }

    // FLEXIBLE currently uses capacity weighting as its neutral baseline.
    return week.availableTeachingDays;
  };

  const totalWeight = weeks.reduce((sum, week) => sum + weightFor(week), 0);
  const targets = new Map<string, number>();
  const fractions: Array<{ key: string; fraction: number }> = [];

  for (const week of weeks) {
    const key = dateKey(week.weekStartDate);
    const weight = weightFor(week);

    if (weight === 0 || totalMinutes === 0) {
      targets.set(key, 0);
      fractions.push({ key, fraction: 0 });
      continue;
    }

    const raw = (totalMinutes * weight) / totalWeight;
    const floor = Math.floor(raw / quantumMinutes) * quantumMinutes;
    const capped = maxWeeklyMinutes === null ? floor : Math.min(floor, maxWeeklyMinutes);

    targets.set(key, capped);
    fractions.push({ key, fraction: raw - floor });
  }

  let allocated = Array.from(targets.values()).reduce((sum, value) => sum + value, 0);
  let remaining = totalMinutes - allocated;

  const ranked = fractions
    .filter(({ key }) => {
      const week = weeks.find((item) => dateKey(item.weekStartDate) === key);
      return Boolean(week && week.availableTeachingDays > 0);
    })
    .sort((left, right) => right.fraction - left.fraction || left.key.localeCompare(right.key));

  while (remaining >= quantumMinutes) {
    let placed = false;

    for (const item of ranked) {
      const current = targets.get(item.key) ?? 0;
      const next = current + quantumMinutes;

      if (maxWeeklyMinutes !== null && next > maxWeeklyMinutes) {
        continue;
      }

      targets.set(item.key, next);
      remaining -= quantumMinutes;
      allocated += quantumMinutes;
      placed = true;

      if (remaining < quantumMinutes) {
        break;
      }
    }

    if (!placed) {
      throw new Error(
        `Unable to allocate ${remaining} remaining minutes within maxWeeklyMinutes constraints.`,
      );
    }
  }

  if (remaining > 0) {
    const target = ranked.find((item) => {
      const current = targets.get(item.key) ?? 0;
      return maxWeeklyMinutes === null || current + remaining <= maxWeeklyMinutes;
    });

    if (!target) {
      throw new Error(`Unable to allocate final ${remaining} minutes.`);
    }

    targets.set(target.key, (targets.get(target.key) ?? 0) + remaining);
    allocated += remaining;
    remaining = 0;
  }

  if (allocated !== totalMinutes) {
    throw new Error(`Allocation mismatch: ${allocated} != ${totalMinutes}.`);
  }

  return weeks.map((week) => ({
    ...week,
    targetMinutes: targets.get(dateKey(week.weekStartDate)) ?? 0,
  }));
}

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
  });

  if (!tenant) {
    throw new Error('Demo tenant "DEMO" was not found. Run npm run db:seed first.');
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

  for (const requirement of requirements) {
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
          const targetsGroup = exception.teachingGroupId === requirement.teachingGroupId;
          const targetsCohort =
            Boolean(requirement.teachingGroup.studentCohortId) &&
            exception.studentCohortId === requirement.teachingGroup.studentCohortId;

          if (!targetsGroup && !targetsCohort) {
            return false;
          }

          return overlapsDay(exception.startAt, exception.endAt, day.date);
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

    const quantumMinutes = Math.max(requirement.teachingGroup.course.minSessionMinutes ?? 45, 1);

    const allocations = distributeMinutes({
      totalMinutes: requirement.totalMinutes,
      quantumMinutes,
      maxWeeklyMinutes: requirement.maxWeeklyMinutes,
      mode: requirement.distributionMode,
      weeks,
    });

    await prisma.$transaction(async (tx) => {
      await tx.teachingRequirementWeek.deleteMany({
        where: {
          tenantId: tenant.id,
          teachingRequirementId: requirement.id,
        },
      });

      await tx.teachingRequirementWeek.createMany({
        data: allocations.map((allocation) => ({
          tenantId: tenant.id,
          teachingRequirementId: requirement.id,
          weekStartDate: allocation.weekStartDate,
          targetMinutes: allocation.targetMinutes,
          minMinutes: requirement.minWeeklyMinutes,
          maxMinutes: requirement.maxWeeklyMinutes,
          availableTeachingDays: allocation.availableTeachingDays,
          adjustmentReason: allocation.adjustmentReason,
        })),
      });
    });

    const total = allocations.reduce((sum, allocation) => sum + allocation.targetMinutes, 0);
    const affectedWeeks = allocations.filter(
      (allocation) => allocation.availableTeachingDays < allocation.calendarTeachingDays,
    );

    console.log(
      `${requirement.teachingGroup.code ?? requirement.teachingGroup.id}: ` +
        `${total} minutes across ${allocations.length} weeks; ` +
        `${affectedWeeks.length} week(s) adjusted by exceptions`,
    );
  }

  console.log("Teaching requirement allocations generated.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
