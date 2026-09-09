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

 const rooms = await Promise.all(
   [
     ["A10", 10],
     ["A11", 10],
     ["B14", 10],
   ].map(async ([code, capacity]) =>
     prisma.room.upsert({
       where: {
         tenantId_code: {
           tenantId: tenant.id,
           code: String(code),
         },
       },
       update: {},
       create: {
         tenantId: tenant.id,
         locationId: location.id,
         name: String(code),
         code: String(code),
         capacity: Number(capacity),
       },
     }),
   ),
 );

 const roomByCode = Object.fromEntries(
   rooms.map((room) => [room.code!, room]),
 );

 const courses = await Promise.all(
   [
     ["MAT", "Mathematics", 90, true],
     ["FYS", "Physics", 45, false],
     ["ENG", "English", 45, false],
     ["NOR", "Norwegian", 45, false],
   ].map(async ([code, name, preferredMinutes, allowDouble]) =>
     prisma.course.upsert({
       where: {
         tenantId_code: {
           tenantId: tenant.id,
           code: String(code),
         },
       },
       update: {},
       create: {
         tenantId: tenant.id,
         code: String(code),
         name: String(name),
         preferredSessionMinutes: Number(preferredMinutes),
         maxSessionMinutes: Number(preferredMinutes),
         minSessionMinutes: 45,
         allowDoubleSession: Boolean(allowDouble),
         maxGroupSize: 10,
       },
     }),
   ),
 );

 const courseByCode = Object.fromEntries(
   courses.map((course) => [course.code!, course]),
 );

 const instructors = await Promise.all(
   [
     ["T1", "Kari", "Hansen"],
     ["T2", "Per", "Olsen"],
   ].map(async ([externalId, firstName, lastName]) =>
     prisma.instructor.upsert({
       where: {
         tenantId_externalId_sourceSystem: {
           tenantId: tenant.id,
           externalId,
           sourceSystem: "SEED",
         },
       },
       update: {},
       create: {
         tenantId: tenant.id,
         externalId,
         sourceSystem: "SEED",
         firstName,
         lastName,
         primaryOrganisationUnitId: organisation.id,
         primaryLocationId: location.id,
       },
     }),
   ),
 );

 const instructorByExternalId = Object.fromEntries(
   instructors.map((instructor) => [
     instructor.externalId!,
     instructor,
   ]),
 );

 const instructorCourses = [
   ["T1", "MAT"],
   ["T1", "FYS"],
   ["T2", "ENG"],
   ["T2", "NOR"],
 ];

 for (const [instructorId, courseCode] of instructorCourses) {
   await prisma.instructorCourse.upsert({
     where: {
       tenantId_instructorId_courseId: {
         tenantId: tenant.id,
         instructorId: instructorByExternalId[instructorId].id,
         courseId: courseByCode[courseCode].id,
       },
     },
     update: {},
     create: {
       tenantId: tenant.id,
       instructorId: instructorByExternalId[instructorId].id,
       courseId: courseByCode[courseCode].id,
     },
   });
 }

 const students = await Promise.all(
   ["S1", "S2", "S3", "S4", "S5"].map(async (externalId) =>
     prisma.student.upsert({
       where: {
         tenantId_externalId_sourceSystem: {
           tenantId: tenant.id,
           externalId,
           sourceSystem: "SEED",
         },
       },
       update: {},
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
   ["G1", "MAT", ["S1", "S2"], 90],
   ["G2", "ENG", ["S1", "S3"], 45],
   ["G3", "FYS", ["S1", "S4"], 45],
   ["G4", "NOR", ["S1", "S5"], 45],
 ] as const;

 for (const [code, courseCode, studentIds] of groupDefinitions) {
   const group = await prisma.teachingGroup.upsert({
     where: {
       tenantId_code: {
         tenantId: tenant.id,
         code,
       },
     },
     update: {},
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

 const loadProfile = await prisma.loadProfile.upsert({
   where: {
     tenantId_code: {
       tenantId: tenant.id,
       code: "STANDARD",
     },
   },
   update: {},
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
   update: {},
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

 const travelPairs = [
   ["A10", "A11", 3],
   ["A11", "A10", 3],
   ["A10", "B14", 12],
   ["B14", "A10", 12],
   ["A11", "B14", 12],
   ["B14", "A11", 12],
 ] as const;

 for (const [from, to, minutes] of travelPairs) {
   await prisma.locationRelation.upsert({
     where: {
       tenantId_fromLocationId_toLocationId_relationType: {
         tenantId: tenant.id,
         fromLocationId: location.id,
         toLocationId: location.id,
         relationType: "TRAVEL",
       },
     },
     update: {},
     create: {
       tenantId: tenant.id,
       fromLocationId: location.id,
       toLocationId: location.id,
       relationType: "TRAVEL",
       minimumMinutes: minutes,
     },
   }).catch(() => {
     // Room-to-room travel is handled in the demo adapter below.
     // LocationRelation remains available for campus/building travel later.
   });
 }

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
