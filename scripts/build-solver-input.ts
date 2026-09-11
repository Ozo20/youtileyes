import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";

const SCHEMA_VERSION = "1.3";
const OUTPUT_PATH = "/tmp/youtileyes_solver_input.json";

function clock(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function startOfUtcMonday(date: Date): Date {
  const result = utcDate(dateKey(date));
  const weekday = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return result;
}

function endOfUtcDay(date: Date): Date {
  return addUtcDays(utcDate(dateKey(date)), 1);
}

function overlapsDay(startAt: Date, endAt: Date, date: Date): boolean {
  const start = utcDate(dateKey(date));
  const end = endOfUtcDay(date);
  return startAt < end && endAt > start;
}

function minuteOfUtcDay(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function qualificationPenalty(level: "PRIMARY" | "SECONDARY" | "SUPPORT"): number {
  switch (level) {
    case "PRIMARY":
      return 0;
    case "SECONDARY":
      return 30;
    case "SUPPORT":
      return 75;
  }
}

function exceptionBlockForDate(exception: { startAt: Date; endAt: Date }, date: Date) {
  const dayStart = utcDate(dateKey(date));
  const dayEnd = endOfUtcDay(date);
  const start = exception.startAt > dayStart ? exception.startAt : dayStart;
  const end = exception.endAt < dayEnd ? exception.endAt : dayEnd;

  return {
    startMinute: start <= dayStart ? 0 : minuteOfUtcDay(start),
    endMinute: end >= dayEnd ? 24 * 60 : minuteOfUtcDay(end),
  };
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { code: "DEMO" } });
  if (!tenant) {
    throw new Error('Demo tenant "DEMO" was not found. Run npm run db:seed first.');
  }

  const scenario = await prisma.planScenario.findFirst({
    where: { tenantId: tenant.id, name: "Initial solver scenario" },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
    },
  });
  if (!scenario) {
    throw new Error("Demo PlanScenario was not found.");
  }

  const { plan } = scenario;
  if (!plan.planningAsOfDate || !plan.planningStartDate || !plan.planningEndDate) {
    throw new Error("Plan requires planningAsOfDate, planningStartDate and planningEndDate.");
  }

  // Keep narrowed, non-null dates in local constants. TypeScript does not preserve
  // relation-field narrowing reliably across nested callbacks such as Array.filter().
  const planningAsOfDate = plan.planningAsOfDate;
  const planningStartDate = plan.planningStartDate;
  const planningEndDate = plan.planningEndDate;

  if (planningStartDate <= planningAsOfDate) {
    throw new Error("planningStartDate must be after planningAsOfDate for normal replanning.");
  }

  if (plan.frozenThroughDate && planningStartDate <= plan.frozenThroughDate) {
    throw new Error("planningStartDate must be after frozenThroughDate.");
  }

  if (planningEndDate < planningStartDate) {
    throw new Error("planningEndDate must be on or after planningStartDate.");
  }

  const rooms = await prisma.room.findMany({
    where: { tenantId: tenant.id, active: true },
    include: {
      coursePreferences: { where: { active: true } },
      staffingRequirements: {
        where: { active: true, source: "ROOM" },
        include: { requiredQualification: true },
      },
    },
    orderBy: { code: "asc" },
  });

  const instructors = await prisma.instructor.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" },
    include: {
      courses: { where: { active: true }, include: { course: true } },
      qualifications: {
        where: { active: true },
        include: { qualification: true },
      },
      teachingGroupPreferences: { where: { active: true } },
    },
    orderBy: { lastName: "asc" },
  });

  const teachingGroups = await prisma.teachingGroup.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" },
    include: {
      course: {
        include: {
          staffingRequirements: {
            where: { active: true, source: "COURSE" },
            include: { requiredQualification: true },
          },
        },
      },
      staffingRequirements: {
        where: { active: true, source: "TEACHING_GROUP" },
        include: { requiredQualification: true },
      },
      studentCohort: true,
      students: { include: { student: true } },
      instructorPreferences: { where: { active: true } },
    },
    orderBy: { code: "asc" },
  });

  const groupById = new Map(teachingGroups.map((group) => [group.id, group]));

  const loadProfile = await prisma.loadProfile.findFirst({
    where: { tenantId: tenant.id, active: true, code: "STANDARD" },
  });
  if (!loadProfile) {
    throw new Error('LoadProfile "STANDARD" was not found.');
  }

  const calendarDays = await prisma.calendarDay.findMany({
    where: {
      tenantId: tenant.id,
      date: { gte: planningStartDate, lte: planningEndDate },
    },
    orderBy: { date: "asc" },
  });
  if (calendarDays.length === 0) {
    throw new Error("No CalendarDay rows exist inside the planning horizon.");
  }

  const firstWeek = startOfUtcMonday(planningStartDate);
  const allocations = await prisma.teachingRequirementWeek.findMany({
    where: {
      tenantId: tenant.id,
      weekStartDate: { gte: firstWeek, lte: planningEndDate },
      teachingRequirement: {
        active: true,
        academicPeriodId: plan.academicPeriodId,
      },
    },
    include: {
      teachingRequirement: {
        include: {
          teachingGroup: { include: { course: true, studentCohort: true } },
        },
      },
    },
    orderBy: [{ weekStartDate: "asc" }, { teachingRequirementId: "asc" }],
  });

  if (allocations.length === 0) {
    throw new Error(
      "No TeachingRequirementWeek allocations found in the planning horizon. " +
        "Run npm run planning:allocate first.",
    );
  }

  const exceptions = await prisma.planningException.findMany({
    where: {
      tenantId: tenant.id,
      status: "ACTIVE",
      impactMode: "BLOCK",
      startAt: { lt: endOfUtcDay(planningEndDate) },
      endAt: { gt: planningStartDate },
    },
  });

  const instructorAvailability = await prisma.instructorAvailability.findMany({
    where: {
      tenantId: tenant.id,
      status: "UNAVAILABLE",
      date: { gte: planningStartDate, lte: planningEndDate },
    },
  });

  const studentAvailability = await prisma.studentAvailability.findMany({
    where: {
      tenantId: tenant.id,
      status: "UNAVAILABLE",
      date: { gte: planningStartDate, lte: planningEndDate },
    },
  });

  const roomAvailability = await prisma.roomAvailability.findMany({
    where: {
      tenantId: tenant.id,
      status: "UNAVAILABLE",
      date: { gte: planningStartDate, lte: planningEndDate },
    },
  });

  const roomTravelTimes = await prisma.roomTravelTime.findMany({
    where: { tenantId: tenant.id, active: true },
  });

  const roomPreferenceByCourse = new Map<
    string,
    Map<string, { suitability: "PREFERRED" | "ALLOWED" | "AVOID" | "PROHIBITED"; penalty: number }>
  >();

  for (const room of rooms) {
    for (const preference of room.coursePreferences) {
      const byRoom = roomPreferenceByCourse.get(preference.courseId) ?? new Map();
      byRoom.set(room.id, { suitability: preference.suitability, penalty: preference.penalty });
      roomPreferenceByCourse.set(preference.courseId, byRoom);
    }
  }

  const instructorPreferenceByGroup = new Map<string, Map<string, number>>();
  for (const group of teachingGroups) {
    const map = new Map<string, number>();
    for (const preference of group.instructorPreferences) {
      map.set(
        preference.instructorId,
        preference.preference === "AVOID"
          ? Math.max(0, preference.weight)
          : -Math.max(0, preference.weight),
      );
    }
    instructorPreferenceByGroup.set(group.id, map);
  }

  const teachingOccurrences: Array<{
    id: string;
    teachingGroupId: string;
    weekStartDate: string;
    durationMinutes: number;
    allowedDates: string[];
  }> = [];

  for (const allocation of allocations) {
    if (allocation.targetMinutes <= 0) {
      continue;
    }

    const group = groupById.get(allocation.teachingRequirement.teachingGroupId);
    if (!group) {
      throw new Error(`TeachingGroup ${allocation.teachingRequirement.teachingGroupId} was not found.`);
    }

    const weekEnd = addUtcDays(allocation.weekStartDate, 6);
    const eligibleDays = calendarDays.filter((day) => {
      if (!day.teachingAllowed) return false;
      if (day.date < allocation.weekStartDate || day.date > weekEnd) return false;
      if (day.date < planningStartDate || day.date > planningEndDate) return false;

      const blockedForGroup = exceptions.some((exception) => {
        const targetsGroup = exception.teachingGroupId === group.id;
        const targetsCohort =
          Boolean(group.studentCohortId) && exception.studentCohortId === group.studentCohortId;
        const targetsStudent =
          Boolean(exception.studentId) &&
          group.students.some((membership) => membership.studentId === exception.studentId);

        return (targetsGroup || targetsCohort || targetsStudent) && overlapsDay(exception.startAt, exception.endAt, day.date);
      });

      return !blockedForGroup;
    });

    if (eligibleDays.length === 0) {
      throw new Error(
        `No teaching day remains for ${group.code ?? group.id} in week ${dateKey(allocation.weekStartDate)}.`,
      );
    }

    const preferredDuration =
      group.course.preferredSessionMinutes ?? group.course.minSessionMinutes ?? 45;
    let remaining = allocation.targetMinutes;
    let occurrenceNumber = 1;

    while (remaining > 0) {
      const durationMinutes = Math.min(preferredDuration, remaining);
      teachingOccurrences.push({
        id: `${allocation.id}:${occurrenceNumber}`,
        teachingGroupId: group.id,
        weekStartDate: dateKey(allocation.weekStartDate),
        durationMinutes,
        allowedDates: eligibleDays.map((day) => dateKey(day.date)),
      });
      remaining -= durationMinutes;
      occurrenceNumber += 1;
    }
  }

  const resourceBlocks = {
    instructors: instructorAvailability.map((item) => ({
      resourceId: item.instructorId,
      date: dateKey(item.date),
      startMinute: item.startMinute,
      endMinute: item.endMinute,
    })),
    students: studentAvailability.map((item) => ({
      resourceId: item.studentId,
      date: dateKey(item.date),
      startMinute: item.startMinute,
      endMinute: item.endMinute,
    })),
    rooms: roomAvailability.map((item) => ({
      resourceId: item.roomId,
      date: dateKey(item.date),
      startMinute: item.startMinute,
      endMinute: item.endMinute,
    })),
  };

  for (const exception of exceptions) {
    for (const day of calendarDays) {
      if (!overlapsDay(exception.startAt, exception.endAt, day.date)) continue;
      const block = exceptionBlockForDate(exception, day.date);

      if (exception.instructorId) {
        resourceBlocks.instructors.push({
          resourceId: exception.instructorId,
          date: dateKey(day.date),
          ...block,
        });
      }
      if (exception.studentId) {
        resourceBlocks.students.push({
          resourceId: exception.studentId,
          date: dateKey(day.date),
          ...block,
        });
      }
      if (exception.roomId) {
        resourceBlocks.rooms.push({
          resourceId: exception.roomId,
          date: dateKey(day.date),
          ...block,
        });
      }
    }
  }

  const travel = roomTravelTimes.map((item) => ({
    fromRoomId: item.fromRoomId,
    toRoomId: item.toRoomId,
    minutes: item.minutes,
  }));
  for (const room of rooms) {
    travel.push({ fromRoomId: room.id, toRoomId: room.id, minutes: 0 });
  }

  const protectedSessions = await prisma.session.findMany({
    where: {
      tenantId: tenant.id,
      planId: plan.id,
      date: { lt: planningStartDate },
      status: { not: "CANCELLED" },
    },
  });

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: tenant.id,
    planScenarioId: scenario.id,
    planningWindow: {
      asOfDate: dateKey(planningAsOfDate),
      frozenThroughDate: plan.frozenThroughDate ? dateKey(plan.frozenThroughDate) : null,
      startDate: dateKey(planningStartDate),
      endDate: dateKey(planningEndDate),
    },
    startTimes: [
      clock(8, 15), clock(8, 30), clock(8, 45), clock(9, 0), clock(9, 15), clock(9, 30),
      clock(9, 45), clock(10, 0), clock(10, 15), clock(10, 30), clock(10, 45), clock(11, 0),
      clock(11, 15), clock(11, 30), clock(11, 45), clock(12, 0), clock(12, 15), clock(12, 30),
      clock(12, 45), clock(13, 0), clock(13, 15), clock(13, 30), clock(13, 45), clock(14, 0),
    ],
    instructors: instructors.map((instructor) => ({
      id: instructor.id,
      name: `${instructor.firstName} ${instructor.lastName}`,
      courseIds: instructor.courses.map((link) => link.course.id),
      coursePenalties: Object.fromEntries(
        instructor.courses.map((link) => [link.course.id, qualificationPenalty(link.qualificationLevel)]),
      ),
      qualificationLevels: Object.fromEntries(
        instructor.qualifications.map((link) => [
          link.qualification.id,
          link.level,
        ]),
      ),
    })),
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      staffingRoles: room.staffingRequirements
        .filter((rule) => !rule.minimumStudentCount || rule.minimumStudentCount <= room.capacity)
        .flatMap((rule) =>
          Array.from({ length: rule.count }, (_, index) => ({
            id: `${rule.id}:${index + 1}`,
            role: rule.role,
            requiredQualificationId: rule.requiredQualificationId,
            minimumQualificationLevel: rule.minimumQualificationLevel,
          })),
        ),
    })),
    teachingGroups: teachingGroups.map((group) => {
      const explicitPreferences = roomPreferenceByCourse.get(group.course.id);
      const allowedRoomIds: string[] = [];
      const roomPenalties: Record<string, number> = {};

      for (const room of rooms) {
        const preference = explicitPreferences?.get(room.id);
        if (preference?.suitability === "PROHIBITED") continue;
        allowedRoomIds.push(room.id);
        if (preference) {
          roomPenalties[room.id] =
            preference.suitability === "AVOID"
              ? Math.max(preference.penalty, 50)
              : Math.max(preference.penalty, 0);
        }
      }

      return {
        id: group.id,
        courseId: group.course.id,
        studentIds: group.students.map((membership) => membership.student.id),
        durationMinutes: group.course.preferredSessionMinutes ?? group.course.minSessionMinutes ?? 45,
        allowedRoomIds,
        roomPenalties,
        instructorPenalties: Object.fromEntries(instructorPreferenceByGroup.get(group.id) ?? []),
        staffingRoles: [
          ...group.course.staffingRequirements,
          ...group.staffingRequirements,
        ]
          .filter(
            (rule) =>
              !rule.minimumStudentCount ||
              rule.minimumStudentCount <= group.students.length,
          )
          .flatMap((rule) =>
            Array.from({ length: rule.count }, (_, index) => ({
              id: `${rule.id}:${index + 1}`,
              role: rule.role,
              requiredQualificationId: rule.requiredQualificationId,
              minimumQualificationLevel: rule.minimumQualificationLevel,
            })),
          ),
      };
    }),
    calendarDays: calendarDays.map((day) => ({
      date: dateKey(day.date),
      teachingAllowed: day.teachingAllowed,
    })),
    teachingOccurrences,
    resourceBlocks,
    travel,
    studentLoadProfile: {
      maxTeachingMinutesPerDay: loadProfile.maxTeachingMinutesPerDay,
      maxContinuousTeachingMinutes: loadProfile.maxContinuousTeachingMinutes,
      minBreakMinutes: loadProfile.minBreakMinutes ?? 0,
      minBreakAfterDoubleMinutes: Math.max(loadProfile.minBreakMinutes ?? 0, 20),
      maxSessionsPerDay: loadProfile.maxSessionsPerDay,
      minLunchMinutes: loadProfile.minLunchMinutes,
      lunchWindowStart: clock(11, 0),
      lunchWindowEnd: clock(13, 30),
      travelConsumesBreakTime: loadProfile.travelConsumesBreakTime,
    },
    metadata: {
      generatedFromDatabase: true,
      planningMode: "HORIZON",
      protectedSessionCount: protectedSessions.length,
      protectedTeachingMinutes: protectedSessions.reduce(
        (sum, session) => sum + (session.endMinute - session.startMinute),
        0,
      ),
      note: "Dates before planningStartDate are protected and are never emitted as solver candidates.",
    },
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log("Solver input generated");
  console.log(`Path: ${OUTPUT_PATH}`);
  console.log(`Schema: ${SCHEMA_VERSION}`);
  console.log(`Tenant: ${tenant.name}`);
  console.log(`Scenario: ${scenario.name}`);
  console.log(
    `Planning window: ${dateKey(planningStartDate)} -> ${dateKey(planningEndDate)}`,
  );
  console.log(`Teaching groups: ${teachingGroups.length}`);
  console.log(`Teaching occurrences: ${teachingOccurrences.length}`);
  console.log(`Calendar days: ${calendarDays.length}`);
  console.log(`Instructor blocks: ${resourceBlocks.instructors.length}`);
  console.log(`Student blocks: ${resourceBlocks.students.length}`);
  console.log(`Room blocks: ${resourceBlocks.rooms.length}`);
  console.log(`Protected sessions before horizon: ${protectedSessions.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
