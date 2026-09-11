import "dotenv/config";

import { prisma } from "../src/lib/prisma";

async function main() {
  const scenario = await prisma.planScenario.findFirst({
    where: {
      generationConfig: {
        path: ["type"],
        equals: "RESOURCE_RECOVERY",
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      sessions: {
        include: {
          instructors: {
            include: {
              instructor: true,
            },
            orderBy: {
              role: "asc",
            },
          },
        },
      },
      changes: true,
      metrics: true,
    },
  });

  if (!scenario) {
    throw new Error("No resource recovery scenario found.");
  }

  const instructorAssignments = scenario.sessions.flatMap(
    (session) => session.instructors,
  );

  const multiInstructorSessions = scenario.sessions.filter(
    (session) => session.instructors.length > 1,
  );

  for (const assignment of instructorAssignments) {
    if (!assignment.role) {
      throw new Error(
        `ScenarioSessionInstructor ${assignment.id} has no staffing role.`,
      );
    }
  }

  console.log("=== MULTI-INSTRUCTOR PERSISTENCE CHECK ===");
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Status: ${scenario.status}`);
  console.log(`Sessions: ${scenario.sessions.length}`);
  console.log(
    `Instructor assignments: ${instructorAssignments.length}`,
  );
  console.log(
    `Multi-instructor sessions: ${multiInstructorSessions.length}`,
  );

  for (const session of multiInstructorSessions.slice(0, 5)) {
    console.log(
      `Session ${session.id}: ` +
        session.instructors
          .map(
            (assignment) =>
              `${assignment.role}=${assignment.instructor.firstName} ${assignment.instructor.lastName}`,
          )
          .join(" · "),
    );
  }

  console.log("Multi-instructor persistence check: PASS");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
