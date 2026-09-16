import { performance } from "node:perf_hooks";

import { prisma } from "../src/lib/prisma";
import {
  distributeMinutes,
  rebalanceCohortWeeklyCapacity,
  type CohortCapacityItem,
} from "../src/lib/planning/base-plan";

type ScaleProfileName = "S" | "M" | "L" | "XL";

type ScaleProfile = {
  students: number;
  instructors: number;
  rooms: number;
  courses: number;
  campuses: number;
  cohortSize: number;
  coursesPerCohort: number;
  instructorUnavailableEvents: number;
  roomUnavailableEvents: number;
  cohortActivityEvents: number;
  generatorSeed: number;
};

const DATASET_VERSION = "1.0";
const COMPLEXITY_PROFILE = "STANDARD";

const PROFILES: Record<ScaleProfileName, ScaleProfile> = {
  S: {
    students: 150,
    instructors: 30,
    rooms: 15,
    courses: 15,
    campuses: 1,
    cohortSize: 25,
    coursesPerCohort: 8,
    instructorUnavailableEvents: 8,
    roomUnavailableEvents: 3,
    cohortActivityEvents: 2,
    generatorSeed: 11001,
  },
  M: {
    students: 500,
    instructors: 100,
    rooms: 40,
    courses: 30,
    campuses: 2,
    cohortSize: 25,
    coursesPerCohort: 10,
    instructorUnavailableEvents: 30,
    roomUnavailableEvents: 10,
    cohortActivityEvents: 6,
    generatorSeed: 22001,
  },
  L: {
    students: 1000,
    instructors: 200,
    rooms: 80,
    courses: 50,
    campuses: 3,
    cohortSize: 25,
    coursesPerCohort: 12,
    instructorUnavailableEvents: 70,
    roomUnavailableEvents: 20,
    cohortActivityEvents: 12,
    generatorSeed: 33001,
  },
  XL: {
    students: 2500,
    instructors: 400,
    rooms: 150,
    courses: 80,
    campuses: 5,
    cohortSize: 25,
    coursesPerCohort: 14,
    instructorUnavailableEvents: 160,
    roomUnavailableEvents: 45,
    cohortActivityEvents: 25,
    generatorSeed: 44001,
  },
};

const COURSE_NAMES = [
  "Mathematics",
  "Physics",
  "English",
  "Norwegian",
  "Chemistry",
  "Biology",
  "History",
  "Geography",
  "Information Technology",
  "Social Studies",
  "Economics",
  "Statistics",
  "Programming",
  "Engineering Science",
  "Environmental Science",
  "Communication",
  "Project Management",
  "Design",
  "Data Analysis",
  "Applied Mathematics",
] as const;

const FIRST_NAMES = [
  "Kari",
  "Per",
  "Anna",
  "Morten",
  "Ingrid",
  "Thomas",
  "Silje",
  "Henrik",
  "Maria",
  "Anders",
  "Elise",
  "Jonas",
  "Nora",
  "Emil",
  "Sara",
  "Magnus",
  "Ida",
  "Kristian",
  "Sofie",
  "Martin",
] as const;

const LAST_NAMES = [
  "Hansen",
  "Olsen",
  "Berg",
  "Dahl",
  "Nilsen",
  "Moen",
  "Aune",
  "Larsen",
  "Solberg",
  "Vik",
  "Haugen",
  "Lie",
  "Johansen",
  "Lunde",
  "Strand",
  "Bakke",
  "Eide",
  "Holm",
  "Sæther",
  "Myhre",
] as const;

