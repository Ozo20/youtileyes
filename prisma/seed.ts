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

  const demoUser = await prisma.user.upsert({
    where: { email: "ola.solem@example.test" },
    update: {
      name: "Ola Solem",
      active: true,
    },
    create: {
      email: "ola.solem@example.test",
      name: "Ola Solem",
      active: true,
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: demoUser.id,
      },
    },
    update: {
      role: "ADMIN",
      active: true,
    },
    create: {
      tenantId: tenant.id,
      userId: demoUser.id,
      role: "ADMIN",
      active: true,
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

  const existingCampusA = await prisma.location.findUnique({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "CAMPUS-A",
      },
    },
  });

  const existingCampusACode = await prisma.location.findUnique({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "CA",
      },
    },
  });

  if (existingCampusA && !existingCampusACode) {
    await prisma.location.update({
      where: { id: existingCampusA.id },
      data: { code: "CA" },
    });
  }

  const location = await prisma.location.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "CA",
      },
    },
    update: {
      type: "CAMPUS",
      name: "Campus A",
      city: "Trondheim",
      countryCode: "NO",
      timezone: "Europe/Oslo",
      active: true,
    },
    create: {
      tenantId: tenant.id,
      type: "CAMPUS",
      name: "Campus A",
      code: "CA",
      city: "Trondheim",
      countryCode: "NO",
      timezone: "Europe/Oslo",
    },
  });

  const roomDefinitions = [
    { seedKey: "A10", code: "CA-A10", name: "A10", capacity: 10 },
    { seedKey: "A11", code: "CA-A11", name: "A11", capacity: 10 },
    { seedKey: "B14", code: "CA-B14", name: "B14", capacity: 10 },
  ] as const;

  for (const definition of roomDefinitions) {
    const legacyRoom = await prisma.room.findUnique({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: definition.seedKey,
        },
      },
    });

    const currentRoom = await prisma.room.findUnique({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: definition.code,
        },
      },
    });

    if (legacyRoom && !currentRoom) {
      await prisma.room.update({
        where: { id: legacyRoom.id },
        data: {
          code: definition.code,
          name: definition.name,
          locationId: location.id,
        },
      });
    }
  }

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
          name: definition.name,
          locationId: location.id,
          capacity: definition.capacity,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          locationId: location.id,
          name: definition.name,
          code: definition.code,
          capacity: definition.capacity,
        },
      }),
    ),
  );

  const roomByCode = Object.fromEntries(
    roomDefinitions.map((definition, index) => [
      definition.seedKey,
      rooms[index],
    ]),
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

  // Legacy teaching-role qualifications were replaced by the
  // subject-specific InstructorCourse qualification model.
  //
  // Remove old demo rows during reseed so SUBJECT_LEAD and
  // TEACHING_SUPPORT do not remain as duplicate teaching concepts.
  const legacyTeachingQualifications = await prisma.qualification.findMany({
    where: {
      tenantId: tenant.id,
      code: {
        in: ["SUBJECT_LEAD", "TEACHING_SUPPORT"],
      },
    },
    select: {
      id: true,
    },
  });

  const legacyTeachingQualificationIds = legacyTeachingQualifications.map(
    (qualification) => qualification.id,
  );

  if (legacyTeachingQualificationIds.length > 0) {
    await prisma.staffingRequirement.updateMany({
      where: {
        tenantId: tenant.id,
        requiredQualificationId: {
          in: legacyTeachingQualificationIds,
        },
      },
      data: {
        requiredQualificationId: null,
        minimumQualificationLevel: null,
      },
    });

    await prisma.instructorQualification.deleteMany({
      where: {
        tenantId: tenant.id,
        qualificationId: {
          in: legacyTeachingQualificationIds,
        },
      },
    });

    await prisma.qualification.deleteMany({
      where: {
        tenantId: tenant.id,
        id: {
          in: legacyTeachingQualificationIds,
        },
      },
    });
  }

  const qualificationDefinitions = [
    ["ADJUNKT", "Adjunkt", "Institution-defined formal qualification or credential."],
    ["LEKTOR", "Lektor", "Institution-defined formal qualification or credential."],
    ["PROFESSOR", "Professor", "Institution-defined academic qualification or title."],
  ] as const;

  for (const [code, name, description] of qualificationDefinitions) {
    await prisma.qualification.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: {
        name,
        description,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        code,
        name,
        description,
        active: true,
      },
    });
  }

  const instructorCourses = [
    ["T1", "MAT", "PRIMARY", 100],
    ["T1", "FYS", "PRIMARY", 100],
    ["T1", "NOR", "SUPPORT", 100],
    ["T2", "ENG", "PRIMARY", 100],
    ["T2", "NOR", "PRIMARY", 100],
    ["T2", "MAT", "SECONDARY", 100],
    ["T2", "FYS", "SUPPORT", 100],
  ] as const;

  for (const [
    instructorExternalId,
    courseCode,
    qualificationLevel,
    priority,
  ] of instructorCourses) {
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

  // Demo staffing rules. Physics requires both a qualified lead and an
  // assisting teacher. The assistant may hold a lower qualification level.
  const physicsGroup = teachingGroupByCode["G3"];
  const physicsCourse = courseByCode["FYS"];

  const existingPhysicsStaffing = await prisma.staffingRequirement.findMany({
    where: {
      tenantId: tenant.id,
      OR: [
        { teachingGroupId: physicsGroup.id },
        { courseId: physicsCourse.id },
      ],
    },
  });

  for (const existing of existingPhysicsStaffing) {
    await prisma.staffingRequirement.delete({ where: { id: existing.id } });
  }

  await prisma.staffingRequirement.createMany({
    data: [
      {
        tenantId: tenant.id,
        source: "COURSE",
        courseId: physicsCourse.id,
        role: "LEAD",
        count: 1,
        minimumCourseQualificationLevel: "PRIMARY",
        minimumCourseLevel: 70,
        preferredCourseLevel: 90,
        priority: 200,
        hard: true,
      },
      {
        tenantId: tenant.id,
        source: "COURSE",
        courseId: physicsCourse.id,
        role: "ASSISTANT",
        count: 1,
        minimumCourseQualificationLevel: "SUPPORT",
        minimumCourseLevel: 40,
        preferredCourseLevel: 70,
        priority: 180,
        hard: true,
      },
    ],
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

  const teachingRequirementDefinitions = [
    ["G1", 1620, 90, 180],
    ["G2", 810, 45, 90],
    ["G3", 810, 45, 90],
    ["G4", 810, 45, 90],
  ] as const;

  for (const [
    groupCode,
    totalMinutes,
    preferredWeeklyMinutes,
    maxWeeklyMinutes,
  ] of teachingRequirementDefinitions) {
    await prisma.teachingRequirement.upsert({
      where: {
        tenantId_planId_teachingGroupId: {
          tenantId: tenant.id,
          planId: plan.id,
          teachingGroupId: teachingGroupByCode[groupCode].id,
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
        planId: plan.id,
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
        description:
          "Demo cohort activity. Ordinary teaching is blocked for ST2A.",
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
        description:
          "Demo cohort activity. Ordinary teaching is blocked for ST2A.",
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

  for (const [
    roomCode,
    courseCode,
    suitability,
    penalty,
  ] of roomCoursePreferences) {
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

  for (const [
    instructorExternalId,
    groupCode,
    preference,
    weight,
    reasonCode,
  ] of instructorGroupPreferences) {
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

  // ---------------------------------------------------------------------------
  // Expanded demo dataset
  // ---------------------------------------------------------------------------
  // The original seed intentionally started very small. The expanded dataset
  // below keeps those records, but grows the same DEMO tenant into something
  // closer to a realistic semester-planning exercise:
  //
  // - 4 classes / cohorts
  // - 80 students
  // - 8 subjects
  // - 12 instructors
  // - 8 rooms
  // - 32 full-class teaching groups
  // - 32 semester teaching requirements
  // - daily timetable blocks
  // - a full autumn-break closure plus selected activity / availability events
  //
  // Codes are deterministic and every record is upserted so the seed remains
  // safe to run repeatedly.

  const expandedRoomDefinitions = [
    { seedKey: "A10", code: "CA-A10", name: "A10", capacity: 24 },
    { seedKey: "A11", code: "CA-A11", name: "A11", capacity: 24 },
    { seedKey: "B14", code: "CA-B14", name: "B14", capacity: 24 },
    { seedKey: "C20", code: "CA-C20", name: "C20", capacity: 30 },
    { seedKey: "C21", code: "CA-C21", name: "C21", capacity: 30 },
    { seedKey: "LAB1", code: "CA-LAB1", name: "LAB1", capacity: 24 },
    { seedKey: "LAB2", code: "CA-LAB2", name: "LAB2", capacity: 24 },
    { seedKey: "D30", code: "CA-D30", name: "D30", capacity: 32 },
  ] as const;

  const expandedRooms = await Promise.all(
    expandedRoomDefinitions.map((definition) =>
      prisma.room.upsert({
        where: {
          tenantId_code: {
            tenantId: tenant.id,
            code: definition.code,
          },
        },
        update: {
          locationId: location.id,
          name: definition.name,
          capacity: definition.capacity,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          locationId: location.id,
          name: definition.name,
          code: definition.code,
          capacity: definition.capacity,
        },
      }),
    ),
  );

  const expandedRoomByCode = Object.fromEntries(
    expandedRoomDefinitions.map((definition, index) => [
      definition.seedKey,
      expandedRooms[index],
    ]),
  );

  const extraCourseDefinitions = [
    {
      code: "SAM",
      name: "Social Studies",
      minutes: 45,
      double: false,
      maxSessionsPerDay: 2,
    },
    {
      code: "HIS",
      name: "History",
      minutes: 45,
      double: false,
      maxSessionsPerDay: 2,
    },
    {
      code: "GEO",
      name: "Geography",
      minutes: 45,
      double: false,
      maxSessionsPerDay: 2,
    },
    {
      code: "IT",
      name: "Information Technology",
      minutes: 90,
      double: true,
      maxSessionsPerDay: 2,
    },
  ] as const;

  const extraCourses = await Promise.all(
    extraCourseDefinitions.map((definition) =>
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
          maxSessionsPerDay: definition.maxSessionsPerDay,
          maxGroupSize: 24,
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
          maxSessionsPerDay: definition.maxSessionsPerDay,
          maxGroupSize: 24,
        },
      }),
    ),
  );

  const allCourseByCode: Record<string, { id: string; code: string | null }> = {
    ...courseByCode,
    ...Object.fromEntries(extraCourses.map((course) => [course.code!, course])),
  };

  // Bring the original subjects up to the same class-size assumptions.
  await prisma.course.updateMany({
    where: {
      tenantId: tenant.id,
      code: { in: ["MAT", "FYS", "ENG", "NOR"] },
    },
    data: {
      maxGroupSize: 24,
    },
  });

  const extraInstructorDefinitions = [
    ["T3", "Anna", "Berg", 100, 1200],
    ["T4", "Morten", "Dahl", 100, 1200],
    ["T5", "Ingrid", "Nilsen", 80, 960],
    ["T6", "Thomas", "Moen", 100, 1200],
    ["T7", "Silje", "Aune", 90, 1080],
    ["T8", "Henrik", "Larsen", 100, 1200],
    ["T9", "Maria", "Solberg", 80, 960],
    ["T10", "Anders", "Vik", 100, 1200],
    ["T11", "Elise", "Haugen", 100, 1200],
    ["T12", "Jonas", "Lie", 80, 960],
  ] as const;

  const extraInstructors = await Promise.all(
    extraInstructorDefinitions.map(
      ([
        externalId,
        firstName,
        lastName,
        employmentPercentage,
        maxTeachingMinutesPerWeek,
      ]) =>
        prisma.instructor.upsert({
          where: {
            tenantId_externalId_sourceSystem: {
              tenantId: tenant.id,
              externalId,
              sourceSystem: "SEED",
            },
          },
          update: {
            firstName,
            lastName,
            status: "ACTIVE",
            employmentPercentage,
            maxTeachingMinutesPerWeek,
            primaryOrganisationUnitId: organisation.id,
            primaryLocationId: location.id,
          },
          create: {
            tenantId: tenant.id,
            externalId,
            sourceSystem: "SEED",
            firstName,
            lastName,
            employmentPercentage,
            maxTeachingMinutesPerWeek,
            primaryOrganisationUnitId: organisation.id,
            primaryLocationId: location.id,
          },
        }),
    ),
  );

  // Add realistic workload limits to the two original demo teachers as well.
  await prisma.instructor.updateMany({
    where: {
      tenantId: tenant.id,
      externalId: { in: ["T1", "T2"] },
      sourceSystem: "SEED",
    },
    data: {
      employmentPercentage: 100,
      maxTeachingMinutesPerWeek: 1200,
    },
  });

  const expandedInstructorByExternalId: Record<string, { id: string }> = {
    ...instructorByExternalId,
    ...Object.fromEntries(
      extraInstructors.map((instructor) => [
        instructor.externalId!,
        instructor,
      ]),
    ),
  };

  const expandedInstructorCourses = [
    ["T1", "MAT", "PRIMARY", 100],
    ["T1", "FYS", "PRIMARY", 100],
    ["T2", "ENG", "PRIMARY", 100],
    ["T2", "NOR", "PRIMARY", 100],
    ["T3", "MAT", "PRIMARY", 100],
    ["T3", "FYS", "SECONDARY", 110],
    ["T4", "ENG", "PRIMARY", 100],
    ["T4", "NOR", "SECONDARY", 110],
    ["T5", "FYS", "PRIMARY", 100],
    ["T5", "MAT", "SUPPORT", 130],
    ["T6", "NOR", "PRIMARY", 100],
    ["T6", "HIS", "PRIMARY", 100],
    ["T7", "SAM", "PRIMARY", 100],
    ["T7", "GEO", "PRIMARY", 100],
    ["T8", "IT", "PRIMARY", 100],
    ["T8", "MAT", "SECONDARY", 120],
    ["T9", "ENG", "PRIMARY", 100],
    ["T9", "SAM", "SECONDARY", 120],
    ["T10", "HIS", "PRIMARY", 100],
    ["T10", "GEO", "PRIMARY", 100],
    ["T11", "IT", "PRIMARY", 100],
    ["T11", "FYS", "SUPPORT", 130],
    ["T12", "NOR", "PRIMARY", 100],
    ["T12", "ENG", "SECONDARY", 120],
  ] as const;

  for (const [
    instructorExternalId,
    courseCode,
    qualificationLevel,
    priority,
  ] of expandedInstructorCourses) {
    await prisma.instructorCourse.upsert({
      where: {
        tenantId_instructorId_courseId: {
          tenantId: tenant.id,
          instructorId: expandedInstructorByExternalId[instructorExternalId].id,
          courseId: allCourseByCode[courseCode].id,
        },
      },
      update: {
        qualificationLevel,
        priority,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        instructorId: expandedInstructorByExternalId[instructorExternalId].id,
        courseId: allCourseByCode[courseCode].id,
        qualificationLevel,
        priority,
      },
    });
  }

  // Give Per Olsen's existing FYS link an explicit numeric competence
  // level so he can satisfy the FYS ASSISTANT staffing requirement.
  //
  // Kari remains the stronger FYS lead; Per is deliberately only level 40.
  const perOlsen = await prisma.instructor.findFirstOrThrow({
    where: {
      tenantId: tenant.id,
      firstName: "Per",
      lastName: "Olsen",
      status: "ACTIVE",
    },
  });

  await prisma.instructorCourse.update({
    where: {
      tenantId_instructorId_courseId: {
        tenantId: tenant.id,
        instructorId: perOlsen.id,
        courseId: allCourseByCode.FYS.id,
      },
    },
    data: {
      competenceLevel: 40,
      active: true,
    },
  });

  // Numeric course competence and general teaching preferences.
  //
  // PRIMARY / SECONDARY / SUPPORT still describes the instructor's role,
  // while competenceLevel is the numeric solver signal used by staffing
  // minimum/preferred levels.
  const expandedCourseCompetence = [
    ["T1", "MAT", 90, "PREFER", 120],
    ["T1", "FYS", 90, "NEUTRAL", 100],
    ["T2", "ENG", 90, "PREFER", 120],
    ["T2", "NOR", 90, "NEUTRAL", 100],

    ["T3", "MAT", 90, "PREFER", 140],
    ["T3", "FYS", 70, "NEUTRAL", 100],

    ["T4", "ENG", 90, "PREFER", 140],
    ["T4", "NOR", 70, "NEUTRAL", 100],

    ["T5", "FYS", 90, "PREFER", 180],
    ["T5", "MAT", 40, "AVOID", 120],

    ["T6", "NOR", 90, "PREFER", 150],
    ["T6", "HIS", 90, "NEUTRAL", 100],

    ["T7", "SAM", 90, "PREFER", 150],
    ["T7", "GEO", 90, "NEUTRAL", 100],

    ["T8", "IT", 90, "PREFER", 200],
    ["T8", "MAT", 70, "NEUTRAL", 100],

    ["T9", "ENG", 90, "PREFER", 140],
    ["T9", "SAM", 70, "NEUTRAL", 100],

    ["T10", "HIS", 90, "PREFER", 160],
    ["T10", "GEO", 90, "NEUTRAL", 100],

    ["T11", "IT", 90, "PREFER", 160],
    ["T11", "FYS", 40, "AVOID", 150],

    ["T12", "NOR", 90, "PREFER", 140],
    ["T12", "ENG", 70, "NEUTRAL", 100],
  ] as const;

  for (const [
    instructorExternalId,
    courseCode,
    competenceLevel,
    preference,
    preferenceWeight,
  ] of expandedCourseCompetence) {
    await prisma.instructorCourse.update({
      where: {
        tenantId_instructorId_courseId: {
          tenantId: tenant.id,
          instructorId: expandedInstructorByExternalId[instructorExternalId].id,
          courseId: allCourseByCode[courseCode].id,
        },
      },
      data: {
        competenceLevel,
        preference,
        preferenceWeight,
        active: true,
      },
    });
  }

  // ----------------------------------------------------------------
  // Room features and inventory
  // ----------------------------------------------------------------
  const roomFeatureDefinitions = [
    ["PROJECTOR", "Projector"],
    ["COMPUTER", "Computer workstation"],
    ["LAB_STATION", "Laboratory station"],
    ["SINK", "Laboratory sink"],
    ["STEP_FREE", "Step-free access"],
  ] as const;

  const seededRoomFeatures: Record<string, { id: string }> = {};

  for (const [code, name] of roomFeatureDefinitions) {
    const feature = await prisma.roomFeature.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: { name },
      create: {
        tenantId: tenant.id,
        code,
        name,
      },
    });

    seededRoomFeatures[code] = feature;
  }

  const roomFeatureInventory = [
    ["A10", "PROJECTOR", 1],
    ["A11", "PROJECTOR", 1],
    ["B14", "PROJECTOR", 1],
    ["C20", "PROJECTOR", 1],
    ["C21", "PROJECTOR", 1],
    ["D30", "PROJECTOR", 1],
    ["LAB1", "PROJECTOR", 1],
    ["LAB2", "PROJECTOR", 1],

    ["C21", "COMPUTER", 24],

    ["LAB1", "LAB_STATION", 24],
    ["LAB2", "LAB_STATION", 24],
    ["LAB1", "SINK", 6],
    ["LAB2", "SINK", 6],

    ["A10", "STEP_FREE", 1],
    ["C20", "STEP_FREE", 1],
    ["C21", "STEP_FREE", 1],
    ["D30", "STEP_FREE", 1],
  ] as const;

  for (const [roomCode, featureCode, quantity] of roomFeatureInventory) {
    const roomId = expandedRoomByCode[roomCode].id;
    const featureId = seededRoomFeatures[featureCode].id;

    await prisma.roomFeatureValue.upsert({
      where: {
        tenantId_roomId_featureId: {
          tenantId: tenant.id,
          roomId,
          featureId,
        },
      },
      update: { quantity },
      create: {
        tenantId: tenant.id,
        roomId,
        featureId,
        quantity,
      },
    });
  }

  async function seedRoomRequirement(input: {
    featureCode: string;
    courseCode?: string;
    studentId?: string;
    instructorExternalId?: string;
    quantity: number;
    perStudent?: boolean;
    hard: boolean;
    weight: number;
  }) {
    const featureId = seededRoomFeatures[input.featureCode].id;
    const courseId = input.courseCode
      ? allCourseByCode[input.courseCode].id
      : null;
    const instructorId = input.instructorExternalId
      ? expandedInstructorByExternalId[input.instructorExternalId].id
      : null;
    const studentId = input.studentId ?? null;

    const existing = await prisma.roomRequirement.findFirst({
      where: {
        tenantId: tenant.id,
        featureId,
        courseId,
        studentId,
        instructorId,
      },
    });

    const data = {
      quantity: input.quantity,
      perStudent: input.perStudent ?? false,
      hard: input.hard,
      weight: input.weight,
      active: true,
    };

    if (existing) {
      await prisma.roomRequirement.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.roomRequirement.create({
        data: {
          tenantId: tenant.id,
          featureId,
          courseId,
          studentId,
          instructorId,
          ...data,
        },
      });
    }
  }

  // IT requires one workstation per participating student.
  await seedRoomRequirement({
    featureCode: "COMPUTER",
    courseCode: "IT",
    quantity: 1,
    perStudent: true,
    hard: true,
    weight: 1000,
  });

  // Physics strongly prefers a proper laboratory but may be placed elsewhere
  // if the overall timetable requires it.
  await seedRoomRequirement({
    featureCode: "LAB_STATION",
    courseCode: "FYS",
    quantity: 1,
    hard: false,
    weight: 150,
  });

  // Eight ordinary 45-minute timetable blocks. Courses that prefer 90 minutes
  // can later consume adjacent blocks when the long-horizon solver supports
  // explicit double-block composition.
  const timeBlockDefinitions = [
    ["P1", 8 * 60 + 15, 9 * 60],
    ["P2", 9 * 60 + 15, 10 * 60],
    ["P3", 10 * 60 + 15, 11 * 60],
    ["P4", 11 * 60 + 15, 12 * 60],
    ["P5", 12 * 60 + 45, 13 * 60 + 30],
    ["P6", 13 * 60 + 45, 14 * 60 + 30],
    ["P7", 14 * 60 + 45, 15 * 60 + 30],
    ["P8", 15 * 60 + 45, 16 * 60 + 30],
  ] as const;

  // TimeBlock currently has no natural-code unique key, so replace only the
  // deterministic seed blocks and leave any manually created blocks untouched.
  await prisma.timeBlock.deleteMany({
    where: {
      tenantId: tenant.id,
      name: { in: timeBlockDefinitions.map(([name]) => name) },
    },
  });

  await prisma.timeBlock.createMany({
    data: timeBlockDefinitions.map(([name, startMinute, endMinute]) => ({
      tenantId: tenant.id,
      name,
      startMinute,
      endMinute,
      active: true,
    })),
  });

  const cohortDefinitions = [
    ["ST2A", "ST2A"],
    ["ST2B", "ST2B"],
    ["ST3A", "ST3A"],
    ["ST3B", "ST3B"],
  ] as const;

  const expandedCohortByCode: Record<
    string,
    { id: string; code: string | null }
  > = {
    ST2A: cohort,
  };

  for (const [code, name] of cohortDefinitions.slice(1)) {
    const seededCohort = await prisma.studentCohort.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: {
        academicPeriodId: academicPeriod.id,
        organisationUnitId: organisation.id,
        type: "CLASS",
        name,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        academicPeriodId: academicPeriod.id,
        organisationUnitId: organisation.id,
        type: "CLASS",
        name,
        code,
      },
    });

    expandedCohortByCode[code] = seededCohort;
  }

  // Clean up the obsolete ST2A-06 row created by an earlier expanded seed.
  // The original small demo already contains S1-S6, so ST2A-06 would otherwise
  // leave ST2A with 21 active students.
  const obsoleteSt2A06 = await prisma.student.findFirst({
    where: {
      tenantId: tenant.id,
      externalId: "ST2A-06",
      sourceSystem: "SEED",
    },
  });

  if (obsoleteSt2A06) {
    await prisma.studentCohortMember.deleteMany({
      where: {
        tenantId: tenant.id,
        studentId: obsoleteSt2A06.id,
      },
    });

    await prisma.teachingGroupStudent.deleteMany({
      where: {
        tenantId: tenant.id,
        studentId: obsoleteSt2A06.id,
      },
    });

    await prisma.studentCourseRequirement.deleteMany({
      where: {
        tenantId: tenant.id,
        studentId: obsoleteSt2A06.id,
      },
    });

    await prisma.student.update({
      where: { id: obsoleteSt2A06.id },
      data: { status: "INACTIVE" },
    });
  }

  const expandedStudentsByCohort: Record<string, Array<{ id: string }>> = {
    ST2A: [...students],
    ST2B: [],
    ST3A: [],
    ST3B: [],
  };

  // ST2A already contains S1-S6 from the small demo. Add 14 more students, and
  // create 20 students in each of the other three classes: 80 students total.
  const studentSeedDefinitions: Array<{
    cohortCode: string;
    externalId: string;
    firstName: string;
    lastName: string;
  }> = [];

  for (let index = 7; index <= 20; index += 1) {
    studentSeedDefinitions.push({
      cohortCode: "ST2A",
      externalId: `ST2A-${String(index).padStart(2, "0")}`,
      firstName: `Student ${index}`,
      lastName: "ST2A",
    });
  }

  for (const cohortCode of ["ST2B", "ST3A", "ST3B"] as const) {
    for (let index = 1; index <= 20; index += 1) {
      studentSeedDefinitions.push({
        cohortCode,
        externalId: `${cohortCode}-${String(index).padStart(2, "0")}`,
        firstName: `Student ${index}`,
        lastName: cohortCode,
      });
    }
  }

  for (const definition of studentSeedDefinitions) {
    const student = await prisma.student.upsert({
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
    });

    expandedStudentsByCohort[definition.cohortCode].push(student);

    await prisma.studentCohortMember.upsert({
      where: {
        tenantId_studentCohortId_studentId: {
          tenantId: tenant.id,
          studentCohortId: expandedCohortByCode[definition.cohortCode].id,
          studentId: student.id,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        studentCohortId: expandedCohortByCode[definition.cohortCode].id,
        studentId: student.id,
      },
    });
  }

  // Individual functional room need. Keep this about the functional
  // requirement rather than medical/diagnostic information.
  const stepFreeStudent = expandedStudentsByCohort.ST3B[0];

  if (!stepFreeStudent) {
    throw new Error("Expanded seed expected at least one ST3B student.");
  }

  await seedRoomRequirement({
    featureCode: "STEP_FREE",
    studentId: stepFreeStudent.id,
    quantity: 1,
    hard: true,
    weight: 1000,
  });

  const subjectDemand = {
    MAT: {
      total: 4320,
      preferred: 240,
      min: 180,
      max: 360,
      priority: "CRITICAL",
    },
    NOR: { total: 3240, preferred: 180, min: 135, max: 270, priority: "HIGH" },
    ENG: { total: 2700, preferred: 150, min: 90, max: 225, priority: "HIGH" },
    FYS: { total: 2160, preferred: 120, min: 90, max: 180, priority: "HIGH" },
    IT: { total: 2160, preferred: 120, min: 90, max: 180, priority: "NORMAL" },
    SAM: { total: 1620, preferred: 90, min: 45, max: 135, priority: "NORMAL" },
    HIS: { total: 1620, preferred: 90, min: 45, max: 135, priority: "NORMAL" },
    GEO: { total: 1620, preferred: 90, min: 45, max: 135, priority: "NORMAL" },
  } as const;

  const subjectOrder = [
    "MAT",
    "NOR",
    "ENG",
    "FYS",
    "IT",
    "SAM",
    "HIS",
    "GEO",
  ] as const;

  // Preserve the original G1-G4 codes for ST2A and add deterministic codes for
  // all remaining cohort/subject combinations.
  const originalGroupCodeBySubject = {
    MAT: "G1",
    ENG: "G2",
    FYS: "G3",
    NOR: "G4",
  } as const;

  const expandedTeachingGroupByKey: Record<string, { id: string }> = {};

  for (const [cohortCode] of cohortDefinitions) {
    const cohortRecord = expandedCohortByCode[cohortCode];
    const cohortStudents = expandedStudentsByCohort[cohortCode];

    for (const subjectCode of subjectOrder) {
      const groupCode =
        cohortCode === "ST2A" && subjectCode in originalGroupCodeBySubject
          ? originalGroupCodeBySubject[
              subjectCode as keyof typeof originalGroupCodeBySubject
            ]
          : `${cohortCode}-${subjectCode}`;

      const group = await prisma.teachingGroup.upsert({
        where: {
          tenantId_code: {
            tenantId: tenant.id,
            code: groupCode,
          },
        },
        update: {
          academicPeriodId: academicPeriod.id,
          courseId: allCourseByCode[subjectCode].id,
          studentCohortId: cohortRecord.id,
          membershipMode: "FULL_COHORT",
          schedulingPriority:
            subjectDemand[subjectCode].priority === "CRITICAL"
              ? 250
              : subjectDemand[subjectCode].priority === "HIGH"
                ? 220
                : 180,
          name: `${cohortCode} ${subjectCode}`,
          status: "ACTIVE",
          maxStudents: 24,
        },
        create: {
          tenantId: tenant.id,
          academicPeriodId: academicPeriod.id,
          courseId: allCourseByCode[subjectCode].id,
          studentCohortId: cohortRecord.id,
          membershipMode: "FULL_COHORT",
          schedulingPriority:
            subjectDemand[subjectCode].priority === "CRITICAL"
              ? 250
              : subjectDemand[subjectCode].priority === "HIGH"
                ? 220
                : 180,
          name: `${cohortCode} ${subjectCode}`,
          code: groupCode,
          status: "ACTIVE",
          maxStudents: 24,
        },
      });

      expandedTeachingGroupByKey[`${cohortCode}:${subjectCode}`] = group;

      await prisma.teachingGroupStudent.deleteMany({
        where: {
          tenantId: tenant.id,
          teachingGroupId: group.id,
        },
      });

      await prisma.teachingGroupStudent.createMany({
        data: cohortStudents.map((student) => ({
          tenantId: tenant.id,
          teachingGroupId: group.id,
          studentId: student.id,
        })),
      });

      const demand = subjectDemand[subjectCode];

      await prisma.teachingRequirement.upsert({
        where: {
          tenantId_planId_teachingGroupId: {
            tenantId: tenant.id,
            planId: plan.id,
            teachingGroupId: group.id,
          },
        },
        update: {
          totalMinutes: demand.total,
          distributionMode: "EVEN_BY_TEACHING_CAPACITY",
          minWeeklyMinutes: demand.min,
          preferredWeeklyMinutes: demand.preferred,
          maxWeeklyMinutes: demand.max,
          carryoverAllowed: true,
          priority: demand.priority,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          planId: plan.id,
          teachingGroupId: group.id,
          academicPeriodId: academicPeriod.id,
          totalMinutes: demand.total,
          distributionMode: "EVEN_BY_TEACHING_CAPACITY",
          minWeeklyMinutes: demand.min,
          preferredWeeklyMinutes: demand.preferred,
          maxWeeklyMinutes: demand.max,
          carryoverAllowed: true,
          priority: demand.priority,
        },
      });
    }
  }

  // ----------------------------------------------------------------
  // Constraint-rich planning preferences
  // ----------------------------------------------------------------
  async function seedPlanningRule(input: {
    name: string;
    ruleType: "AVOID_TIME_WINDOW" | "MIN_BREAK_MINUTES";
    scopeType:
      | "TENANT"
      | "STUDENT_COHORT"
      | "TEACHING_GROUP"
      | "COURSE"
      | "STUDENT"
      | "INSTRUCTOR";
    audience: string;
    constraintType: "HARD" | "SOFT";
    weight: number;
    weekdays: number[];
    startMinute?: number;
    endMinute?: number;
    valueInt?: number;
    studentCohortId?: string;
    teachingGroupId?: string;
    courseId?: string;
    studentId?: string;
    instructorId?: string;
  }) {
    const existing = await prisma.planningRule.findFirst({
      where: {
        tenantId: tenant.id,
        name: input.name,
        ruleType: input.ruleType,
      },
    });

    const data = {
      ruleType: input.ruleType,
      scopeType: input.scopeType,
      audience: input.audience,
      constraintType: input.constraintType,
      weight: input.weight,
      weekdays: input.weekdays,
      startMinute: input.startMinute ?? null,
      endMinute: input.endMinute ?? null,
      valueInt: input.valueInt ?? null,
      valueUnit: "MINUTES" as const,
      studentCohortId: input.studentCohortId ?? null,
      teachingGroupId: input.teachingGroupId ?? null,
      courseId: input.courseId ?? null,
      studentId: input.studentId ?? null,
      instructorId: input.instructorId ?? null,
      active: true,
    };

    if (existing) {
      await prisma.planningRule.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.planningRule.create({
        data: {
          tenantId: tenant.id,
          name: input.name,
          ...data,
        },
      });
    }
  }

  // Maria prefers not to teach on Thursday mornings.
  await seedPlanningRule({
    name: "Maria prefers Thursday mornings free",
    ruleType: "AVOID_TIME_WINDOW",
    scopeType: "INSTRUCTOR",
    audience: "INSTRUCTORS",
    constraintType: "SOFT",
    weight: 100,
    weekdays: [4],
    startMinute: 8 * 60,
    endMinute: 12 * 60,
    instructorId: expandedInstructorByExternalId["T9"].id,
  });

  // History is preferably not placed in the last period on Friday.
  await seedPlanningRule({
    name: "History avoids late Friday",
    ruleType: "AVOID_TIME_WINDOW",
    scopeType: "COURSE",
    audience: "STUDENTS",
    constraintType: "SOFT",
    weight: 50,
    weekdays: [5],
    startMinute: 15 * 60 + 30,
    endMinute: 17 * 60,
    courseId: allCourseByCode.HIS.id,
  });

  // ST2B has a stronger soft break preference than the 15-minute global
  // hard baseline in STANDARD.
  await seedPlanningRule({
    name: "ST2B prefers 25 minute breaks",
    ruleType: "MIN_BREAK_MINUTES",
    scopeType: "STUDENT_COHORT",
    audience: "STUDENTS",
    constraintType: "SOFT",
    weight: 100,
    weekdays: [1, 2, 3, 4, 5],
    valueInt: 25,
    studentCohortId: expandedCohortByCode.ST2B.id,
  });

  // Elise prefers some breathing room between her own teaching sessions.
  await seedPlanningRule({
    name: "Elise prefers 20 minute teaching breaks",
    ruleType: "MIN_BREAK_MINUTES",
    scopeType: "INSTRUCTOR",
    audience: "INSTRUCTORS",
    constraintType: "SOFT",
    weight: 120,
    weekdays: [1, 2, 3, 4, 5],
    valueInt: 20,
    instructorId: expandedInstructorByExternalId["T11"].id,
  });

  // Materialise student-level subject demand too. This gives later solver and
  // reporting work enough data to test individual-vs-cohort requirement logic.
  await prisma.studentCourseRequirement.deleteMany({
    where: {
      tenantId: tenant.id,
      academicPeriodId: academicPeriod.id,
    },
  });

  const studentRequirementRows = Object.entries(
    expandedStudentsByCohort,
  ).flatMap(([, cohortStudents]) =>
    cohortStudents.flatMap((student) =>
      subjectOrder.map((subjectCode) => ({
        tenantId: tenant.id,
        studentId: student.id,
        courseId: allCourseByCode[subjectCode].id,
        academicPeriodId: academicPeriod.id,
        requiredAmount: subjectDemand[subjectCode].total,
        unit: "MINUTES" as const,
        priority: subjectDemand[subjectCode].priority,
        active: true,
      })),
    ),
  );

  await prisma.studentCourseRequirement.createMany({
    data: studentRequirementRows,
  });

  // Room suitability creates meaningful trade-offs: sciences prefer labs, IT
  // prefers C20/C21, and larger general rooms remain usable fallbacks.
  const expandedRoomCoursePreferences = [
    ["LAB1", "FYS", "PREFERRED", 0],
    ["LAB2", "FYS", "PREFERRED", 0],
    ["C20", "IT", "PREFERRED", 0],
    ["C21", "IT", "PREFERRED", 0],
    ["D30", "MAT", "PREFERRED", 0],
    ["A10", "NOR", "PREFERRED", 0],
    ["A11", "ENG", "PREFERRED", 0],
    ["B14", "SAM", "PREFERRED", 0],
    ["B14", "HIS", "PREFERRED", 0],
    ["C20", "GEO", "PREFERRED", 0],
  ] as const;

  for (const [
    roomCode,
    courseCode,
    suitability,
    penalty,
  ] of expandedRoomCoursePreferences) {
    await prisma.roomCoursePreference.upsert({
      where: {
        tenantId_roomId_courseId: {
          tenantId: tenant.id,
          roomId: expandedRoomByCode[roomCode].id,
          courseId: allCourseByCode[courseCode].id,
        },
      },
      update: {
        suitability,
        penalty,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        roomId: expandedRoomByCode[roomCode].id,
        courseId: allCourseByCode[courseCode].id,
        suitability,
        penalty,
      },
    });
  }

  // Autumn break: a complete no-teaching week. This is deliberately encoded in
  // CalendarDay so Base Plan weekly allocation has to redistribute demand over
  // the remaining teaching weeks.
  for (
    let date = new Date("2026-10-05T00:00:00.000Z");
    date <= new Date("2026-10-09T00:00:00.000Z");
    date = addUtcDays(date, 1)
  ) {
    await prisma.calendarDay.update({
      where: {
        tenantId_date: {
          tenantId: tenant.id,
          date,
        },
      },
      data: {
        dayType: "HOLIDAY",
        name: "Autumn break",
        teachingAllowed: false,
      },
    });
  }

  // A planning day creates a second, smaller disruption in another week.
  await prisma.calendarDay.update({
    where: {
      tenantId_date: {
        tenantId: tenant.id,
        date: new Date("2026-11-13T00:00:00.000Z"),
      },
    },
    data: {
      dayType: "PLANNING_DAY",
      name: "Staff planning day",
      teachingAllowed: false,
    },
  });

  // Different cohort activity days ensure not every class has identical weekly
  // capacity.
  const expandedActivityDays = [
    ["ST2B", "2026-09-24", "ST2B activity day"],
    ["ST3A", "2026-10-22", "ST3A activity day"],
    ["ST3B", "2026-11-05", "ST3B activity day"],
  ] as const;

  for (const [cohortCode, dateIso, name] of expandedActivityDays) {
    const existing = await prisma.planningException.findFirst({
      where: {
        tenantId: tenant.id,
        studentCohortId: expandedCohortByCode[cohortCode].id,
        type: "ACTIVITY_DAY",
        name,
      },
    });

    const data = {
      status: "ACTIVE" as const,
      impactMode: "BLOCK" as const,
      startAt: new Date(`${dateIso}T06:00:00.000Z`),
      endAt: new Date(`${dateIso}T14:00:00.000Z`),
      description: `Seeded activity day for ${cohortCode}.`,
    };

    if (existing) {
      await prisma.planningException.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.planningException.create({
        data: {
          tenantId: tenant.id,
          studentCohortId: expandedCohortByCode[cohortCode].id,
          type: "ACTIVITY_DAY",
          name,
          ...data,
        },
      });
    }
  }

  // A few additional availability constraints provide realistic recovery and
  // feasibility test cases without making the whole semester deliberately
  // infeasible.
  await prisma.instructorAvailability.deleteMany({
    where: {
      tenantId: tenant.id,
      reasonCode: "EXPANDED_SEED_BLOCK",
    },
  });

  await prisma.instructorAvailability.createMany({
    data: [
      {
        tenantId: tenant.id,
        instructorId: expandedInstructorByExternalId["T5"].id,
        date: new Date("2026-09-29T00:00:00.000Z"),
        startMinute: 8 * 60,
        endMinute: 12 * 60,
        status: "UNAVAILABLE",
        reasonCode: "EXPANDED_SEED_BLOCK",
      },
      {
        tenantId: tenant.id,
        instructorId: expandedInstructorByExternalId["T9"].id,
        date: new Date("2026-10-20T00:00:00.000Z"),
        startMinute: 12 * 60,
        endMinute: 17 * 60,
        status: "UNAVAILABLE",
        reasonCode: "EXPANDED_SEED_BLOCK",
      },
      {
        tenantId: tenant.id,
        instructorId: expandedInstructorByExternalId["T11"].id,
        date: new Date("2026-11-18T00:00:00.000Z"),
        startMinute: 8 * 60,
        endMinute: 17 * 60,
        status: "UNAVAILABLE",
        reasonCode: "EXPANDED_SEED_BLOCK",
      },
    ],
  });

  await prisma.roomAvailability.deleteMany({
    where: {
      tenantId: tenant.id,
      reasonCode: "EXPANDED_SEED_BLOCK",
    },
  });

  await prisma.roomAvailability.createMany({
    data: [
      {
        tenantId: tenant.id,
        roomId: expandedRoomByCode["LAB1"].id,
        date: new Date("2026-09-30T00:00:00.000Z"),
        startMinute: 0,
        endMinute: 24 * 60,
        status: "UNAVAILABLE",
        reasonCode: "EXPANDED_SEED_BLOCK",
      },
      {
        tenantId: tenant.id,
        roomId: expandedRoomByCode["C20"].id,
        date: new Date("2026-10-27T00:00:00.000Z"),
        startMinute: 8 * 60,
        endMinute: 12 * 60,
        status: "UNAVAILABLE",
        reasonCode: "EXPANDED_SEED_BLOCK",
      },
    ],
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
      maxSessionsPerDay: 5,
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
      maxSessionsPerDay: 5,
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
    {
      stage: 1,
      position: 1,
      name: "Academic review",
      reviewerRole: "ACADEMIC_OWNER",
    },
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
