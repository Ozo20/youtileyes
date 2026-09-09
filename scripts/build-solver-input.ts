import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";

const SCHEMA_VERSION = "1.0";

function clock(hour: number, minute: number): number {
 return hour * 60 + minute;
}

async function main() {
 const tenant = await prisma.tenant.findUnique({
   where: {
     code: "DEMO",
   },
 });

 if (!tenant) {
   throw new Error(
     'Demo tenant "DEMO" was not found. Run npm run db:seed first.',
   );
 }

 const scenario = await prisma.planScenario.findFirst({
   where: {
     tenantId: tenant.id,
     name: "Initial solver scenario",
   },
   orderBy: {
     createdAt: "desc",
   },
 });

 if (!scenario) {
   throw new Error("Demo PlanScenario was not found.");
 }

 const rooms = await prisma.room.findMany({
   where: {
     tenantId: tenant.id,
     active: true,
   },
   orderBy: {
     code: "asc",
   },
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
       where: {
         active: true,
       },
       include: {
         course: true,
       },
     },
   },
   orderBy: {
     lastName: "asc",
   },
 });

 const teachingGroups = await prisma.teachingGroup.findMany({
   where: {
     tenantId: tenant.id,
     status: "ACTIVE",
   },
   include: {
     course: true,
     students: {
       include: {
         student: true,
       },
     },
   },
   orderBy: {
     code: "asc",
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

 /*
  * V1 integration assumption:
  * Until room applicability/preferences are modelled explicitly,
  * every active room with sufficient capacity is considered usable.
  * The solver itself still checks capacity.
  */
 const activeRoomIds = rooms.map((room) => room.id);

 /*
  * V1 integration assumption:
  * All demo rooms are currently represented under the same Location.
  * Explicit room/building travel rules will replace these zero-minute
  * links in the next domain slice.
  */
 const travel = rooms.flatMap((fromRoom) =>
   rooms.map((toRoom) => ({
     fromRoomId: fromRoom.id,
     toRoomId: toRoom.id,
     minutes: 0,
   })),
 );

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
     courseIds: instructor.courses.map(
       (link) => link.course.id,
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

     return {
       id: group.id,
       courseId: group.course.id,
       studentIds: group.students.map(
         (membership) => membership.student.id,
       ),
       durationMinutes,
       allowedRoomIds: activeRoomIds,
     };
   }),

   travel,

   studentLoadProfile: {
     maxTeachingMinutesPerDay:
       loadProfile.maxTeachingMinutesPerDay,
     maxContinuousTeachingMinutes:
       loadProfile.maxContinuousTeachingMinutes,
     minBreakMinutes:
       loadProfile.minBreakMinutes ?? 0,

     // Until this gets its own persisted field.
     minBreakAfterDoubleMinutes: Math.max(
       loadProfile.minBreakMinutes ?? 0,
       20,
     ),

     maxSessionsPerDay:
       loadProfile.maxSessionsPerDay,
     minLunchMinutes:
       loadProfile.minLunchMinutes,

     // Demo planning window. These become configurable later.
     lunchWindowStart: clock(11, 0),
     lunchWindowEnd: clock(13, 30),

     travelConsumesBreakTime:
       loadProfile.travelConsumesBreakTime,
   },

   metadata: {
     source: "youtileyes-postgresql",
     tenantCode: tenant.code,
     generatedAt: new Date().toISOString(),
   },
 };

 const outputPath =
   process.argv[2] ?? "/tmp/youtileyes_solver_input.json";

 await writeFile(
   outputPath,
   JSON.stringify(payload, null, 2) + "\n",
   "utf8",
 );

 console.log("Solver input generated");
 console.log(`Path: ${outputPath}`);
 console.log(`Tenant: ${tenant.name}`);
 console.log(`Scenario: ${scenario.name}`);
 console.log(`Teaching groups: ${teachingGroups.length}`);
 console.log(`Instructors: ${instructors.length}`);
 console.log(`Rooms: ${rooms.length}`);
}

main()
 .catch((error) => {
   console.error(error);
   process.exitCode = 1;
 })
 .finally(async () => {
   await prisma.$disconnect();
 });
