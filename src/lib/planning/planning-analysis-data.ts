import {
  canPackSessionsAcrossTeachingDays,
} from "@/lib/planning/base-plan";
import {
  summarizePlanningAnalysis,
  type PlanningAnalysisCheck,
  type PlanningAnalysisResult,
} from "@/lib/planning/planning-analysis";
import { roomRequirementCost } from "@/lib/planning/preference-compiler";
import { prisma } from "@/lib/prisma";

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function endOfUtcDay(date: Date): Date {
  return addUtcDays(
    new Date(`${dateKey(date)}T00:00:00.000Z`),
    1,
  );
}

function overlapsDay(
  startAt: Date,
  endAt: Date,
  date: Date,
): boolean {
  const dayStart = new Date(
    `${dateKey(date)}T00:00:00.000Z`,
  );
  const dayEnd = endOfUtcDay(date);

  return startAt < dayEnd && endAt > dayStart;
}

function overlapsWeek(
  date: Date,
  weekStartDate: Date,
): boolean {
  const weekEnd = addUtcDays(weekStartDate, 7);

  return date >= weekStartDate && date < weekEnd;
}

function mergeIntervals(
  intervals: Array<{
    startMinute: number;
    endMinute: number;
  }>,
): Array<{
  startMinute: number;
  endMinute: number;
}> {
  const sorted = intervals
    .filter(
      (item) => item.endMinute > item.startMinute,
    )
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        left.endMinute - right.endMinute,
    );

  const merged: Array<{
    startMinute: number;
    endMinute: number;
  }> = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);

    if (
      previous &&
      interval.startMinute <= previous.endMinute
    ) {
      previous.endMinute = Math.max(
        previous.endMinute,
        interval.endMinute,
      );
      continue;
    }

    merged.push({ ...interval });
  }

  return merged;
}

function intervalMinutes(
  intervals: Array<{
    startMinute: number;
    endMinute: number;
  }>,
): number {
  return intervals.reduce(
    (sum, item) =>
      sum +
      Math.max(
        0,
        item.endMinute - item.startMinute,
      ),
    0,
  );
}

function overlapWithSchedule(
  startMinute: number,
  endMinute: number,
  schedule: Array<{
    startMinute: number;
    endMinute: number;
  }>,
): number {
  return schedule.reduce((sum, block) => {
    const start = Math.max(
      startMinute,
      block.startMinute,
    );
    const end = Math.min(
      endMinute,
      block.endMinute,
    );

    return sum + Math.max(0, end - start);
  }, 0);
}

function courseQualificationRank(
  level: "PRIMARY" | "SECONDARY" | "SUPPORT",
): number {
  switch (level) {
    case "PRIMARY":
      return 3;
    case "SECONDARY":
      return 2;
    case "SUPPORT":
      return 1;
  }
}

function isGlobalClosure(exception: {
  type: string;
  instructorId: string | null;
  studentId: string | null;
  roomId: string | null;
  locationId: string | null;
  organisationUnitId: string | null;
  studentCohortId: string | null;
  teachingGroupId: string | null;
}): boolean {
  return (
    exception.type === "SCHOOL_CLOSED" &&
    !exception.instructorId &&
    !exception.studentId &&
    !exception.roomId &&
    !exception.locationId &&
    !exception.organisationUnitId &&
    !exception.studentCohortId &&
    !exception.teachingGroupId
  );
}

