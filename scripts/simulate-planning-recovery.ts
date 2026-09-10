import "dotenv/config";

import { writeFile } from "node:fs/promises";

import {
  analyzeRequirementFeasibility,
  type FeasibilityRequirementInput,
} from "../src/lib/planning/feasibility";
import { simulateRequirementRecovery } from "../src/lib/planning/recovery";
import { prisma } from "../src/lib/prisma";

const OUTPUT_PATH = "/tmp/youtileyes_recovery.json";

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

async function buildInputs(): Promise<{
  plan: { id: string; name: string; planningStartDate: Date; planningEndDate: Date };
  inputs: FeasibilityRequirementInput[];
}> {
  const tenant = await prisma.tenant.findUnique({ where: { code: "DEMO" } });
  if (!tenant) throw new Error('Demo tenant "DEMO" was not found.');

  const planRecord = await prisma.plan.findFirst({
    where: { tenantId: tenant.id },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });
  if (!planRecord?.planningStartDate || !planRecord.planningEndDate) {
    throw new Error("Plan requires planningStartDate and planningEndDate.");
  }

  const planningStartDate = planRecord.planningStartDate;
  const planningEndDate = planRecord.planningEndDate;
  const planningEndExclusive = endOfUtcDay(planningEndDate);

  const requirements = await prisma.teachingRequirement.findMany({
    where: { tenantId: tenant.id, academicPeriodId: planRecord.academicPeriodId, active: true },
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
      .filter((week) => weekEnd(week.weekStartDate) > planningStartDate && week.weekStartDate <= planningEndDate)
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

  return {
    plan: { id: planRecord.id, name: planRecord.name, planningStartDate, planningEndDate },
    inputs,
  };
}

async function main() {
  const { plan, inputs } = await buildInputs();
  const requirements = inputs.map((input) => {
    const baseline = analyzeRequirementFeasibility(input);
    return {
      requirementId: input.requirementId,
      groupCode: input.groupCode,
      courseName: input.courseName,
      baseline,
      recovery: simulateRequirementRecovery(input).map(({ simulatedInput: _simulatedInput, ...option }) => option),
    };
  });

  const output = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    planId: plan.id,
    planName: plan.name,
    planningWindow: { startDate: dateKey(plan.planningStartDate), endDate: dateKey(plan.planningEndDate) },
    requirements,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log("=== YOUTILEYES RECOVERY SIMULATION ===");
  console.log(`Plan: ${plan.name}`);
  console.log(`Window: ${output.planningWindow.startDate} -> ${output.planningWindow.endDate}`);
  const red = requirements.filter((item) => item.baseline.status === "RED");
  if (red.length === 0) {
    console.log("No RED requirements. No recovery action is currently required.");
  } else {
    for (const item of red) {
      console.log(`\nRED ${item.groupCode} ${item.courseName}: margin ${item.baseline.marginMinutes} min`);
      for (const [index, option] of item.recovery.entries()) {
        console.log(
          `  ${index + 1}. ${option.title} -> ${option.resultingStatus} · margin ${option.resultingMarginMinutes} min · disruption ${option.disruptionScore}`,
        );
      }
    }
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
