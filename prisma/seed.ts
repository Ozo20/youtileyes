import { prisma } from "../src/lib/prisma";

function dateOnlyIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { code: "DEMO" },
    update: {},
    create: {
      name: "Youtileyes Demo University",
      code: "DEMO",
      timezone: "Europe/Oslo",
    },
  });

  const academicPeriod = await prisma.academicPeriod.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "2026-AUTUMN",
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      type: "SEMESTER",
      name: "Autumn 2026",
      code: "2026-AUTUMN",
      startDate: new Date("2026-08-17T00:00:00.000Z"),
      endDate: new Date("2026-12-18T00:00:00.000Z"),
    },
  });

  // Materialise the semester calendar. Weekends are stored explicitly as non-teaching
  // days so later planning code does not have to infer them from the weekday alone.
  for (
    let date = new Date("2026-08-17T00:00:00.000Z");
    date <= new Date("2026-12-18T00:00:00.000Z");
    date = addUtcDays(date, 1)
  ) {
    const weekday = date.getUTCDay();
    const teachingAllowed = weekday >= 1 && weekday <= 5;

    await prisma.calendarDay.upsert({
      where: {
        tenantId_date: {
          tenantId: tenant.id,
          date: new Date(`${dateOnlyIso(date)}T00:00:00.000Z`),
        },
      },
      update: {
        academicPeriodId: academicPeriod.id,
        dayType: teachingAllowed ? "TEACHING" : "CLOSED",
        teachingAllowed,
      },
      create: {
        tenantId: tenant.id,
        academicPeriodId: academicPeriod.id,
        date: new Date(`${dateOnlyIso(date)}T00:00:00.000Z`),
        dayType: teachingAllowed ? "TEACHING" : "CLOSED",
        teachingAllowed,
      },
    });
  }

  const organisation = await prisma.organisationUnit.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "ENG",
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      type: "FACULTY",
      name: "Faculty of Engineering",
      code: "ENG",
    },
  });

  const location = await prisma.location.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "CAMPUS-A",
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      type: "CAMPUS",
      name: "Campus A",
      code: "CAMPUS-A",
      city: "Trondheim",
      countryCode: "NO",
      timezone: "Europe/Oslo",
    },
  });

  const roomDefinitions = [
    { code: "A10", capacity: 10 },
    { code: "A11", capacity: 10 },
    { code: "B14", capacity: 10 },
  ] as const;

  const rooms = await Promise.all(
    roomDefinitions.map((definition) =>
      prisma.room.upsert({
        where: {
          tenantId_code: {
            tenantId: tenant.id,
            code: definition.code,
          },
        },
        update: {
          locationId: location.id,
          capacity: definition.capacity,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          locationId: location.id,
          name: definition.code,
          code: definition.code,
          capacity: definition.capacity,
        },
      }),
    ),
  );

  const roomByCode = Object.fromEntries(
    rooms.map((room) => [room.code!, room]),
  );

  const courseDefinitions = [
    { code: "MAT", name: "Mathematics", minutes: 90, double: true },
    { code: "FYS", name: "Physics", minutes: 45, double: false },
    { code: "ENG", name: "English", minutes: 45, double: false },
    { code: "NOR", name: "Norwegian", minutes: 45, double: false },
  ] as const;

  const courses = await Promise.all(
    courseDefinitions.map((definition) =>
      prisma.course.upsert({
        where: {
          tenantId_code: {
            tenantId: tenant.id,
            code: definition.code,
          },
        },
        update: {
          name: definition.name,
          preferredSessionMinutes: definition.minutes,
          maxSessionMinutes: definition.minutes,
          minSessionMinutes: 45,
          allowDoubleSession: definition.double,
          maxGroupSize: 10,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          code: definition.code,
          name: definition.name,
          preferredSessionMinutes: definition.minutes,
          maxSessionMinutes: definition.minutes,
          minSessionMinutes: 45,
          allowDoubleSession: definition.double,
          maxGroupSize: 10,
        },
      }),
    ),
  );

  const courseByCode = Object.fromEntries(
    courses.map((course) => [course.code!, course]),
  );

  const instructorDefinitions = [
    { externalId: "T1", firstName: "Kari", lastName: "Hansen" },
    { externalId: "T2", firstName: "Per", lastName: "Olsen" },
  ] as const;

  const instructors = await Promise.all(
    instructorDefinitions.map((definition) =>
      prisma.instructor.upsert({
        where: {
          tenantId_externalId_sourceSystem: {
            tenantId: tenant.id,
            externalId: definition.externalId,
            sourceSystem: "SEED",
          },
        },
        update: {
          firstName: definition.firstName,
          lastName: definition.lastName,
          status: "ACTIVE",
          primaryOrganisationUnitId: organisation.id,
          primaryLocationId: location.id,
        },
        create: {
          tenantId: tenant.id,
          externalId: definition.externalId,
          sourceSystem: "SEED",
          firstName: definition.firstName,
          lastName: definition.lastName,
          primaryOrganisationUnitId: organisation.id,
          primaryLocationId: location.id,
        },
      }),
    ),
  );

  const instructorByExternalId = Object.fromEntries(
    instructors.map((instructor) => [instructor.externalId!, instructor]),
  );

  const instructorCourses = [
    ["T1", "MAT", "PRIMARY", 100],
    ["T1", "FYS", "PRIMARY", 100],
    ["T1", "NOR", "SUPPORT", 100],
    ["T2", "ENG", "PRIMARY", 100],
    ["T2", "NOR", "PRIMARY", 100],
    ["T2", "MAT", "SECONDARY", 100],
    ["T2", "FYS", "SUPPORT", 100],
  ] as const;

  for (const [instructorExternalId, courseCode, qualificationLevel, priority] of instructorCourses) {
    await prisma.instructorCourse.upsert({
      where: {
        tenantId_instructorId_courseId: {
          tenantId: tenant.id,
          instructorId: instructorByExternalId[instructorExternalId].id,
          courseId: courseByCode[courseCode].id,
        },
      },
      update: {
        qualificationLevel,
        priority,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        instructorId: instructorByExternalId[instructorExternalId].id,
        courseId: courseByCode[courseCode].id,
        qualificationLevel,
        priority,
      },
    });
  }

  const students = await Promise.all(
    ["S1", "S2", "S3", "S4", "S5"].map((externalId) =>
      prisma.student.upsert({
        where: {
          tenantId_externalId_sourceSystem: {
            tenantId: tenant.id,
            externalId,
            sourceSystem: "SEED",
          },
        },
        update: {
          status: "ACTIVE",
          primaryOrganisationUnitId: organisation.id,
          primaryLocationId: location.id,
        },
        create: {
          tenantId: tenant.id,
          externalId,
          sourceSystem: "SEED",
          firstName: externalId,
          lastName: "Student",
          primaryOrganisationUnitId: organisation.id,
          primaryLocationId: location.id,
        },
      }),
    ),
  );

  const cohort = await prisma.studentCohort.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "ST2A",
      },
    },
    update: {
      academicPeriodId: academicPeriod.id,
      organisationUnitId: organisation.id,
      type: "CLASS",
      name: "ST2A",
      active: true,
    },
    create: {
      tenantId: tenant.id,
      academicPeriodId: academicPeriod.id,
      organisationUnitId: organisation.id,
      type: "CLASS",
      name: "ST2A",
      code: "ST2A",
    },
  });

  for (const student of students) {
    await prisma.studentCohortMember.upsert({
      where: {
        tenantId_studentCohortId_studentId: {
          tenantId: tenant.id,
          studentCohortId: cohort.id,
          studentId: student.id,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        studentCohortId: cohort.id,
        studentId: student.id,
      },
    });
  }

  // These are full-class teaching groups: every student in ST2A receives the
  // lesson together. The explicit TeachingGroupStudent rows are materialised
  // for solver compatibility, while StudentCohort remains the class source.
  const groupDefinitions = [
    ["G1", "MAT", 200],
    ["G2", "ENG", 180],
    ["G3", "FYS", 180],
    ["G4", "NOR", 180],
  ] as const;

  const teachingGroupByCode: Record<string, { id: string }> = {};

  for (const [code, courseCode, schedulingPriority] of groupDefinitions) {
    const group = await prisma.teachingGroup.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: {
        academicPeriodId: academicPeriod.id,
        courseId: courseByCode[courseCode].id,
        studentCohortId: cohort.id,
        membershipMode: "FULL_COHORT",
        schedulingPriority,
        name: `${cohort.code} ${courseCode}`,
        status: "ACTIVE",
        maxStudents: 10,
      },
      create: {
        tenantId: tenant.id,
        academicPeriodId: academicPeriod.id,
        courseId: courseByCode[courseCode].id,
        studentCohortId: cohort.id,
        membershipMode: "FULL_COHORT",
        schedulingPriority,
        name: `${cohort.code} ${courseCode}`,
        code,
        status: "ACTIVE",
        maxStudents: 10,
      },
    });

    teachingGroupByCode[code] = group;

    // FULL_COHORT membership is deterministic: remove stale rows from earlier
    // demo seeds, then materialise the current cohort membership.
    await prisma.teachingGroupStudent.deleteMany({
      where: {
        tenantId: tenant.id,
        teachingGroupId: group.id,
      },
    });

    for (const student of students) {
      await prisma.teachingGroupStudent.create({
        data: {
          tenantId: tenant.id,
          teachingGroupId: group.id,
          studentId: student.id,
        },
      });
    }
  }

  const teachingRequirementDefinitions = [
    ["G1", 1620, 90, 180],
    ["G2", 810, 45, 90],
    ["G3", 810, 45, 90],
    ["G4", 810, 45, 90],
  ] as const;

  for (const [groupCode, totalMinutes, preferredWeeklyMinutes, maxWeeklyMinutes] of teachingRequirementDefinitions) {
    await prisma.teachingRequirement.upsert({
      where: {
        tenantId_teachingGroupId_academicPeriodId: {
          tenantId: tenant.id,
          teachingGroupId: teachingGroupByCode[groupCode].id,
          academicPeriodId: academicPeriod.id,
        },
      },
      update: {
        totalMinutes,
        distributionMode: "EVEN_BY_TEACHING_CAPACITY",
        preferredWeeklyMinutes,
        maxWeeklyMinutes,
        carryoverAllowed: true,
        priority: "HIGH",
        active: true,
      },
      create: {
        tenantId: tenant.id,
        teachingGroupId: teachingGroupByCode[groupCode].id,
        academicPeriodId: academicPeriod.id,
        totalMinutes,
        distributionMode: "EVEN_BY_TEACHING_CAPACITY",
        preferredWeeklyMinutes,
        maxWeeklyMinutes,
        carryoverAllowed: true,
        priority: "HIGH",
      },
    });
  }

  // A cohort-level activity day blocks ordinary teaching for the entire class.
  // The weekly allocation step can then compensate through other days/weeks.
  const activityStart = new Date("2026-09-10T06:00:00.000Z");
  const activityEnd = new Date("2026-09-10T14:00:00.000Z");

  const existingActivityDay = await prisma.planningException.findFirst({
    where: {
      tenantId: tenant.id,
      studentCohortId: cohort.id,
      type: "ACTIVITY_DAY",
      name: "ST2A activity day",
    },
  });

  if (existingActivityDay) {
    await prisma.planningException.update({
      where: { id: existingActivityDay.id },
      data: {
        status: "ACTIVE",
        impactMode: "BLOCK",
        startAt: activityStart,
        endAt: activityEnd,
        description: "Demo cohort activity. Ordinary teaching is blocked for ST2A.",
      },
    });
  } else {
    await prisma.planningException.create({
      data: {
        tenantId: tenant.id,
        studentCohortId: cohort.id,
        type: "ACTIVITY_DAY",
        status: "ACTIVE",
        impactMode: "BLOCK",
        name: "ST2A activity day",
        description: "Demo cohort activity. Ordinary teaching is blocked for ST2A.",
        startAt: activityStart,
        endAt: activityEnd,
      },
    });
  }

  const roomCoursePreferences = [
    ["A10", "MAT", "PREFERRED", 0],
    ["A11", "MAT", "ALLOWED", 15],
    ["B14", "MAT", "AVOID", 90],
    ["A10", "FYS", "ALLOWED", 20],
    ["A11", "FYS", "ALLOWED", 15],
    ["B14", "FYS", "PREFERRED", 0],
    ["A10", "ENG", "ALLOWED", 15],
    ["A11", "ENG", "PREFERRED", 0],
    ["B14", "ENG", "ALLOWED", 20],
    ["A10", "NOR", "ALLOWED", 15],
    ["A11", "NOR", "PREFERRED", 0],
    ["B14", "NOR", "ALLOWED", 20],
  ] as const;

  for (const [roomCode, courseCode, suitability, penalty] of roomCoursePreferences) {
    await prisma.roomCoursePreference.upsert({
      where: {
        tenantId_roomId_courseId: {
          tenantId: tenant.id,
          roomId: roomByCode[roomCode].id,
          courseId: courseByCode[courseCode].id,
        },
      },
      update: {
        suitability,
        penalty,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        roomId: roomByCode[roomCode].id,
        courseId: courseByCode[courseCode].id,
        suitability,
        penalty,
      },
    });
  }

  const travelPairs = [
    ["A10", "A11", 3],
    ["A11", "A10", 3],
    ["A10", "B14", 12],
    ["B14", "A10", 12],
    ["A11", "B14", 12],
    ["B14", "A11", 12],
  ] as const;

  for (const [fromCode, toCode, minutes] of travelPairs) {
    await prisma.roomTravelTime.upsert({
      where: {
        tenantId_fromRoomId_toRoomId: {
          tenantId: tenant.id,
          fromRoomId: roomByCode[fromCode].id,
          toRoomId: roomByCode[toCode].id,
        },
      },
      update: {
        minutes,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        fromRoomId: roomByCode[fromCode].id,
        toRoomId: roomByCode[toCode].id,
        minutes,
      },
    });
  }

  const instructorGroupPreferences = [
    ["T1", "G1", "PREFER", 40, "CONTINUITY"],
    ["T2", "G1", "AVOID", 120, "PLANNING_CONSIDERATION"],
  ] as const;

  for (const [instructorExternalId, groupCode, preference, weight, reasonCode] of instructorGroupPreferences) {
    await prisma.instructorTeachingGroupPreference.upsert({
      where: {
        tenantId_instructorId_teachingGroupId: {
          tenantId: tenant.id,
          instructorId: instructorByExternalId[instructorExternalId].id,
          teachingGroupId: teachingGroupByCode[groupCode].id,
        },
      },
      update: {
        preference,
        weight,
        reasonCode,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        instructorId: instructorByExternalId[instructorExternalId].id,
        teachingGroupId: teachingGroupByCode[groupCode].id,
        preference,
        weight,
        reasonCode,
      },
    });
  }

  // Demo availability inside the future planning horizon. These rows prove that
  // contract 1.2 can move teaching around unavailable resources without changing
  // anything before planningStartDate.
  await prisma.instructorAvailability.deleteMany({
    where: { tenantId: tenant.id, reasonCode: "DEMO_HORIZON_BLOCK" },
  });
  await prisma.instructorAvailability.create({
    data: {
      tenantId: tenant.id,
      instructorId: instructorByExternalId["T1"].id,
      date: new Date("2026-09-16T00:00:00.000Z"),
      startMinute: 8 * 60,
      endMinute: 12 * 60,
      status: "UNAVAILABLE",
      reasonCode: "DEMO_HORIZON_BLOCK",
    },
  });

  await prisma.roomAvailability.deleteMany({
    where: { tenantId: tenant.id, reasonCode: "DEMO_HORIZON_BLOCK" },
  });
  await prisma.roomAvailability.create({
    data: {
      tenantId: tenant.id,
      roomId: roomByCode["A10"].id,
      date: new Date("2026-09-17T00:00:00.000Z"),
      startMinute: 0,
      endMinute: 24 * 60,
      status: "UNAVAILABLE",
      reasonCode: "DEMO_HORIZON_BLOCK",
    },
  });

  const loadProfile = await prisma.loadProfile.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "STANDARD",
      },
    },
    update: {
      maxTeachingMinutesPerDay: 270,
      maxContinuousTeachingMinutes: 120,
      minBreakMinutes: 15,
      minLunchMinutes: 30,
      maxSessionsPerDay: 4,
      minRealBreakMinutes: 15,
      travelConsumesBreakTime: true,
      active: true,
    },
    create: {
      tenantId: tenant.id,
      name: "Standard student profile",
      code: "STANDARD",
      maxTeachingMinutesPerDay: 270,
      maxContinuousTeachingMinutes: 120,
      minBreakMinutes: 15,
      minLunchMinutes: 30,
      maxSessionsPerDay: 4,
      minRealBreakMinutes: 15,
      travelConsumesBreakTime: true,
    },
  });

  await prisma.student.updateMany({
    where: {
      tenantId: tenant.id,
    },
    data: {
      loadProfileId: loadProfile.id,
    },
  });

  const planningScope = await prisma.planningScope.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "DEMO-SCOPE",
      },
    },
    update: {
      academicPeriodId: academicPeriod.id,
      status: "ACTIVE",
    },
    create: {
      tenantId: tenant.id,
      academicPeriodId: academicPeriod.id,
      name: "Demo planning scope",
      code: "DEMO-SCOPE",
      status: "ACTIVE",
    },
  });

  const plan = await prisma.plan.upsert({
    where: {
      tenantId_planningScopeId_version: {
        tenantId: tenant.id,
        planningScopeId: planningScope.id,
        version: 1,
      },
    },
    update: {
      planningAsOfDate: new Date("2026-09-01T00:00:00.000Z"),
      frozenThroughDate: new Date("2026-09-13T00:00:00.000Z"),
      planningStartDate: new Date("2026-09-14T00:00:00.000Z"),
      planningEndDate: new Date("2026-12-18T00:00:00.000Z"),
      effectiveFrom: new Date("2026-09-14T00:00:00.000Z"),
      effectiveTo: new Date("2026-12-18T00:00:00.000Z"),
    },
    create: {
      tenantId: tenant.id,
      planningScopeId: planningScope.id,
      academicPeriodId: academicPeriod.id,
      name: "Demo plan",
      version: 1,
      status: "DRAFT",
      planningAsOfDate: new Date("2026-09-01T00:00:00.000Z"),
      frozenThroughDate: new Date("2026-09-13T00:00:00.000Z"),
      planningStartDate: new Date("2026-09-14T00:00:00.000Z"),
      planningEndDate: new Date("2026-12-18T00:00:00.000Z"),
      effectiveFrom: new Date("2026-09-14T00:00:00.000Z"),
      effectiveTo: new Date("2026-12-18T00:00:00.000Z"),
    },
  });

  const reviewWorkflow = await prisma.planReviewWorkflow.upsert({
    where: {
      tenantId_planId_name: {
        tenantId: tenant.id,
        planId: plan.id,
        name: "Standard plan approval",
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      planId: plan.id,
      name: "Standard plan approval",
      status: "DRAFT",
    },
  });

  const reviewSteps = [
    { stage: 1, position: 1, name: "Academic review", reviewerRole: "ACADEMIC_OWNER" },
    { stage: 2, position: 1, name: "Final approval", reviewerRole: "RECTOR" },
  ] as const;

  for (const step of reviewSteps) {
    await prisma.planReviewStep.upsert({
      where: {
        tenantId_workflowId_stage_position: {
          tenantId: tenant.id,
          workflowId: reviewWorkflow.id,
          stage: step.stage,
          position: step.position,
        },
      },
      update: {
        name: step.name,
        reviewerRole: step.reviewerRole,
        required: true,
      },
      create: {
        tenantId: tenant.id,
        workflowId: reviewWorkflow.id,
        stage: step.stage,
        position: step.position,
        name: step.name,
        reviewerRole: step.reviewerRole,
        required: true,
      },
    });
  }

  const existingScenario = await prisma.planScenario.findFirst({
    where: {
      tenantId: tenant.id,
      planId: plan.id,
      name: "Initial solver scenario",
    },
  });

  const scenario =
    existingScenario ??
    (await prisma.planScenario.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        name: "Initial solver scenario",
        status: "DRAFT",
      },
    }));

  console.log("Seed complete");
  console.log({
    tenantId: tenant.id,
    planningScopeId: planningScope.id,
    planId: plan.id,
    planScenarioId: scenario.id,
    studentCohortId: cohort.id,
    roomIds: {
      A10: roomByCode.A10.id,
      A11: roomByCode.A11.id,
      B14: roomByCode.B14.id,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
