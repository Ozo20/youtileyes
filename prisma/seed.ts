import { prisma } from "../src/lib/prisma";

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

  const studentByExternalId = Object.fromEntries(
    students.map((student) => [student.externalId!, student]),
  );

  const groupDefinitions = [
    ["G1", "MAT", ["S1", "S2"]],
    ["G2", "ENG", ["S1", "S3"]],
    ["G3", "FYS", ["S1", "S4"]],
    ["G4", "NOR", ["S1", "S5"]],
  ] as const;

  const teachingGroupByCode: Record<string, { id: string }> = {};

  for (const [code, courseCode, studentIds] of groupDefinitions) {
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
        name: code,
        status: "ACTIVE",
        maxStudents: 10,
      },
      create: {
        tenantId: tenant.id,
        academicPeriodId: academicPeriod.id,
        courseId: courseByCode[courseCode].id,
        name: code,
        code,
        status: "ACTIVE",
        maxStudents: 10,
      },
    });

    teachingGroupByCode[code] = group;

    for (const studentExternalId of studentIds) {
      await prisma.teachingGroupStudent.upsert({
        where: {
          tenantId_teachingGroupId_studentId: {
            tenantId: tenant.id,
            teachingGroupId: group.id,
            studentId: studentByExternalId[studentExternalId].id,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          teachingGroupId: group.id,
          studentId: studentByExternalId[studentExternalId].id,
        },
      });
    }
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
    update: {},
    create: {
      tenantId: tenant.id,
      planningScopeId: planningScope.id,
      academicPeriodId: academicPeriod.id,
      name: "Demo plan",
      version: 1,
      status: "DRAFT",
    },
  });

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
