import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";

const SCHEMA_VERSION = "1.1";

function clock(hour: number, minute: number): number {
  return hour * 60 + minute;
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

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
  });

  if (!tenant) {
    throw new Error('Demo tenant "DEMO" was not found. Run npm run db:seed first.');
  }

  const scenario = await prisma.planScenario.findFirst({
    where: {
      tenantId: tenant.id,
      name: "Initial solver scenario",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!scenario) {
    throw new Error("Demo PlanScenario was not found.");
  }

  const rooms = await prisma.room.findMany({
    where: {
      tenantId: tenant.id,
      active: true,
    },
    include: {
      coursePreferences: {
        where: { active: true },
      },
    },
    orderBy: { code: "asc" },
  });

  if (rooms.length === 0) {
    throw new Error("No active rooms found.");
  }

  const instructors = await prisma.instructor.findMany({
    where: {
      tenantId: tenant.id,
      status: "ACTIVE",
    },
    include: {
      courses: {
        where: { active: true },
        include: { course: true },
      },
      teachingGroupPreferences: {
        where: { active: true },
      },
    },
    orderBy: { lastName: "asc" },
  });

  const teachingGroups = await prisma.teachingGroup.findMany({
    where: {
      tenantId: tenant.id,
      status: "ACTIVE",
    },
    include: {
      course: true,
      students: {
        include: { student: true },
      },
      instructorPreferences: {
        where: { active: true },
      },
    },
    orderBy: { code: "asc" },
  });

  const roomTravelTimes = await prisma.roomTravelTime.findMany({
    where: {
      tenantId: tenant.id,
      active: true,
    },
  });

  const loadProfile = await prisma.loadProfile.findFirst({
    where: {
      tenantId: tenant.id,
      active: true,
      code: "STANDARD",
    },
  });

  if (!loadProfile) {
    throw new Error('LoadProfile "STANDARD" was not found.');
  }

  const roomPreferenceByCourse = new Map<
    string,
    Map<string, { suitability: "PREFERRED" | "ALLOWED" | "AVOID" | "PROHIBITED"; penalty: number }>
  >();

  for (const room of rooms) {
    for (const preference of room.coursePreferences) {
      const byRoom = roomPreferenceByCourse.get(preference.courseId) ?? new Map();
      byRoom.set(room.id, {
        suitability: preference.suitability,
        penalty: preference.penalty,
      });
      roomPreferenceByCourse.set(preference.courseId, byRoom);
    }
  }

  const instructorPreferenceByGroup = new Map<string, Map<string, number>>();

  for (const group of teachingGroups) {
    const map = new Map<string, number>();

    for (const preference of group.instructorPreferences) {
      if (preference.preference === "AVOID") {
        map.set(preference.instructorId, Math.max(0, preference.weight));
      } else if (preference.preference === "PREFER") {
        map.set(preference.instructorId, -Math.max(0, preference.weight));
      }
    }

    instructorPreferenceByGroup.set(group.id, map);
  }

  const travel = roomTravelTimes.map((item) => ({
    fromRoomId: item.fromRoomId,
    toRoomId: item.toRoomId,
    minutes: item.minutes,
  }));

  for (const room of rooms) {
    travel.push({
      fromRoomId: room.id,
      toRoomId: room.id,
      minutes: 0,
    });
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: tenant.id,
    planScenarioId: scenario.id,
    date: "2026-09-10",

    startTimes: [
      clock(8, 15),
      clock(8, 30),
      clock(8, 45),
      clock(9, 0),
      clock(9, 15),
      clock(9, 30),
      clock(9, 45),
      clock(10, 0),
      clock(10, 15),
      clock(10, 30),
      clock(10, 45),
      clock(11, 0),
      clock(11, 15),
      clock(11, 30),
      clock(11, 45),
      clock(12, 0),
      clock(12, 15),
      clock(12, 30),
      clock(12, 45),
      clock(13, 0),
      clock(13, 15),
      clock(13, 30),
      clock(13, 45),
      clock(14, 0),
    ],

    instructors: instructors.map((instructor) => ({
      id: instructor.id,
      name: `${instructor.firstName} ${instructor.lastName}`,
      courseIds: instructor.courses.map((link) => link.course.id),
      coursePenalties: Object.fromEntries(
        instructor.courses.map((link) => [
          link.course.id,
          qualificationPenalty(link.qualificationLevel),
        ]),
      ),
    })),

    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      capacity: room.capacity,
    })),

    teachingGroups: teachingGroups.map((group) => {
      const durationMinutes =
        group.course.preferredSessionMinutes ??
        group.course.minSessionMinutes ??
        45;

      const explicitPreferences = roomPreferenceByCourse.get(group.course.id);
      const allowedRooms: string[] = [];
      const roomPenalties: Record<string, number> = {};

      for (const room of rooms) {
        const preference = explicitPreferences?.get(room.id);

        if (preference?.suitability === "PROHIBITED") {
          continue;
        }

        allowedRooms.push(room.id);

        if (preference) {
          const basePenalty =
            preference.suitability === "AVOID"
              ? Math.max(preference.penalty, 50)
              : Math.max(preference.penalty, 0);

          roomPenalties[room.id] = basePenalty;
        }
      }

      const instructorPenalties = Object.fromEntries(
        instructorPreferenceByGroup.get(group.id) ?? [],
      );

      return {
        id: group.id,
        courseId: group.course.id,
        studentIds: group.students.map((membership) => membership.student.id),
        durationMinutes,
        allowedRoomIds: allowedRooms,
        roomPenalties,
        instructorPenalties,
      };
    }),

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
      source: "youtileyes-postgresql",
      tenantCode: tenant.code,
      generatedAt: new Date().toISOString(),
      resourceModel: "room-suitability-travel-instructor-preferences-v1",
    },
  };

  const outputPath = process.argv[2] ?? "/tmp/youtileyes_solver_input.json";

  await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log("Solver input generated");
  console.log(`Path: ${outputPath}`);
  console.log(`Schema: ${SCHEMA_VERSION}`);
  console.log(`Tenant: ${tenant.name}`);
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Teaching groups: ${teachingGroups.length}`);
  console.log(`Instructors: ${instructors.length}`);
  console.log(`Rooms: ${rooms.length}`);
  console.log(`Room travel rules: ${roomTravelTimes.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