function requiredScaleProfile(): ScaleProfileName {
  const raw = (
    process.argv[2] ??
    process.env.PLANNER_SCALE ??
    ""
  ).toUpperCase();
  if (raw === "S" || raw === "M" || raw === "L" || raw === "XL") {
    return raw;
  }
  throw new Error(
    "Scale profile must be one of S, M, L or XL. Example: npm run db:seed:scale -- L",
  );
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function dateOnlyIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function startOfUtcMonday(date: Date): Date {
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = result.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  result.setUTCDate(result.getUTCDate() + offset);
  return result;
}

async function createManyInBatches<T>(
  rows: T[],
  write: (batch: T[]) => Promise<unknown>,
  batchSize = 1000,
): Promise<void> {
  for (let index = 0; index < rows.length; index += batchSize) {
    await write(rows.slice(index, index + batchSize));
  }
}

async function main() {
  if (process.env.ALLOW_SCALE_SEED !== "true") {
    throw new Error(
      "Refusing to seed scale data. Set ALLOW_SCALE_SEED=true explicitly.",
    );
  }

  const profileName = requiredScaleProfile();
  const profile = PROFILES[profileName];
  const rng = mulberry32(profile.generatorSeed);
  const startedAt = performance.now();

  const stagingSentinel = await prisma.tenant.findUnique({
    where: { code: "VERIZEL-PLANNER-STAGING" },
    select: { id: true },
  });

  if (!stagingSentinel) {
    throw new Error(
      'Refusing to seed scale data because the staging sentinel tenant "VERIZEL-PLANNER-STAGING" was not found in this database.',
    );
  }

  const tenantCode = `VERIZEL-PLANNER-STAGING-${profileName}`;
  const tenant = await prisma.tenant.upsert({
    where: { code: tenantCode },
    update: {
      name: `Verizel Planner Staging ${profileName} - dataset ${DATASET_VERSION}`,
      status: "ACTIVE",
      timezone: "Europe/Oslo",
    },
    create: {
      code: tenantCode,
      name: `Verizel Planner Staging ${profileName} - dataset ${DATASET_VERSION}`,
      status: "ACTIVE",
      timezone: "Europe/Oslo",
    },
  });

  const adminEmail =
    process.env.SCALE_SEED_ADMIN_EMAIL ??
    process.env.APP_USER_EMAIL ??
    "olasolem@gmail.com";
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { active: true },
    create: {
      email: adminEmail,
      name: "Scale Demo Admin",
      active: true,
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: adminUser.id,
      },
    },
    update: { role: "ADMIN", active: true },
    create: {
      tenantId: tenant.id,
      userId: adminUser.id,
      role: "ADMIN",
      active: true,
    },
  });

  const academicPeriod = await prisma.academicPeriod.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "2026-AUTUMN-SCALE",
      },
    },
    update: {
      name: "Autumn 2026 Scale Benchmark",
      startDate: new Date("2026-08-17T00:00:00.000Z"),
      endDate: new Date("2026-12-18T00:00:00.000Z"),
      active: true,
    },
    create: {
      tenantId: tenant.id,
      type: "SEMESTER",
      name: "Autumn 2026 Scale Benchmark",
      code: "2026-AUTUMN-SCALE",
      startDate: new Date("2026-08-17T00:00:00.000Z"),
      endDate: new Date("2026-12-18T00:00:00.000Z"),
    },
  });

  const faculty = await prisma.organisationUnit.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "SCALE-FACULTY",
      },
    },
    update: {
      name: `Scale Benchmark Faculty ${profileName}`,
      active: true,
    },
    create: {
      tenantId: tenant.id,
      type: "FACULTY",
      name: `Scale Benchmark Faculty ${profileName}`,
      code: "SCALE-FACULTY",
    },
  });

  const campuses = [];
  for (let index = 0; index < profile.campuses; index += 1) {
    const code = `SC${String(index + 1).padStart(2, "0")}`;
    const campus = await prisma.location.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: {
        type: "CAMPUS",
        name: `Scale Campus ${index + 1}`,
        city: index === 0 ? "Trondheim" : `Scale City ${index + 1}`,
        countryCode: "NO",
        timezone: "Europe/Oslo",
        active: true,
      },
      create: {
        tenantId: tenant.id,
        type: "CAMPUS",
        name: `Scale Campus ${index + 1}`,
        code,
        city: index === 0 ? "Trondheim" : `Scale City ${index + 1}`,
        countryCode: "NO",
        timezone: "Europe/Oslo",
      },
    });
    campuses.push(campus);

    await prisma.organisationUnitLocation.upsert({
      where: {
        tenantId_organisationUnitId_locationId: {
          tenantId: tenant.id,
          organisationUnitId: faculty.id,
          locationId: campus.id,
        },
      },
      update: { priority: 100 + index },
      create: {
        tenantId: tenant.id,
        organisationUnitId: faculty.id,
        locationId: campus.id,
        priority: 100 + index,
      },
    });
  }

  for (const fromCampus of campuses) {
    for (const toCampus of campuses) {
      if (fromCampus.id === toCampus.id) continue;
      const distanceFactor =
        Math.abs(
          campuses.findIndex((campus) => campus.id === fromCampus.id) -
            campuses.findIndex((campus) => campus.id === toCampus.id),
        ) + 1;
      await prisma.locationRelation.upsert({
        where: {
          tenantId_fromLocationId_toLocationId_relationType: {
            tenantId: tenant.id,
            fromLocationId: fromCampus.id,
            toLocationId: toCampus.id,
            relationType: "TRAVEL",
          },
        },
        update: {
          minimumMinutes: 10 + distanceFactor * 10,
          allowSameDay: true,
          allowBetweenSessions: true,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          fromLocationId: fromCampus.id,
          toLocationId: toCampus.id,
          relationType: "TRAVEL",
          minimumMinutes: 10 + distanceFactor * 10,
          allowSameDay: true,
          allowBetweenSessions: true,
        },
      });
    }
  }

  const planningScope = await prisma.planningScope.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: `SCALE-${profileName}`,
      },
    },
    update: {
      academicPeriodId: academicPeriod.id,
      name: `Scale ${profileName} planning scope - dataset ${DATASET_VERSION}`,
      status: "ACTIVE",
    },
    create: {
      tenantId: tenant.id,
      academicPeriodId: academicPeriod.id,
      name: `Scale ${profileName} planning scope - dataset ${DATASET_VERSION}`,
      code: `SCALE-${profileName}`,
      status: "ACTIVE",
    },
  });

  await prisma.planningScopeOrganisationUnit.upsert({
    where: {
      tenantId_planningScopeId_organisationUnitId: {
        tenantId: tenant.id,
        planningScopeId: planningScope.id,
        organisationUnitId: faculty.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      planningScopeId: planningScope.id,
      organisationUnitId: faculty.id,
    },
  });

  for (const campus of campuses) {
    await prisma.planningScopeLocation.upsert({
      where: {
        tenantId_planningScopeId_locationId: {
          tenantId: tenant.id,
          planningScopeId: planningScope.id,
          locationId: campus.id,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        planningScopeId: planningScope.id,
        locationId: campus.id,
      },
    });
  }

  const plan = await prisma.plan.upsert({
    where: {
      tenantId_planningScopeId_version: {
        tenantId: tenant.id,
        planningScopeId: planningScope.id,
        version: 1,
      },
    },
    update: {
      name: `Scale ${profileName} benchmark plan - dataset ${DATASET_VERSION}`,
      planningAsOfDate: new Date("2026-08-01T00:00:00.000Z"),
      frozenThroughDate: new Date("2026-08-16T00:00:00.000Z"),
      planningStartDate: new Date("2026-08-17T00:00:00.000Z"),
      planningEndDate: new Date("2026-12-18T00:00:00.000Z"),
      effectiveFrom: new Date("2026-08-17T00:00:00.000Z"),
      effectiveTo: new Date("2026-12-18T00:00:00.000Z"),
    },
    create: {
      tenantId: tenant.id,
      planningScopeId: planningScope.id,
      academicPeriodId: academicPeriod.id,
      name: `Scale ${profileName} benchmark plan - dataset ${DATASET_VERSION}`,
      version: 1,
      status: "DRAFT",
      planningAsOfDate: new Date("2026-08-01T00:00:00.000Z"),
      frozenThroughDate: new Date("2026-08-16T00:00:00.000Z"),
      planningStartDate: new Date("2026-08-17T00:00:00.000Z"),
      planningEndDate: new Date("2026-12-18T00:00:00.000Z"),
      effectiveFrom: new Date("2026-08-17T00:00:00.000Z"),
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
    {
      stage: 1,
      position: 1,
      name: "Academic review",
      reviewerRole: "ACADEMIC_OWNER",
    },
    {
      stage: 2,
      position: 1,
      name: "Final approval",
      reviewerRole: "RECTOR",
    },
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

  for (
    let date = new Date("2026-08-17T00:00:00.000Z");
    date <= new Date("2026-12-18T00:00:00.000Z");
    date = addUtcDays(date, 1)
  ) {
    const weekday = date.getUTCDay();
    const autumnBreak =
      date >= new Date("2026-10-05T00:00:00.000Z") &&
      date <= new Date("2026-10-09T00:00:00.000Z");
    const teachingAllowed = weekday >= 1 && weekday <= 5 && !autumnBreak;

    await prisma.calendarDay.upsert({
      where: {
        tenantId_date: {
          tenantId: tenant.id,
          date,
        },
      },
      update: {
        academicPeriodId: academicPeriod.id,
        dayType: autumnBreak
          ? "HOLIDAY"
          : teachingAllowed
            ? "TEACHING"
            : "CLOSED",
        name: autumnBreak ? "Autumn break" : null,
        teachingAllowed,
      },
      create: {
        tenantId: tenant.id,
        academicPeriodId: academicPeriod.id,
        date,
        dayType: autumnBreak
          ? "HOLIDAY"
          : teachingAllowed
            ? "TEACHING"
            : "CLOSED",
        name: autumnBreak ? "Autumn break" : null,
        teachingAllowed,
      },
    });
  }

  const timeBlocks = [
    ["P1", 8 * 60 + 15, 9 * 60],
    ["P2", 9 * 60 + 15, 10 * 60],
    ["P3", 10 * 60 + 15, 11 * 60],
    ["P4", 11 * 60 + 15, 12 * 60],
    ["P5", 12 * 60 + 45, 13 * 60 + 30],
    ["P6", 13 * 60 + 45, 14 * 60 + 30],
    ["P7", 14 * 60 + 45, 15 * 60 + 30],
    ["P8", 15 * 60 + 45, 16 * 60 + 30],
  ] as const;

  await prisma.timeBlock.deleteMany({
    where: {
      tenantId: tenant.id,
      name: { in: timeBlocks.map(([name]) => name) },
    },
  });
  await prisma.timeBlock.createMany({
    data: timeBlocks.map(([name, startMinute, endMinute]) => ({
      tenantId: tenant.id,
      name,
      startMinute,
      endMinute,
      active: true,
    })),
  });

  const roomFeatureCodes = [
    ["PROJECTOR", "Projector"],
    ["COMPUTER", "Computer workstation"],
    ["LAB_STATION", "Laboratory station"],
    ["STEP_FREE", "Step-free access"],
  ] as const;

  const roomFeatureByCode: Record<string, { id: string }> = {};
  for (const [code, name] of roomFeatureCodes) {
    roomFeatureByCode[code] = await prisma.roomFeature.upsert({
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
  }

  const rooms: Array<{ id: string; code: string | null; capacity: number }> =
    [];
  for (let index = 0; index < profile.rooms; index += 1) {
    const campusIndex = index % campuses.length;
    const code = `${campuses[campusIndex].code}-R${String(index + 1).padStart(3, "0")}`;
    const roomCapacity = Math.max(profile.cohortSize + 5, 30 + (index % 5) * 5);
    const room = await prisma.room.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: {
        locationId: campuses[campusIndex].id,
        name: `Room ${String(index + 1).padStart(3, "0")}`,
        capacity: roomCapacity,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        locationId: campuses[campusIndex].id,
        code,
        name: `Room ${String(index + 1).padStart(3, "0")}`,
        capacity: roomCapacity,
      },
    });
    rooms.push(room);

    const featureRows = [
      {
        tenantId: tenant.id,
        roomId: room.id,
        featureId: roomFeatureByCode.PROJECTOR.id,
        quantity: 1,
      },
      ...(index % 10 === 0
        ? [
            {
              tenantId: tenant.id,
              roomId: room.id,
              featureId: roomFeatureByCode.COMPUTER.id,
              quantity: room.capacity,
            },
          ]
        : []),
      ...(index % 10 === 1
        ? [
            {
              tenantId: tenant.id,
              roomId: room.id,
              featureId: roomFeatureByCode.LAB_STATION.id,
              quantity: room.capacity,
            },
          ]
        : []),
      ...(index % 4 === 0
        ? [
            {
              tenantId: tenant.id,
              roomId: room.id,
              featureId: roomFeatureByCode.STEP_FREE.id,
              quantity: 1,
            },
          ]
        : []),
    ];

    for (const featureRow of featureRows) {
      await prisma.roomFeatureValue.upsert({
        where: {
          tenantId_roomId_featureId: {
            tenantId: featureRow.tenantId,
            roomId: featureRow.roomId,
            featureId: featureRow.featureId,
          },
        },
        update: { quantity: featureRow.quantity },
        create: featureRow,
      });
    }
  }

  const courses = [];
  for (let index = 0; index < profile.courses; index += 1) {
    const code = `C${String(index + 1).padStart(3, "0")}`;
    const baseName =
      COURSE_NAMES[index] ?? `Elective ${String(index + 1).padStart(2, "0")}`;
    const preferredSessionMinutes = index % 7 === 0 ? 90 : 45;
    const course = await prisma.course.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: {
        name: baseName,
        standardGroupSize: profile.cohortSize,
        maxGroupSize: profile.cohortSize + 5,
        minSessionMinutes: 45,
        preferredSessionMinutes,
        maxSessionMinutes: preferredSessionMinutes,
        allowDoubleSession: preferredSessionMinutes === 90,
        maxSessionsPerDay: 2,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        code,
        name: baseName,
        standardGroupSize: profile.cohortSize,
        maxGroupSize: profile.cohortSize + 5,
        minSessionMinutes: 45,
        preferredSessionMinutes,
        maxSessionMinutes: preferredSessionMinutes,
        allowDoubleSession: preferredSessionMinutes === 90,
        maxSessionsPerDay: 2,
      },
    });
    courses.push(course);
  }

  await prisma.roomRequirement.deleteMany({
    where: { tenantId: tenant.id },
  });

  for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
    const course = courses[courseIndex];

    if (courseIndex % 10 === 0) {
      await prisma.roomRequirement.create({
        data: {
          tenantId: tenant.id,
          featureId: roomFeatureByCode.COMPUTER.id,
          courseId: course.id,
          quantity: 1,
          perStudent: true,
          hard: true,
          weight: 1000,
        },
      });
    } else if (courseIndex % 10 === 1) {
      await prisma.roomRequirement.create({
        data: {
          tenantId: tenant.id,
          featureId: roomFeatureByCode.LAB_STATION.id,
          courseId: course.id,
          quantity: 1,
          perStudent: true,
          hard: false,
          weight: 180,
        },
      });
    }

    const preferredRoom = rooms[courseIndex % rooms.length];
    await prisma.roomCoursePreference.upsert({
      where: {
        tenantId_roomId_courseId: {
          tenantId: tenant.id,
          roomId: preferredRoom.id,
          courseId: course.id,
        },
      },
      update: {
        suitability: "PREFERRED",
        penalty: 0,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        roomId: preferredRoom.id,
        courseId: course.id,
        suitability: "PREFERRED",
        penalty: 0,
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
      maxTeachingMinutesPerDay: 300,
      maxContinuousTeachingMinutes: 135,
      minBreakMinutes: 15,
      minLunchMinutes: 30,
      maxSessionsPerDay: 6,
      minRealBreakMinutes: 15,
      travelConsumesBreakTime: true,
      active: true,
    },
    create: {
      tenantId: tenant.id,
      name: "Scale benchmark standard profile",
      code: "STANDARD",
      maxTeachingMinutesPerDay: 300,
      maxContinuousTeachingMinutes: 135,
      minBreakMinutes: 15,
      minLunchMinutes: 30,
      maxSessionsPerDay: 6,
      minRealBreakMinutes: 15,
      travelConsumesBreakTime: true,
    },
  });

  const instructors: Array<{ id: string }> = [];
  for (let index = 0; index < profile.instructors; index += 1) {
    const externalId = `I-${profileName}-${String(index + 1).padStart(4, "0")}`;
    const isFlexible = index >= Math.floor(profile.instructors * 0.85);
    const employmentPercentage = isFlexible
      ? [40, 50, 60][index % 3]
      : [80, 90, 100][index % 3];
    const maxTeachingMinutesPerWeek = Math.round(
      1200 * (employmentPercentage / 100),
    );
    const primaryLocation = campuses[index % campuses.length];

    const instructor = await prisma.instructor.upsert({
      where: {
        tenantId_externalId_sourceSystem: {
          tenantId: tenant.id,
          externalId,
          sourceSystem: "SCALE_SEED",
        },
      },
      update: {
        firstName: FIRST_NAMES[index % FIRST_NAMES.length],
        lastName:
          LAST_NAMES[
            Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length
          ],
        status: "ACTIVE",
        employmentPercentage,
        maxTeachingMinutesPerWeek,
        primaryOrganisationUnitId: faculty.id,
        primaryLocationId: primaryLocation.id,
        loadProfileId: loadProfile.id,
      },
      create: {
        tenantId: tenant.id,
        externalId,
        sourceSystem: "SCALE_SEED",
        firstName: FIRST_NAMES[index % FIRST_NAMES.length],
        lastName:
          LAST_NAMES[
            Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length
          ],
        employmentPercentage,
        maxTeachingMinutesPerWeek,
        primaryOrganisationUnitId: faculty.id,
        primaryLocationId: primaryLocation.id,
        loadProfileId: loadProfile.id,
      },
    });
    instructors.push(instructor);

    await prisma.instructorLocation.upsert({
      where: {
        tenantId_instructorId_locationId: {
          tenantId: tenant.id,
          instructorId: instructor.id,
          locationId: primaryLocation.id,
        },
      },
      update: { allowed: true, priority: 120 },
      create: {
        tenantId: tenant.id,
        instructorId: instructor.id,
        locationId: primaryLocation.id,
        allowed: true,
        priority: 120,
      },
    });
  }

  const qualifiedPerCourse = Math.max(
    3,
    Math.ceil((profile.instructors * 3.5) / profile.courses),
  );

  for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
    const usedInstructorIds = new Set<string>();
    for (let slot = 0; slot < qualifiedPerCourse; slot += 1) {
      const instructorIndex =
        (courseIndex * 11 + slot * 17) % instructors.length;
      const instructor = instructors[instructorIndex];
      if (usedInstructorIds.has(instructor.id)) continue;
      usedInstructorIds.add(instructor.id);

      const qualificationLevel =
        slot < Math.ceil(qualifiedPerCourse * 0.5) ? "PRIMARY" : "SECONDARY";
      const competenceLevel =
        qualificationLevel === "PRIMARY" ? 85 + (slot % 11) : 65 + (slot % 16);

      await prisma.instructorCourse.upsert({
        where: {
          tenantId_instructorId_courseId: {
            tenantId: tenant.id,
            instructorId: instructor.id,
            courseId: courses[courseIndex].id,
          },
        },
        update: {
          competenceLevel,
          qualificationLevel,
          priority: 100 + slot,
          preference: slot === 0 ? "PREFER" : "NEUTRAL",
          preferenceWeight: slot === 0 ? 140 : 100,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          instructorId: instructor.id,
          courseId: courses[courseIndex].id,
          competenceLevel,
          qualificationLevel,
          priority: 100 + slot,
          preference: slot === 0 ? "PREFER" : "NEUTRAL",
          preferenceWeight: slot === 0 ? 140 : 100,
        },
      });
    }

    if (courseIndex % 10 === 0) {
      let supportInstructorIndex = (courseIndex * 13 + 5) % instructors.length;
      for (
        let attempt = 0;
        attempt < instructors.length &&
        usedInstructorIds.has(instructors[supportInstructorIndex].id);
        attempt += 1
      ) {
        supportInstructorIndex =
          (supportInstructorIndex + 1) % instructors.length;
      }
      const supportInstructor = instructors[supportInstructorIndex];
      await prisma.instructorCourse.upsert({
        where: {
          tenantId_instructorId_courseId: {
            tenantId: tenant.id,
            instructorId: supportInstructor.id,
            courseId: courses[courseIndex].id,
          },
        },
        update: {
          competenceLevel: 55,
          qualificationLevel: "SUPPORT",
          priority: 140,
          preference: "NEUTRAL",
          preferenceWeight: 100,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          instructorId: supportInstructor.id,
          courseId: courses[courseIndex].id,
          competenceLevel: 55,
          qualificationLevel: "SUPPORT",
          priority: 140,
          preference: "NEUTRAL",
          preferenceWeight: 100,
        },
      });
    }
  }

  await prisma.staffingRequirement.deleteMany({
    where: {
      tenantId: tenant.id,
      source: "COURSE",
    },
  });

  for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
    if (courseIndex % 5 === 0) {
      await prisma.staffingRequirement.create({
        data: {
          tenantId: tenant.id,
          source: "COURSE",
          courseId: courses[courseIndex].id,
          role: "LEAD",
          count: 1,
          minimumCourseQualificationLevel: "PRIMARY",
          minimumCourseLevel: 70,
          preferredCourseLevel: 90,
          priority: 200,
          hard: true,
        },
      });
    }

    if (courseIndex % 10 === 0) {
      await prisma.staffingRequirement.create({
        data: {
          tenantId: tenant.id,
          source: "COURSE",
          courseId: courses[courseIndex].id,
          role: "ASSISTANT",
          count: 1,
          minimumCourseQualificationLevel: "SUPPORT",
          minimumCourseLevel: 40,
          preferredCourseLevel: 70,
          priority: 180,
          hard: true,
        },
      });
    }
  }

  const cohortCount = Math.ceil(profile.students / profile.cohortSize);
  const cohorts: Array<{
    id: string;
    code: string;
  }> = [];
  for (let index = 0; index < cohortCount; index += 1) {
    const code = `CL${String(index + 1).padStart(3, "0")}`;
    const cohort = await prisma.studentCohort.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: {
        academicPeriodId: academicPeriod.id,
        organisationUnitId: faculty.id,
        type: "CLASS",
        name: `Class ${String(index + 1).padStart(3, "0")}`,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        academicPeriodId: academicPeriod.id,
        organisationUnitId: faculty.id,
        type: "CLASS",
        name: `Class ${String(index + 1).padStart(3, "0")}`,
        code,
      },
    });
    cohorts.push({
      id: cohort.id,
      code: cohort.code ?? code,
    });
  }

  const students = [];
  const studentsByCohort: Array<Array<{ id: string }>> = Array.from(
    { length: cohortCount },
    () => [],
  );

  for (let index = 0; index < profile.students; index += 1) {
    const cohortIndex = Math.floor(index / profile.cohortSize);
    const externalId = `S-${profileName}-${String(index + 1).padStart(5, "0")}`;
    const campus = campuses[cohortIndex % campuses.length];

    const studentNameCycle = Math.floor(
      index / (FIRST_NAMES.length * LAST_NAMES.length),
    );
    const studentLastName =
      LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length];
    const displayLastName =
      studentNameCycle === 0
        ? studentLastName
        : `${studentLastName} ${studentNameCycle + 1}`;

    const student = await prisma.student.upsert({
      where: {
        tenantId_externalId_sourceSystem: {
          tenantId: tenant.id,
          externalId,
          sourceSystem: "SCALE_SEED",
        },
      },
      update: {
        firstName: FIRST_NAMES[index % FIRST_NAMES.length],
        lastName: displayLastName,
        status: "ACTIVE",
        primaryOrganisationUnitId: faculty.id,
        primaryLocationId: campus.id,
        loadProfileId: loadProfile.id,
      },
      create: {
        tenantId: tenant.id,
        externalId,
        sourceSystem: "SCALE_SEED",
        firstName: FIRST_NAMES[index % FIRST_NAMES.length],
        lastName: displayLastName,
        primaryOrganisationUnitId: faculty.id,
        primaryLocationId: campus.id,
        loadProfileId: loadProfile.id,
      },
    });
    students.push(student);
    studentsByCohort[cohortIndex].push(student);

    await prisma.studentCohortMember.upsert({
      where: {
        tenantId_studentCohortId_studentId: {
          tenantId: tenant.id,
          studentCohortId: cohorts[cohortIndex].id,
          studentId: student.id,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        studentCohortId: cohorts[cohortIndex].id,
        studentId: student.id,
      },
    });
  }

  const weekStarts: Date[] = [];
  for (
    let week = startOfUtcMonday(new Date("2026-08-17T00:00:00.000Z"));
    week <= new Date("2026-12-14T00:00:00.000Z");
    week = addUtcDays(week, 7)
  ) {
    weekStarts.push(week);
  }

  const weeklyTeachingDays = new Map<string, number>();
  for (const weekStart of weekStarts) {
    let availableDays = 0;
    for (let offset = 0; offset < 5; offset += 1) {
      const date = addUtcDays(weekStart, offset);
      const autumnBreak =
        date >= new Date("2026-10-05T00:00:00.000Z") &&
        date <= new Date("2026-10-09T00:00:00.000Z");
      if (!autumnBreak) availableDays += 1;
    }
    weeklyTeachingDays.set(dateOnlyIso(weekStart), availableDays);
  }

  // Materialise deterministic cohort activity days before Base Plan
  // allocations so weekly capacity and solver input describe the same world.
  await prisma.planningException.deleteMany({
    where: {
      tenantId: tenant.id,
      name: { startsWith: "Scale activity day" },
    },
  });

  const scaleActivityEvents = Array.from(
    { length: profile.cohortActivityEvents },
    (_, index) => {
      const cohort = cohorts[index % cohorts.length];
      const date = addUtcDays(
        new Date("2026-08-17T00:00:00.000Z"),
        14 + ((index * 11) % 90),
      );

      return {
        index,
        cohort,
        dateKey: dateOnlyIso(date),
      };
    },
  );

  const activityDatesByCohortId = new Map<string, Set<string>>();

  for (const event of scaleActivityEvents) {
    const activityDates =
      activityDatesByCohortId.get(event.cohort.id) ?? new Set<string>();

    activityDates.add(event.dateKey);
    activityDatesByCohortId.set(event.cohort.id, activityDates);

    await prisma.planningException.create({
      data: {
        tenantId: tenant.id,
        studentCohortId: event.cohort.id,
        type: "ACTIVITY_DAY",
        status: "ACTIVE",
        impactMode: "BLOCK",
        name: `Scale activity day ${String(event.index + 1).padStart(3, "0")}`,
        description: `Deterministic scale benchmark activity for ${event.cohort.code}.`,
        startAt: new Date(`${event.dateKey}T06:00:00.000Z`),
        endAt: new Date(`${event.dateKey}T16:00:00.000Z`),
      },
    });
  }

  const basePlanAllocationItems: CohortCapacityItem[] = [];

  const studentRequirementRows: Array<{
    tenantId: string;
    studentId: string;
    courseId: string;
    academicPeriodId: string;
    requiredAmount: number;
    unit: "MINUTES";
    priority: "CRITICAL" | "HIGH" | "NORMAL";
    active: boolean;
  }> = [];

  let teachingGroupCount = 0;
  let teachingRequirementCount = 0;
  let teachingRequirementWeekCount = 0;

  for (let cohortIndex = 0; cohortIndex < cohorts.length; cohortIndex += 1) {
    const coreCourseCount = Math.min(6, profile.coursesPerCohort);
    const selectedCourseIndexes = new Set<number>();

    for (let index = 0; index < coreCourseCount; index += 1) {
      selectedCourseIndexes.add(index);
    }

    let offset = 0;
    while (selectedCourseIndexes.size < profile.coursesPerCohort) {
      selectedCourseIndexes.add(
        coreCourseCount +
          ((cohortIndex * 5 + offset * 7) %
            Math.max(1, courses.length - coreCourseCount)),
      );
      offset += 1;
    }

    for (const courseIndex of [...selectedCourseIndexes].sort(
      (a, b) => a - b,
    )) {
      const course = courses[courseIndex];
      const groupCode = `CL${String(cohortIndex + 1).padStart(3, "0")}-${course.code}`;
      const weeklyMinutes = courseIndex < 2 ? 180 : courseIndex < 6 ? 135 : 90;
      const priority =
        courseIndex < 2 ? "CRITICAL" : courseIndex < 6 ? "HIGH" : "NORMAL";

      const teachingGroup = await prisma.teachingGroup.upsert({
        where: {
          tenantId_code: {
            tenantId: tenant.id,
            code: groupCode,
          },
        },
        update: {
          academicPeriodId: academicPeriod.id,
          courseId: course.id,
          studentCohortId: cohorts[cohortIndex].id,
          membershipMode: "FULL_COHORT",
          schedulingPriority:
            priority === "CRITICAL" ? 250 : priority === "HIGH" ? 220 : 180,
          name: `${cohorts[cohortIndex].code} ${course.code}`,
          maxStudents: profile.cohortSize + 5,
          status: "ACTIVE",
        },
        create: {
          tenantId: tenant.id,
          academicPeriodId: academicPeriod.id,
          courseId: course.id,
          studentCohortId: cohorts[cohortIndex].id,
          membershipMode: "FULL_COHORT",
          schedulingPriority:
            priority === "CRITICAL" ? 250 : priority === "HIGH" ? 220 : 180,
          name: `${cohorts[cohortIndex].code} ${course.code}`,
          code: groupCode,
          maxStudents: profile.cohortSize + 5,
          status: "ACTIVE",
        },
      });
      teachingGroupCount += 1;

      await prisma.teachingGroupStudent.deleteMany({
        where: {
          tenantId: tenant.id,
          teachingGroupId: teachingGroup.id,
        },
      });
      await prisma.teachingGroupStudent.createMany({
        data: studentsByCohort[cohortIndex].map((student) => ({
          tenantId: tenant.id,
          teachingGroupId: teachingGroup.id,
          studentId: student.id,
        })),
      });

      const targetMinutes = weekStarts.reduce(
        (total, weekStart) =>
          total +
          ((weeklyTeachingDays.get(dateOnlyIso(weekStart)) ?? 0) > 0
            ? weeklyMinutes
            : 0),
        0,
      );

      const requirement = await prisma.teachingRequirement.upsert({
        where: {
          tenantId_planId_teachingGroupId: {
            tenantId: tenant.id,
            planId: plan.id,
            teachingGroupId: teachingGroup.id,
          },
        },
        update: {
          academicPeriodId: academicPeriod.id,
          totalMinutes: targetMinutes,
          distributionMode: "EVEN_BY_TEACHING_CAPACITY",
          minWeeklyMinutes: Math.max(45, weeklyMinutes - 45),
          preferredWeeklyMinutes: weeklyMinutes,
          maxWeeklyMinutes: weeklyMinutes + 45,
          carryoverAllowed: true,
          priority,
          active: true,
        },
        create: {
          tenantId: tenant.id,
          planId: plan.id,
          teachingGroupId: teachingGroup.id,
          academicPeriodId: academicPeriod.id,
          totalMinutes: targetMinutes,
          distributionMode: "EVEN_BY_TEACHING_CAPACITY",
          minWeeklyMinutes: Math.max(45, weeklyMinutes - 45),
          preferredWeeklyMinutes: weeklyMinutes,
          maxWeeklyMinutes: weeklyMinutes + 45,
          carryoverAllowed: true,
          priority,
        },
      });

      teachingRequirementCount += 1;

      const cohortActivityDates =
        activityDatesByCohortId.get(cohorts[cohortIndex].id) ??
        new Set<string>();

      const weeks = weekStarts.map((weekStart) => {
        let calendarTeachingDays = 0;
        let availableTeachingDays = 0;
        let blockedByActivity = false;

        for (let offset = 0; offset < 5; offset += 1) {
          const date = addUtcDays(weekStart, offset);
          const dateKey = dateOnlyIso(date);

          const autumnBreak =
            date >= new Date("2026-10-05T00:00:00.000Z") &&
            date <= new Date("2026-10-09T00:00:00.000Z");

          if (autumnBreak) {
            continue;
          }

          calendarTeachingDays += 1;

          if (cohortActivityDates.has(dateKey)) {
            blockedByActivity = true;
            continue;
          }

          availableTeachingDays += 1;
        }

        return {
          weekStartDate: weekStart,
          calendarTeachingDays,
          availableTeachingDays,
          adjustmentReason:
            calendarTeachingDays === 0
              ? "Autumn break"
              : blockedByActivity
                ? "Blocking planning exception reduces teaching capacity"
                : null,
        };
      });

      const minWeeklyMinutes = Math.max(45, weeklyMinutes - 45);
      const maxWeeklyMinutes = weeklyMinutes + 45;

      const quantumMinutes = Math.max(
        course.minSessionMinutes ?? 45,
        1,
      );

      const sessionMinutes = Math.max(
        course.preferredSessionMinutes ??
          course.minSessionMinutes ??
          45,
        1,
      );

      const allocations = distributeMinutes({
        totalMinutes: targetMinutes,
        quantumMinutes,
        minWeeklyMinutes,
        preferredWeeklyMinutes: weeklyMinutes,
        maxWeeklyMinutes,
        mode: "EVEN_BY_TEACHING_CAPACITY",
        weeks,
      });

      basePlanAllocationItems.push({
        id: requirement.id,
        cohortId: cohorts[cohortIndex].id,
        priority,
        carryoverAllowed: true,
        minWeeklyMinutes,
        maxWeeklyMinutes,
        quantumMinutes,
        sessionMinutes,
        allocations,
      });

      for (const student of studentsByCohort[cohortIndex]) {
        studentRequirementRows.push({
          tenantId: tenant.id,
          studentId: student.id,
          courseId: course.id,
          academicPeriodId: academicPeriod.id,
          requiredAmount: targetMinutes,
          unit: "MINUTES",
          priority,
          active: true,
        });
      }
    }
  }

  const rebalancedBasePlanAllocations =
    rebalanceCohortWeeklyCapacity({
      items: basePlanAllocationItems,
      limits: {
        maxSessionsPerDay: loadProfile.maxSessionsPerDay,
        maxTeachingMinutesPerDay: loadProfile.maxTeachingMinutesPerDay,
      },
    });

  const requirementIds = rebalancedBasePlanAllocations.map(
    (item) => item.id,
  );

  await prisma.teachingRequirementWeek.deleteMany({
    where: {
      tenantId: tenant.id,
      teachingRequirementId: {
        in: requirementIds,
      },
    },
  });

  const teachingRequirementWeekRows =
    rebalancedBasePlanAllocations.flatMap((item) =>
      item.allocations.map((allocation) => ({
        tenantId: tenant.id,
        teachingRequirementId: item.id,
        weekStartDate: allocation.weekStartDate,
        targetMinutes: allocation.targetMinutes,
        minMinutes:
          allocation.availableTeachingDays > 0
            ? item.minWeeklyMinutes
            : 0,
        maxMinutes:
          allocation.availableTeachingDays > 0
            ? item.maxWeeklyMinutes
            : 0,
        availableTeachingDays: allocation.availableTeachingDays,
        adjustmentReason: allocation.adjustmentReason,
      })),
    );

  await createManyInBatches(
    teachingRequirementWeekRows,
    (batch) =>
      prisma.teachingRequirementWeek.createMany({
        data: batch,
      }),
  );

  teachingRequirementWeekCount =
    teachingRequirementWeekRows.length;

  await prisma.studentCourseRequirement.deleteMany({
    where: {
      tenantId: tenant.id,
      academicPeriodId: academicPeriod.id,
    },
  });

  await createManyInBatches(studentRequirementRows, (batch) =>
    prisma.studentCourseRequirement.createMany({
      data: batch,
      skipDuplicates: true,
    }),
  );

  await prisma.instructorAvailability.deleteMany({
    where: {
      tenantId: tenant.id,
      reasonCode: "SCALE_SEED_BLOCK",
    },
  });

  const instructorAvailabilityRows = Array.from(
    { length: profile.instructorUnavailableEvents },
    (_, index) => {
      const instructor = instructors[index % instructors.length];
      const weekOffset = pickInt(rng, 1, 15);
      const weekdayOffset = pickInt(rng, 0, 4);
      const date = addUtcDays(
        new Date("2026-08-17T00:00:00.000Z"),
        weekOffset * 7 + weekdayOffset,
      );
      const morning = rng() < 0.5;
      return {
        tenantId: tenant.id,
        instructorId: instructor.id,
        date,
        startMinute: morning ? 8 * 60 : 12 * 60,
        endMinute: morning ? 12 * 60 : 17 * 60,
        status: "UNAVAILABLE" as const,
        reasonCode: "SCALE_SEED_BLOCK",
      };
    },
  );
  await prisma.instructorAvailability.createMany({
    data: instructorAvailabilityRows,
  });

  await prisma.roomAvailability.deleteMany({
    where: {
      tenantId: tenant.id,
      reasonCode: "SCALE_SEED_BLOCK",
    },
  });

  const roomAvailabilityRows = Array.from(
    { length: profile.roomUnavailableEvents },
    (_, index) => {
      const room = rooms[index % rooms.length];
      const weekOffset = pickInt(rng, 1, 15);
      const weekdayOffset = pickInt(rng, 0, 4);
      const date = addUtcDays(
        new Date("2026-08-17T00:00:00.000Z"),
        weekOffset * 7 + weekdayOffset,
      );
      return {
        tenantId: tenant.id,
        roomId: room.id,
        date,
        startMinute: 8 * 60,
        endMinute: 17 * 60,
        status: "UNAVAILABLE" as const,
        reasonCode: "SCALE_SEED_BLOCK",
      };
    },
  );
  await prisma.roomAvailability.createMany({
    data: roomAvailabilityRows,
  });

  await prisma.planningRule.deleteMany({
    where: {
      tenantId: tenant.id,
      name: { startsWith: "Scale benchmark" },
    },
  });

  const instructorRuleCount = Math.max(
    2,
    Math.floor(profile.instructors * 0.08),
  );
  for (let index = 0; index < instructorRuleCount; index += 1) {
    const instructor = instructors[(index * 13) % instructors.length];
    await prisma.planningRule.create({
      data: {
        tenantId: tenant.id,
        name: `Scale benchmark instructor preference ${String(index + 1).padStart(3, "0")}`,
        description: "Deterministic soft availability preference.",
        ruleType: "AVOID_TIME_WINDOW",
        scopeType: "INSTRUCTOR",
        constraintType: "SOFT",
        valueUnit: "NONE",
        audience: "INSTRUCTORS",
        weekdays: [(index % 5) + 1],
        startMinute: index % 2 === 0 ? 8 * 60 : 14 * 60,
        endMinute: index % 2 === 0 ? 10 * 60 : 17 * 60,
        weight: 80 + (index % 5) * 20,
        instructorId: instructor.id,
        active: true,
      },
    });
  }

  const elapsedSeconds = (performance.now() - startedAt) / 1000;

  const manifest = {
    profile: profileName,
    tenantCode,
    adminEmail,
    datasetVersion: DATASET_VERSION,
    complexityProfile: COMPLEXITY_PROFILE,
    generatorSeed: profile.generatorSeed,
    students: profile.students,
    instructors: profile.instructors,
    flexibleInstructors:
      profile.instructors - Math.floor(profile.instructors * 0.85),
    rooms: profile.rooms,
    courses: profile.courses,
    campuses: profile.campuses,
    cohorts: cohortCount,
    teachingGroups: teachingGroupCount,
    teachingRequirements: teachingRequirementCount,
    teachingRequirementWeeks: teachingRequirementWeekCount,
    studentCourseRequirements: studentRequirementRows.length,
    instructorAvailabilityEvents: instructorAvailabilityRows.length,
    roomAvailabilityEvents: roomAvailabilityRows.length,
    cohortActivityEvents: profile.cohortActivityEvents,
    seedSeconds: Number(elapsedSeconds.toFixed(2)),
    planId: plan.id,
  };

  console.log("\nScale seed complete.");
  console.log(JSON.stringify(manifest, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
