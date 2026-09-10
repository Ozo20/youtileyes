import "dotenv/config";

import { writeFile } from "node:fs/promises";

import {
  analyzeRequirementFeasibility,
  summarizeFeasibility,
  type FeasibilityRequirementInput,
} from "../src/lib/planning/feasibility";
import { prisma } from "../src/lib/prisma";

const OUTPUT_PATH = "/tmp/youtileyes_feasibility.json";

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


async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { code: "DEMO" } });
  if (!tenant) throw new Error('Demo tenant "DEMO" was not found.');

  const plan = await prisma.plan.findFirst({
    where: { tenantId: tenant.id },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });

  if (!plan?.planningStartDate || !plan.planningEndDate) {
    throw new Error("Plan requires planningStartDate and planningEndDate before feasibility analysis.");
  }

  const planningStartDate = plan.planningStartDate;
  const planningEndDate = plan.planningEndDate;
  const planningEndExclusive = endOfUtcDay(planningEndDate);

  const requirements = await prisma.teachingRequirement.findMany({
    where: {
      tenantId: tenant.id,
      academicPeriodId: plan.academicPeriodId,
      active: true,
    },
    include: {
      teachingGroup: { include: { course: true, studentCohort: true } },
      weeklyAllocations: { orderBy: { weekStartDate: "asc" } },
    },
    orderBy: { teachingGroup: { code: "asc" } },
  });

  const instructors = await prisma.instructorCourse.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { courseId: true, instructorId: true },
  });

  const rooms = await prisma.room.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { id: true },
  });

  const roomPreferences = await prisma.roomCoursePreference.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { roomId: true, courseId: true, suitability: true },
  });

  const exceptions = await prisma.planningException.findMany({
    where: {
      tenantId: tenant.id,
      status: "ACTIVE",
      impactMode: "BLOCK",
      startAt: { lt: planningEndExclusive },
      endAt: { gt: planningStartDate },
    },
  });

  const inputs: FeasibilityRequirementInput[] = requirements.map((requirement) => {
    const group = requirement.teachingGroup;
    const course = group.course;

    const weeks = requirement.weeklyAllocations
      .filter((week) => {
        const end = weekEnd(week.weekStartDate);
        return end > planningStartDate && week.weekStartDate <= planningEndDate;
      })
      .map((week) => ({
        weekStartDate: dateKey(week.weekStartDate),
        targetMinutes: week.targetMinutes,
        availableTeachingDays: week.availableTeachingDays,
        maxWeeklyMinutes: week.maxMinutes ?? requirement.maxWeeklyMinutes,
      }));

    const qualifiedInstructorCount = new Set(
      instructors.filter((item) => item.courseId === course.id).map((item) => item.instructorId),
    ).size;

    const prohibitedRoomIds = new Set(
      roomPreferences
        .filter((item) => item.courseId === course.id && item.suitability === "PROHIBITED")
        .map((item) => item.roomId),
    );
    const eligibleRoomCount = rooms.filter((room) => !prohibitedRoomIds.has(room.id)).length;

    const relevantExceptions = exceptions.filter((exception) => {
      const targetsGroup = exception.teachingGroupId === group.id;
      const targetsCohort = Boolean(group.studentCohortId) && exception.studentCohortId === group.studentCohortId;
      return targetsGroup || targetsCohort;
    });

    const blockedDates = new Set<string>();
    for (const exception of relevantExceptions) {
      const cursor = new Date(`${dateKey(exception.startAt)}T00:00:00.000Z`);
      const final = new Date(`${dateKey(exception.endAt)}T00:00:00.000Z`);
      while (cursor <= final) {
        if (cursor >= planningStartDate && cursor <= planningEndDate) blockedDates.add(dateKey(cursor));
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
      preferredWeeklyMinutes: requirement.preferredWeeklyMinutes,
      courseMaxSessionsPerDay: course.maxSessionsPerDay,
      coursePreferredSessionMinutes: course.preferredSessionMinutes,
      courseMaxSessionMinutes: course.maxSessionMinutes,
      qualifiedInstructorCount,
      eligibleRoomCount,
      blockedTeachingDays: blockedDates.size,
      weeks,
    };
  });

  const results = inputs.map(analyzeRequirementFeasibility);
  const summary = summarizeFeasibility(results);

  const output = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    tenantId: tenant.id,
    planId: plan.id,
    planName: plan.name,
    planningWindow: {
      startDate: dateKey(planningStartDate),
      endDate: dateKey(planningEndDate),
      frozenThroughDate: plan.frozenThroughDate ? dateKey(plan.frozenThroughDate) : null,
    },
    ...summary,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log("=== YOUTILEYES REQUIREMENT FEASIBILITY ===");
  console.log(`Plan: ${plan.name}`);
  console.log(`Window: ${output.planningWindow.startDate} -> ${output.planningWindow.endDate}`);
  console.log(`Overall: ${summary.status}`);
  console.log(`GREEN: ${summary.counts.GREEN} · AMBER: ${summary.counts.AMBER} · RED: ${summary.counts.RED}`);
  console.log("");

  for (const result of results) {
    const margin = result.marginMinutes >= 0 ? `+${result.marginMinutes}` : String(result.marginMinutes);
    console.log(
      `${result.status.padEnd(5)} ${result.groupCode} ${result.courseName}: ` +
        `required ${result.requiredMinutes} min · capacity ${result.estimatedCapacityMinutes} min · margin ${margin} min`,
    );
    for (const reason of result.reasons) console.log(`      - ${reason}`);
    for (const option of result.recoveryOptions.slice(0, 3)) console.log(`      -> ${option.title}`);
  }

  console.log(`\nReport: ${OUTPUT_PATH}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
