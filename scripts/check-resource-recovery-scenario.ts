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
      sessions: true,
      changes: true,
      metrics: true,
    },
  });

  if (!scenario) {
    throw new Error("No resource recovery scenario found.");
  }

  const direct = scenario.changes.filter(
    (change) =>
      change.explanationCode === "RESOURCE_RECOVERY_DIRECT",
  ).length;

  const cascading = scenario.changes.filter(
    (change) =>
      change.explanationCode === "RESOURCE_RECOVERY_CASCADE",
  ).length;

  if (scenario.status !== "GENERATED") {
    throw new Error(
      `Expected GENERATED scenario, got ${scenario.status}.`,
    );
  }

  if (scenario.sessions.length === 0) {
    throw new Error("Recovery scenario contains no sessions.");
  }

  console.log("=== RECOVERY SCENARIO CHECK ===");
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Status: ${scenario.status}`);
  console.log(`Sessions: ${scenario.sessions.length}`);
  console.log(`Changes: ${scenario.changes.length}`);
  console.log(`Direct: ${direct}`);
  console.log(`Cascading: ${cascading}`);
  console.log(`Metrics: ${scenario.metrics.length}`);
  console.log("Recovery scenario check: PASS");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