export async function getPlanningAnalysis(
  planId: string,
): Promise<PlanningAnalysisResult> {
  const plan = await prisma.plan.findUnique({
    where: {
      id: planId,
    },
    select: {
      id: true,
      tenantId: true,
      academicPeriodId: true,
      planningStartDate: true,
      planningEndDate: true,
    },
  });

  const checks: PlanningAnalysisCheck[] = [];

  if (!plan) {
    return summarizePlanningAnalysis([
      {
        id: "plan-not-found",
        phase: "DATA_READINESS",
        severity: "BLOCKING",
        title: "Base Plan not found",
        scopeLabel: null,
        weekStartDate: null,
        required: null,
        available: null,
        unit: null,
        message:
          "The Base Plan revision could not be found.",
        suggestedAction:
          "Open a valid Base Plan revision before starting planning analysis.",
      },
    ]);
  }

  if (
    !plan.planningStartDate ||
    !plan.planningEndDate
  ) {
    return summarizePlanningAnalysis([
      {
        id: "planning-horizon-missing",
        phase: "DATA_READINESS",
        severity: "BLOCKING",
        title: "Planning horizon is incomplete",
        scopeLabel: null,
        weekStartDate: null,
        required: null,
        available: null,
        unit: null,
        message:
          "Planning start and end dates are required before the timetable can be analysed.",
        suggestedAction:
          "Define the planning horizon and recalculate the Base Plan.",
      },
    ]);
  }

  const planningStartDate = plan.planningStartDate;
  const planningEndDate = plan.planningEndDate;

  const [
    requirements,
    calendarDays,
    exceptions,
    loadProfile,
    rooms,
    timeBlocks,
    roomAvailability,
    instructors,
    instructorAvailability,
    staffingRequirements,
    instructorCourses,
    instructorQualifications,
    roomRequirements,
  ] = await Promise.all([
    prisma.teachingRequirement.findMany({
      where: {
        tenantId: plan.tenantId,
        planId: plan.id,
        academicPeriodId: plan.academicPeriodId,
        active: true,
      },
      include: {
        teachingGroup: {
          include: {
            course: true,
            studentCohort: true,
            students: true,
          },
        },
        weeklyAllocations: {
          orderBy: {
            weekStartDate: "asc",
          },
        },
      },
    }),

    prisma.calendarDay.findMany({
      where: {
        tenantId: plan.tenantId,
        academicPeriodId: plan.academicPeriodId,
        date: {
          gte: planningStartDate,
          lte: planningEndDate,
        },
      },
      orderBy: {
        date: "asc",
      },
    }),

    prisma.planningException.findMany({
      where: {
        tenantId: plan.tenantId,
        status: "ACTIVE",
        impactMode: "BLOCK",
        startAt: {
          lt: endOfUtcDay(planningEndDate),
        },
        endAt: {
          gt: planningStartDate,
        },
      },
    }),

    prisma.loadProfile.findFirst({
      where: {
        tenantId: plan.tenantId,
        active: true,
      },
      orderBy: {
        code: "asc",
      },
    }),

    prisma.room.findMany({
      where: {
        tenantId: plan.tenantId,
        active: true,
      },
      include: {
        features: true,
      },
      orderBy: {
        code: "asc",
      },
    }),

    prisma.timeBlock.findMany({
      where: {
        tenantId: plan.tenantId,
        active: true,
      },
      select: {
        startMinute: true,
        endMinute: true,
      },
      orderBy: {
        startMinute: "asc",
      },
    }),

    prisma.roomAvailability.findMany({
      where: {
        tenantId: plan.tenantId,
        status: "UNAVAILABLE",
        date: {
          gte: planningStartDate,
          lte: planningEndDate,
        },
      },
      select: {
        roomId: true,
        date: true,
        startMinute: true,
        endMinute: true,
      },
    }),

    prisma.instructor.findMany({
      where: {
        tenantId: plan.tenantId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        maxTeachingMinutesPerWeek: true,
      },
    }),

    prisma.instructorAvailability.findMany({
      where: {
        tenantId: plan.tenantId,
        status: "UNAVAILABLE",
        date: {
          gte: planningStartDate,
          lte: planningEndDate,
        },
      },
      select: {
        instructorId: true,
        date: true,
        startMinute: true,
        endMinute: true,
      },
    }),

    prisma.staffingRequirement.findMany({
      where: {
        tenantId: plan.tenantId,
        active: true,
        hard: true,
      },
      select: {
        id: true,
        courseId: true,
        teachingGroupId: true,
        role: true,
        count: true,
        requiredQualificationId: true,
        minimumQualificationLevel: true,
        minimumCourseQualificationLevel: true,
        minimumCourseLevel: true,
        validFrom: true,
        validTo: true,
      },
    }),

    prisma.instructorCourse.findMany({
      where: {
        tenantId: plan.tenantId,
        active: true,
      },
      select: {
        instructorId: true,
        courseId: true,
        competenceLevel: true,
        qualificationLevel: true,
        validFrom: true,
        validTo: true,
      },
    }),

    prisma.instructorQualification.findMany({
      where: {
        tenantId: plan.tenantId,
        active: true,
      },
      select: {
        instructorId: true,
        qualificationId: true,
        level: true,
        validFrom: true,
        validTo: true,
      },
    }),

    prisma.roomRequirement.findMany({
      where: {
        tenantId: plan.tenantId,
        active: true,
      },
      select: {
        id: true,
        featureId: true,
        courseId: true,
        studentId: true,
        instructorId: true,
        quantity: true,
        perStudent: true,
        hard: true,
        weight: true,
      },
    }),
  ]);

  if (requirements.length === 0) {
    checks.push({
      id: "no-requirements",
      phase: "DATA_READINESS",
      severity: "BLOCKING",
      title: "No teaching requirements",
      scopeLabel: null,
      weekStartDate: null,
      required: 1,
      available: 0,
      unit: "COUNT",
      message:
        "The Base Plan contains no active teaching requirements.",
      suggestedAction:
        "Add teaching requirements before running planning analysis.",
    });
  } else {
    checks.push({
      id: "requirements-present",
      phase: "DATA_READINESS",
      severity: "PASS",
      title: "Teaching requirements available",
      scopeLabel: null,
      weekStartDate: null,
      required: 1,
      available: requirements.length,
      unit: "COUNT",
      message: `${requirements.length} active teaching requirement(s) are available for analysis.`,
      suggestedAction: null,
    });
  }

  if (rooms.length === 0) {
    checks.push({
      id: "no-rooms",
      phase: "DATA_READINESS",
      severity: "BLOCKING",
      title: "No active rooms",
      scopeLabel: null,
      weekStartDate: null,
      required: 1,
      available: 0,
      unit: "COUNT",
      message:
        "No active rooms are available for timetable generation.",
      suggestedAction:
        "Add or activate at least one room.",
    });
  }

  if (instructors.length === 0) {
    checks.push({
      id: "no-instructors",
      phase: "DATA_READINESS",
      severity: "BLOCKING",
      title: "No active instructors",
      scopeLabel: null,
      weekStartDate: null,
      required: 1,
      available: 0,
      unit: "COUNT",
      message:
        "No active instructors are available for timetable generation.",
      suggestedAction:
        "Add or activate at least one instructor.",
    });
  }

  const scheduleIntervals = mergeIntervals(
    timeBlocks,
  );

  const scheduleMinutesPerDay =
    intervalMinutes(scheduleIntervals);

  if (scheduleMinutesPerDay <= 0) {
    checks.push({
      id: "no-time-block-capacity",
      phase: "DATA_READINESS",
      severity: "BLOCKING",
      title: "No schedulable time blocks",
      scopeLabel: null,
      weekStartDate: null,
      required: 1,
      available: 0,
      unit: "COUNT",
      message:
        "No active timetable time blocks define when teaching can be scheduled.",
      suggestedAction:
        "Configure active timetable time blocks before running the planner.",
    });
  }

  const globalBlocked = (date: Date) =>
    exceptions.some(
      (exception) =>
        isGlobalClosure(exception) &&
        overlapsDay(
          exception.startAt,
          exception.endAt,
          date,
        ),
    );

  const staleAllocationGroups = new Map<
    string,
    {
      label: string;
      weekStartDate: Date;
      storedDays: number;
      actualDays: number;
      affectedRequirements: number;
    }
  >();

  const cohortRows = new Map<
    string,
    {
      label: string;
      weekStartDate: Date;
      requiredMinutes: number;
      requiredSessions: number;
      sessionDurations: number[];
      availableTeachingDays: number;
    }
  >();

  const weeklyDemand = new Map<
    string,
    {
      weekStartDate: Date;
      requiredRoomMinutes: number;
      requiredInstructorMinutes: number;
    }
  >();

  for (const requirement of requirements) {
    const group = requirement.teachingGroup;
    const course = group.course;

    const hardStaffing = staffingRequirements.filter(
      (rule) =>
        rule.teachingGroupId === group.id ||
        (rule.courseId === course.id &&
          !rule.teachingGroupId),
    );

    const instructorCount =
      hardStaffing.length > 0
        ? hardStaffing.reduce(
            (sum, rule) =>
              sum + Math.max(rule.count, 0),
            0,
          )
        : 1;

    const sessionMinutes = Math.max(
      course.preferredSessionMinutes ??
        course.minSessionMinutes ??
        45,
      1,
    );

    for (const allocation of requirement.weeklyAllocations) {
      if (
        allocation.weekStartDate >
          planningEndDate ||
        addUtcDays(allocation.weekStartDate, 7) <=
          planningStartDate
      ) {
        continue;
      }

      const relevantDays = calendarDays.filter(
        (day) =>
          overlapsWeek(
            day.date,
            allocation.weekStartDate,
          ) &&
          day.teachingAllowed,
      );

      const actualAvailableDays =
        relevantDays.filter((day) => {
          if (globalBlocked(day.date)) {
            return false;
          }

          return !exceptions.some((exception) => {
            const targetsGroup =
              exception.teachingGroupId === group.id;

            const targetsCohort =
              Boolean(group.studentCohortId) &&
              exception.studentCohortId ===
                group.studentCohortId;

            return (
              (targetsGroup || targetsCohort) &&
              overlapsDay(
                exception.startAt,
                exception.endAt,
                day.date,
              )
            );
          });
        }).length;

      if (
        actualAvailableDays !==
        allocation.availableTeachingDays
      ) {
        const scopeId =
          group.studentCohortId ??
          group.id;

        const staleKey =
          `${scopeId}:${dateKey(allocation.weekStartDate)}`;

        const existing =
          staleAllocationGroups.get(staleKey);

        if (existing) {
          existing.affectedRequirements += 1;
          existing.storedDays = Math.max(
            existing.storedDays,
            allocation.availableTeachingDays,
          );
          existing.actualDays = Math.min(
            existing.actualDays,
            actualAvailableDays,
          );
        } else {
          staleAllocationGroups.set(staleKey, {
            label:
              group.studentCohort?.code ??
              group.studentCohort?.name ??
              group.code ??
              group.name,
            weekStartDate:
              allocation.weekStartDate,
            storedDays:
              allocation.availableTeachingDays,
            actualDays:
              actualAvailableDays,
            affectedRequirements: 1,
          });
        }
      }

      const weekKey = dateKey(
        allocation.weekStartDate,
      );

      const demand =
        weeklyDemand.get(weekKey) ?? {
          weekStartDate:
            allocation.weekStartDate,
          requiredRoomMinutes: 0,
          requiredInstructorMinutes: 0,
        };

      demand.requiredRoomMinutes +=
        allocation.targetMinutes;

      demand.requiredInstructorMinutes +=
        allocation.targetMinutes *
        Math.max(instructorCount, 1);

      weeklyDemand.set(weekKey, demand);

      if (group.studentCohortId) {
        const cohortKey =
          `${group.studentCohortId}:${weekKey}`;

        const existing =
          cohortRows.get(cohortKey) ?? {
            label:
              group.studentCohort?.code ??
              group.studentCohort?.name ??
              group.studentCohortId,
            weekStartDate:
              allocation.weekStartDate,
            requiredMinutes: 0,
            requiredSessions: 0,
            sessionDurations: [],
            availableTeachingDays: 0,
          };

        existing.requiredMinutes +=
          allocation.targetMinutes;

        let remainingSessionMinutes =
          allocation.targetMinutes;

        while (remainingSessionMinutes > 0) {
          const duration = Math.min(
            sessionMinutes,
            remainingSessionMinutes,
          );

          existing.sessionDurations.push(duration);
          existing.requiredSessions += 1;
          remainingSessionMinutes -= duration;
        }

        // Group-specific blocks must not make the
        // entire cohort appear unavailable.
        existing.availableTeachingDays = Math.max(
          existing.availableTeachingDays,
          actualAvailableDays,
        );

        cohortRows.set(
          cohortKey,
          existing,
        );
      }
    }
  }

  for (const [staleKey, stale] of staleAllocationGroups) {
    checks.push({
      id: `stale-allocation:${staleKey}`,
      phase: "DATA_READINESS",
      severity: "BLOCKING",
      title: "Base Plan allocation needs recalculation",
      scopeLabel: stale.label,
      weekStartDate: dateKey(
        stale.weekStartDate,
      ),
      required: stale.storedDays,
      available: stale.actualDays,
      unit: "COUNT",
      message:
        `${stale.affectedRequirements} teaching requirement(s) use ${stale.storedDays} stored teaching day(s), ` +
        `but the current calendar and blocking exceptions leave ${stale.actualDays}.`,
      suggestedAction:
        "Recalculate Base Plan weekly allocations before continuing planning analysis.",
    });
  }

  const dataReadinessBlocked = checks.some(
    (check) =>
      check.phase === "DATA_READINESS" &&
      check.severity === "BLOCKING",
  );

  if (dataReadinessBlocked) {
    return summarizePlanningAnalysis(
      checks,
    );
  }

  for (const [
    cohortKey,
    row,
  ] of cohortRows) {
    if (
      loadProfile?.maxTeachingMinutesPerDay !=
      null
    ) {
      const capacity =
        row.availableTeachingDays *
        loadProfile.maxTeachingMinutesPerDay;

      const severity =
        row.requiredMinutes > capacity
          ? "BLOCKING"
          : capacity > 0 &&
              row.requiredMinutes /
                capacity >=
                0.9
            ? "WARNING"
            : "PASS";

      checks.push({
        id: `cohort-minutes:${cohortKey}`,
        phase: "AGGREGATE_CAPACITY",
        severity,
        title: "Cohort teaching capacity",
        scopeLabel: row.label,
        weekStartDate: dateKey(
          row.weekStartDate,
        ),
        required: row.requiredMinutes,
        available: capacity,
        unit: "MINUTES",
        message:
          severity === "BLOCKING"
            ? `${row.label} requires ${row.requiredMinutes} teaching minute(s), but only ${capacity} minute(s) fit within the current daily teaching limit.`
            : `${row.label} requires ${row.requiredMinutes} of ${capacity} available teaching minute(s).`,
        suggestedAction:
          severity === "BLOCKING"
            ? "Move teaching to another week, restore teaching days, or increase permitted teaching capacity."
            : null,
      });
    }

    if (
      loadProfile?.maxSessionsPerDay != null
    ) {
      const capacity =
        row.availableTeachingDays *
        loadProfile.maxSessionsPerDay;

      const severity =
        row.requiredSessions > capacity
          ? "BLOCKING"
          : capacity > 0 &&
              row.requiredSessions /
                capacity >=
                0.9
            ? "WARNING"
            : "PASS";

      checks.push({
        id: `cohort-sessions:${cohortKey}`,
        phase: "AGGREGATE_CAPACITY",
        severity,
        title: "Cohort session capacity",
        scopeLabel: row.label,
        weekStartDate: dateKey(
          row.weekStartDate,
        ),
        required: row.requiredSessions,
        available: capacity,
        unit: "SESSIONS",
        message:
          severity === "BLOCKING"
            ? `${row.label} requires ${row.requiredSessions} session(s), but the weekly limit is ${capacity}.`
            : `${row.label} requires ${row.requiredSessions} of ${capacity} available session slot(s).`,
        suggestedAction:
          severity === "BLOCKING"
            ? "Move sessions to another week, restore teaching days, or revise session limits."
            : null,
      });
    }

    if (
      loadProfile?.maxTeachingMinutesPerDay != null &&
      loadProfile.maxSessionsPerDay != null
    ) {
      const packable =
        canPackSessionsAcrossTeachingDays({
          sessionDurations: row.sessionDurations,
          teachingDays: row.availableTeachingDays,
          maxSessionsPerDay:
            loadProfile.maxSessionsPerDay,
          maxTeachingMinutesPerDay:
            loadProfile.maxTeachingMinutesPerDay,
        });

      const durationCounts = new Map<number, number>();

      for (const duration of row.sessionDurations) {
        durationCounts.set(
          duration,
          (durationCounts.get(duration) ?? 0) + 1,
        );
      }

      const sessionMix = [...durationCounts.entries()]
        .sort(([left], [right]) => left - right)
        .map(
          ([duration, count]) =>
            `${count} × ${duration} min`,
        )
        .join(", ");

      checks.push({
        id: `cohort-session-packing:${cohortKey}`,
        phase: "AGGREGATE_CAPACITY",
        severity: packable ? "PASS" : "BLOCKING",
        title: "Daily session packing",
        scopeLabel: row.label,
        weekStartDate: dateKey(
          row.weekStartDate,
        ),
        required: row.requiredSessions,
        available:
          row.availableTeachingDays *
          loadProfile.maxSessionsPerDay,
        unit: "SESSIONS",
        message: packable
          ? `${row.label}'s ${row.requiredSessions} session(s) (${sessionMix}) can be distributed across ${row.availableTeachingDays} teaching day(s) within the daily session and teaching-minute limits.`
          : `${row.label} requires ${row.requiredSessions} session(s) (${sessionMix}) across ${row.availableTeachingDays} teaching day(s). They cannot be distributed within both the ${loadProfile.maxSessionsPerDay}-session and ${loadProfile.maxTeachingMinutesPerDay}-minute daily limits.`,
        suggestedAction: packable
          ? null
          : "Recalculate the Base Plan to move teaching to another week, restore teaching days, or revise the daily session/minute limits.",
      });
    }
  }

  for (const [
    weekKey,
    demand,
  ] of weeklyDemand) {
    const teachingDays = calendarDays.filter(
      (day) =>
        overlapsWeek(
          day.date,
          demand.weekStartDate,
        ) &&
        day.teachingAllowed &&
        !globalBlocked(day.date),
    );

    if (
      rooms.length > 0 &&
      scheduleMinutesPerDay > 0
    ) {
      const grossRoomCapacity =
        rooms.length *
        teachingDays.length *
        scheduleMinutesPerDay;

      const blockedRoomMinutes =
        roomAvailability
          .filter((block) =>
            overlapsWeek(
              block.date,
              demand.weekStartDate,
            ),
          )
          .reduce(
            (sum, block) =>
              sum +
              overlapWithSchedule(
                block.startMinute,
                block.endMinute,
                scheduleIntervals,
              ),
            0,
          );

      const roomCapacity = Math.max(
        0,
        grossRoomCapacity -
          blockedRoomMinutes,
      );

      const severity =
        demand.requiredRoomMinutes >
        roomCapacity
          ? "BLOCKING"
          : roomCapacity > 0 &&
              demand.requiredRoomMinutes /
                roomCapacity >=
                0.9
            ? "WARNING"
            : "PASS";

      checks.push({
        id: `room-capacity:${weekKey}`,
        phase: "AGGREGATE_CAPACITY",
        severity,
        title: "Aggregate room capacity",
        scopeLabel: "All active rooms",
        weekStartDate: weekKey,
        required:
          demand.requiredRoomMinutes,
        available: roomCapacity,
        unit: "MINUTES",
        message:
          severity === "BLOCKING"
            ? `Teaching requires ${demand.requiredRoomMinutes} room-minute(s), but only ${roomCapacity} are available.`
            : `Teaching requires ${demand.requiredRoomMinutes} of ${roomCapacity} available room-minute(s).`,
        suggestedAction:
          severity === "BLOCKING"
            ? "Add room capacity, restore unavailable rooms, or move teaching to another week."
            : null,
      });
    }

    if (instructors.length > 0) {
      let instructorCapacity = 0;

      for (const instructor of instructors) {
        const blockedMinutes =
          instructorAvailability
            .filter(
              (block) =>
                block.instructorId ===
                  instructor.id &&
                overlapsWeek(
                  block.date,
                  demand.weekStartDate,
                ),
            )
            .reduce(
              (sum, block) =>
                sum +
                overlapWithSchedule(
                  block.startMinute,
                  block.endMinute,
                  scheduleIntervals,
                ),
              0,
            );

        const scheduleableMinutes =
          Math.max(
            0,
            teachingDays.length *
              scheduleMinutesPerDay -
              blockedMinutes,
          );

        const weeklyLimit =
          instructor.maxTeachingMinutesPerWeek ??
          (loadProfile?.maxTeachingMinutesPerDay !=
          null
            ? teachingDays.length *
              loadProfile.maxTeachingMinutesPerDay
            : scheduleableMinutes);

        instructorCapacity += Math.min(
          Math.max(weeklyLimit, 0),
          scheduleableMinutes,
        );
      }

      const severity =
        demand.requiredInstructorMinutes >
        instructorCapacity
          ? "BLOCKING"
          : instructorCapacity > 0 &&
              demand.requiredInstructorMinutes /
                instructorCapacity >=
                0.9
            ? "WARNING"
            : "PASS";

      checks.push({
        id: `instructor-capacity:${weekKey}`,
        phase: "AGGREGATE_CAPACITY",
        severity,
        title: "Aggregate instructor capacity",
        scopeLabel: "All active instructors",
        weekStartDate: weekKey,
        required:
          demand.requiredInstructorMinutes,
        available: instructorCapacity,
        unit: "MINUTES",
        message:
          severity === "BLOCKING"
            ? `Staffing requires ${demand.requiredInstructorMinutes} instructor-minute(s), but only ${instructorCapacity} are available.`
            : `Staffing requires ${demand.requiredInstructorMinutes} of ${instructorCapacity} available instructor-minute(s).`,
        suggestedAction:
          severity === "BLOCKING"
            ? "Add instructor capacity, restore availability, reduce staffing demand, or move teaching to another week."
            : null,
      });
    }
  }

  const aggregateCapacityBlocked = checks.some(
    (check) =>
      check.phase === "AGGREGATE_CAPACITY" &&
      check.severity === "BLOCKING",
  );

  if (aggregateCapacityBlocked) {
    return summarizePlanningAnalysis(
      checks,
    );
  }

  type ResourceDemandKey = {
    weekStartDate: Date;
    weekKey: string;
    courseId: string;
    courseLabel: string;
    role: string;
    ruleId: string;
    requiredQualificationId: string | null;
    minimumQualificationLevel: number | null;
    minimumCourseQualificationLevel:
      | "PRIMARY"
      | "SECONDARY"
      | "SUPPORT"
      | null;
    minimumCourseLevel: number | null;
    requiredMinutes: number;
  };

  const resourceDemands = new Map<
    string,
    ResourceDemandKey
  >();

  for (const requirement of requirements) {
    const group = requirement.teachingGroup;
    const course = group.course;

    const applicableRules =
      staffingRequirements.filter(
        (rule) =>
          rule.teachingGroupId === group.id ||
          (
            rule.courseId === course.id &&
            !rule.teachingGroupId
          ),
      );

    if (applicableRules.length === 0) {
      continue;
    }

    for (const allocation of requirement.weeklyAllocations) {
      if (allocation.targetMinutes <= 0) {
        continue;
      }

      const weekKey = dateKey(
        allocation.weekStartDate,
      );

      for (const rule of applicableRules) {
        const ruleKey = [
          weekKey,
          course.id,
          rule.id,
        ].join(":");

        const existing =
          resourceDemands.get(ruleKey);

        const requiredMinutes =
          allocation.targetMinutes *
          Math.max(rule.count, 0);

        if (existing) {
          existing.requiredMinutes +=
            requiredMinutes;
          continue;
        }

        resourceDemands.set(ruleKey, {
          weekStartDate:
            allocation.weekStartDate,
          weekKey,
          courseId: course.id,
          courseLabel:
            course.code ?? course.name,
          role: rule.role,
          ruleId: rule.id,
          requiredQualificationId:
            rule.requiredQualificationId,
          minimumQualificationLevel:
            rule.minimumQualificationLevel,
          minimumCourseQualificationLevel:
            rule.minimumCourseQualificationLevel,
          minimumCourseLevel:
            rule.minimumCourseLevel,
          requiredMinutes,
        });
      }
    }
  }

  const qualificationValidForWeek = (
    validFrom: Date | null,
    validTo: Date | null,
    weekStartDate: Date,
  ) => {
    const weekEnd = addUtcDays(
      weekStartDate,
      7,
    );

    if (
      validFrom &&
      validFrom >= weekEnd
    ) {
      return false;
    }

    if (
      validTo &&
      validTo < weekStartDate
    ) {
      return false;
    }

    return true;
  };

  for (const demand of resourceDemands.values()) {
    const teachingDays = calendarDays.filter(
      (day) =>
        overlapsWeek(
          day.date,
          demand.weekStartDate,
        ) &&
        day.teachingAllowed &&
        !globalBlocked(day.date),
    );

    const eligibleInstructorIds =
      new Set<string>();

    for (const instructor of instructors) {
      const courseLink =
        instructorCourses.find(
          (link) =>
            link.instructorId === instructor.id &&
            link.courseId === demand.courseId &&
            qualificationValidForWeek(
              link.validFrom,
              link.validTo,
              demand.weekStartDate,
            ),
        );

      if (!courseLink) {
        continue;
      }

      if (
        demand.minimumCourseQualificationLevel &&
        courseQualificationRank(
          courseLink.qualificationLevel,
        ) <
          courseQualificationRank(
            demand.minimumCourseQualificationLevel,
          )
      ) {
        continue;
      }

      if (
        demand.minimumCourseLevel !== null &&
        (
          courseLink.competenceLevel === null ||
          courseLink.competenceLevel <
            demand.minimumCourseLevel
        )
      ) {
        continue;
      }

      if (demand.requiredQualificationId) {
        const formalQualification =
          instructorQualifications.find(
            (qualification) =>
              qualification.instructorId ===
                instructor.id &&
              qualification.qualificationId ===
                demand.requiredQualificationId &&
              qualificationValidForWeek(
                qualification.validFrom,
                qualification.validTo,
                demand.weekStartDate,
              ),
          );

        if (!formalQualification) {
          continue;
        }

        if (
          demand.minimumQualificationLevel !==
            null &&
          formalQualification.level <
            demand.minimumQualificationLevel
        ) {
          continue;
        }
      }

      eligibleInstructorIds.add(
        instructor.id,
      );
    }

    let qualifiedCapacity = 0;

    for (const instructor of instructors) {
      if (
        !eligibleInstructorIds.has(
          instructor.id,
        )
      ) {
        continue;
      }

      const blockedMinutes =
        instructorAvailability
          .filter(
            (block) =>
              block.instructorId ===
                instructor.id &&
              overlapsWeek(
                block.date,
                demand.weekStartDate,
              ),
          )
          .reduce(
            (sum, block) =>
              sum +
              overlapWithSchedule(
                block.startMinute,
                block.endMinute,
                scheduleIntervals,
              ),
            0,
          );

      const scheduleableMinutes =
        Math.max(
          0,
          teachingDays.length *
            scheduleMinutesPerDay -
            blockedMinutes,
        );

      const weeklyLimit =
        instructor.maxTeachingMinutesPerWeek ??
        (
          loadProfile?.maxTeachingMinutesPerDay !=
          null
            ? teachingDays.length *
              loadProfile.maxTeachingMinutesPerDay
            : scheduleableMinutes
        );

      qualifiedCapacity += Math.min(
        Math.max(weeklyLimit, 0),
        scheduleableMinutes,
      );
    }

    const severity =
      demand.requiredMinutes >
      qualifiedCapacity
        ? "BLOCKING"
        : qualifiedCapacity > 0 &&
            demand.requiredMinutes /
              qualifiedCapacity >=
              0.9
          ? "WARNING"
          : "PASS";

    checks.push({
      id:
        `qualified-instructor:${demand.ruleId}:` +
        demand.weekKey,
      phase: "RESOURCE_CAPACITY",
      severity,
      title:
        "Qualified instructor capacity",
      scopeLabel:
        `${demand.courseLabel} · ${demand.role}`,
      weekStartDate:
        demand.weekKey,
      required:
        demand.requiredMinutes,
      available:
        qualifiedCapacity,
      unit: "MINUTES",
      message:
        severity === "BLOCKING"
          ? `${demand.courseLabel} ${demand.role} staffing requires ${demand.requiredMinutes} qualified instructor-minute(s), but only ${qualifiedCapacity} are available.`
          : `${demand.courseLabel} ${demand.role} staffing requires ${demand.requiredMinutes} of ${qualifiedCapacity} qualified instructor-minute(s).`,
      suggestedAction:
        severity === "BLOCKING"
          ? "Add qualified instructor capacity, relax the staffing requirement where appropriate, restore availability, or move teaching to another week."
          : null,
    });
  }

  const resourceCapacityBlocked =
    checks.some(
      (check) =>
        check.phase ===
          "RESOURCE_CAPACITY" &&
        check.severity ===
          "BLOCKING",
    );

  if (resourceCapacityBlocked) {
    return summarizePlanningAnalysis(
      checks,
    );
  }

  for (const requirement of requirements) {
    const group = requirement.teachingGroup;
    const course = group.course;

    const studentCount =
      group.students.length > 0
        ? group.students.length
        : group.minStudents ??
          group.maxStudents ??
          0;

    const relevantRoomRequirements =
      roomRequirements.filter(
        (rule) =>
          rule.courseId === course.id,
      );

    const allowedRooms = rooms.filter((room) => {
      if (
        studentCount > 0 &&
        room.capacity < studentCount
      ) {
        return false;
      }

      const cost = roomRequirementCost(
        relevantRoomRequirements,
        new Map(
          room.features.map((feature) => [
            feature.featureId,
            feature.quantity,
          ]),
        ),
        studentCount,
      );

      return cost.allowed;
    });

    checks.push({
      id: `room-domain:${group.id}`,
      phase: "DOMAIN_VALIDATION",
      severity:
        allowedRooms.length === 0
          ? "BLOCKING"
          : allowedRooms.length <= 2
            ? "WARNING"
            : "PASS",
      title: "Room candidate domain",
      scopeLabel:
        group.code ?? group.name,
      weekStartDate: null,
      required: 1,
      available: allowedRooms.length,
      unit: "COUNT",
      message:
        allowedRooms.length === 0
          ? `${group.code ?? group.name} has no active room that satisfies capacity and hard room-feature requirements.`
          : `${group.code ?? group.name} has ${allowedRooms.length} eligible room candidate(s).`,
      suggestedAction:
        allowedRooms.length === 0
          ? "Add suitable room capacity or revise the hard room requirements."
          : allowedRooms.length <= 2
            ? "Review room capacity because this teaching group has very few feasible room alternatives."
            : null,
    });

    const applicableRules =
      staffingRequirements.filter(
        (rule) =>
          rule.teachingGroupId === group.id ||
          (
            rule.courseId === course.id &&
            !rule.teachingGroupId
          ),
      );

    for (const rule of applicableRules) {
      const eligibleInstructors =
        instructors.filter((instructor) => {
          const courseLink =
            instructorCourses.find(
              (link) =>
                link.instructorId ===
                  instructor.id &&
                link.courseId ===
                  course.id &&
                qualificationValidForWeek(
                  link.validFrom,
                  link.validTo,
                  planningStartDate,
                ),
            );

          if (!courseLink) {
            return false;
          }

          if (
            rule.minimumCourseQualificationLevel &&
            courseQualificationRank(
              courseLink.qualificationLevel,
            ) <
              courseQualificationRank(
                rule.minimumCourseQualificationLevel,
              )
          ) {
            return false;
          }

          if (
            rule.minimumCourseLevel !== null &&
            (
              courseLink.competenceLevel === null ||
              courseLink.competenceLevel <
                rule.minimumCourseLevel
            )
          ) {
            return false;
          }

          if (
            rule.requiredQualificationId
          ) {
            const formalQualification =
              instructorQualifications.find(
                (qualification) =>
                  qualification.instructorId ===
                    instructor.id &&
                  qualification.qualificationId ===
                    rule.requiredQualificationId &&
                  qualificationValidForWeek(
                    qualification.validFrom,
                    qualification.validTo,
                    planningStartDate,
                  ),
              );

            if (!formalQualification) {
              return false;
            }

            if (
              rule.minimumQualificationLevel !==
                null &&
              formalQualification.level <
                rule.minimumQualificationLevel
            ) {
              return false;
            }
          }

          return true;
        });

      const minimumRequired =
        Math.max(rule.count, 0);

      checks.push({
        id:
          `staff-domain:${group.id}:` +
          rule.id,
        phase: "DOMAIN_VALIDATION",
        severity:
          eligibleInstructors.length <
          minimumRequired
            ? "BLOCKING"
            : eligibleInstructors.length <=
                minimumRequired + 1
              ? "WARNING"
              : "PASS",
        title:
          "Instructor candidate domain",
        scopeLabel:
          `${group.code ?? group.name} · ${rule.role}`,
        weekStartDate: null,
        required: minimumRequired,
        available:
          eligibleInstructors.length,
        unit: "COUNT",
        message:
          eligibleInstructors.length <
          minimumRequired
            ? `${group.code ?? group.name} requires ${minimumRequired} ${rule.role} instructor(s), but only ${eligibleInstructors.length} satisfy the hard qualification requirements.`
            : `${group.code ?? group.name} has ${eligibleInstructors.length} eligible instructor candidate(s) for ${rule.role}.`,
        suggestedAction:
          eligibleInstructors.length <
          minimumRequired
            ? "Add qualified instructors or revise the hard staffing requirement."
            : eligibleInstructors.length <=
                minimumRequired + 1
              ? "Review staffing resilience because this role has very few qualified alternatives."
              : null,
      });
    }
  }

  const domainValidationBlocked =
    checks.some(
      (check) =>
        check.phase ===
          "DOMAIN_VALIDATION" &&
        check.severity ===
          "BLOCKING",
    );

  if (domainValidationBlocked) {
    return summarizePlanningAnalysis(
      checks,
    );
  }

  return summarizePlanningAnalysis(
    checks,
  );
}
