import {
  analyzeRequirementFeasibility,
  summarizeFeasibility,
  type FeasibilityRequirementInput,
  type FeasibilitySummary,
} from "./feasibility";

import { prisma } from "@/lib/prisma";

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function endOfUtcDay(date: Date): Date {
  const result = new Date(`${dateKey(date)}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function weekEnd(weekStart: Date): Date {
  const result = new Date(`${dateKey(weekStart)}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + 7);
  return result;
}

export async function getPlanFeasibility(
  tenantId: string,
  plan: {
    academicPeriodId: string;
    planningStartDate: Date | null;
    planningEndDate: Date | null;
  },
): Promise<FeasibilitySummary | null> {
  if (!plan.planningStartDate || !plan.planningEndDate) {
    return null;
  }

  const planningStartDate = plan.planningStartDate;
  const planningEndDate = plan.planningEndDate;
  const planningEndExclusive = endOfUtcDay(planningEndDate);

  const [
    requirements,
    instructors,
    rooms,
    roomPreferences,
    exceptions,
  ] = await Promise.all([
    prisma.teachingRequirement.findMany({
      where: {
        tenantId,
        academicPeriodId: plan.academicPeriodId,
        active: true,
      },
      include: {
        teachingGroup: {
          include: {
            course: true,
            studentCohort: true,
          },
        },
        weeklyAllocations: {
          orderBy: {
            weekStartDate: "asc",
          },
        },
      },
      orderBy: {
        teachingGroup: {
          code: "asc",
        },
      },
    }),
    prisma.instructorCourse.findMany({
      where: {
        tenantId,
        active: true,
      },
      select: {
        courseId: true,
        instructorId: true,
      },
    }),
    prisma.room.findMany({
      where: {
        tenantId,
        active: true,
      },
      select: {
        id: true,
      },
    }),
    prisma.roomCoursePreference.findMany({
      where: {
        tenantId,
        active: true,
      },
      select: {
        roomId: true,
        courseId: true,
        suitability: true,
      },
    }),
    prisma.planningException.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        impactMode: "BLOCK",
        startAt: {
          lt: planningEndExclusive,
        },
        endAt: {
          gt: planningStartDate,
        },
      },
    }),
  ]);

  const inputs: FeasibilityRequirementInput[] =
    requirements.map((requirement) => {
      const group = requirement.teachingGroup;
      const course = group.course;

      const weeks = requirement.weeklyAllocations
        .filter((week) => {
          const end = weekEnd(week.weekStartDate);
          return (
            end > planningStartDate &&
            week.weekStartDate <= planningEndDate
          );
        })
        .map((week) => ({
          weekStartDate: dateKey(week.weekStartDate),
          targetMinutes: week.targetMinutes,
          availableTeachingDays: week.availableTeachingDays,
          maxWeeklyMinutes:
            week.maxMinutes ?? requirement.maxWeeklyMinutes,
        }));

      const qualifiedInstructorCount = new Set(
        instructors
          .filter((item) => item.courseId === course.id)
          .map((item) => item.instructorId),
      ).size;

      const prohibitedRoomIds = new Set(
        roomPreferences
          .filter(
            (item) =>
              item.courseId === course.id &&
              item.suitability === "PROHIBITED",
          )
          .map((item) => item.roomId),
      );

      const eligibleRoomCount = rooms.filter(
        (room) => !prohibitedRoomIds.has(room.id),
      ).length;

      const relevantExceptions = exceptions.filter(
        (exception) => {
          const targetsGroup =
            exception.teachingGroupId === group.id;
          const targetsCohort =
            Boolean(group.studentCohortId) &&
            exception.studentCohortId === group.studentCohortId;

          return targetsGroup || targetsCohort;
        },
      );

      const blockedDates = new Set<string>();

      for (const exception of relevantExceptions) {
        const cursor = new Date(
          `${dateKey(exception.startAt)}T00:00:00.000Z`,
        );
        const final = new Date(
          `${dateKey(exception.endAt)}T00:00:00.000Z`,
        );

        while (cursor <= final) {
          if (
            cursor >= planningStartDate &&
            cursor <= planningEndDate
          ) {
            blockedDates.add(dateKey(cursor));
          }

          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }

      return {
        requirementId: requirement.id,
        groupCode: group.code ?? group.id,
        groupName: group.name,
        courseCode: course.code,
        courseName: course.name,
        carryoverAllowed: requirement.carryoverAllowed,
        preferredWeeklyMinutes:
          requirement.preferredWeeklyMinutes,
        courseMaxSessionsPerDay: course.maxSessionsPerDay,
        coursePreferredSessionMinutes:
          course.preferredSessionMinutes,
        courseMaxSessionMinutes: course.maxSessionMinutes,
        qualifiedInstructorCount,
        eligibleRoomCount,
        blockedTeachingDays: blockedDates.size,
        weeks,
      };
    });

  return summarizeFeasibility(
    inputs.map(analyzeRequirementFeasibility),
  );
}

export function jsonRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function jsonString(
  value: unknown,
  key: string,
): string | null {
  const record = jsonRecord(value);
  const candidate = record?.[key];

  return typeof candidate === "string" ? candidate : null;
}

export function jsonNumber(
  value: unknown,
  key: string,
): number | null {
  const record = jsonRecord(value);
  const candidate = record?.[key];

  return typeof candidate === "number" ? candidate : null;
}
