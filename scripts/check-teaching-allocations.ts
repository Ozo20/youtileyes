import "dotenv/config";

import { prisma } from "../src/lib/prisma";

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
  });

  if (!tenant) {
    throw new Error('Demo tenant "DEMO" was not found.');
  }

  const plan = await prisma.plan.findFirst({
    where: {
      tenantId: tenant.id,
      status: { not: "ARCHIVED" },
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });

  if (!plan) {
    throw new Error("No Plan revision found.");
  }

  const requirements = await prisma.teachingRequirement.findMany({
    where: {
      tenantId: tenant.id,
      planId: plan.id,
      active: true,
    },
    include: {
      teachingGroup: true,
      weeklyAllocations: {
        orderBy: { weekStartDate: "asc" },
      },
    },
    orderBy: {
      teachingGroup: {
        code: "asc",
      },
    },
  });

  if (requirements.length === 0) {
    throw new Error(
      `No active teaching requirements found for Plan v${plan.version}.`,
    );
  }

  console.log(
    `Checking Base Plan allocations for Plan v${plan.version} (${plan.status}).`,
  );

  for (const requirement of requirements) {
    const allocated = requirement.weeklyAllocations.reduce(
      (sum, week) => sum + week.targetMinutes,
      0,
    );

    if (allocated !== requirement.totalMinutes) {
      throw new Error(
        `${requirement.teachingGroup.code}: allocated ${allocated}, expected ${requirement.totalMinutes}.`,
      );
    }

    const adjusted = requirement.weeklyAllocations.filter((week) =>
      Boolean(week.adjustmentReason),
    );

    console.log(
      `${requirement.teachingGroup.code}: PASS · ${allocated} minutes · ` +
        `${requirement.weeklyAllocations.length} weeks · ${adjusted.length} adjusted week(s)`,
    );
  }

  const cohort = await prisma.studentCohort.findFirst({
    where: {
      tenantId: tenant.id,
      code: "ST2A",
    },
    include: {
      members: true,
      teachingGroups: true,
      planningExceptions: {
        where: {
          status: "ACTIVE",
          impactMode: "BLOCK",
        },
      },
    },
  });

  if (!cohort) {
    throw new Error("ST2A cohort was not found.");
  }

  if (cohort.members.length !== 20) {
    throw new Error(
      `ST2A expected 20 members, found ${cohort.members.length}.`,
    );
  }

  if (
    cohort.teachingGroups.some(
      (group) => group.membershipMode !== "FULL_COHORT",
    )
  ) {
    throw new Error(
      "Every ST2A demo teaching group should use FULL_COHORT membership.",
    );
  }

  if (cohort.planningExceptions.length === 0) {
    throw new Error("Expected an active blocking cohort planning exception.");
  }

  console.log(
    `ST2A: PASS · ${cohort.members.length} students · ` +
      `${cohort.teachingGroups.length} full-cohort teaching groups · ` +
      `${cohort.planningExceptions.length} blocking activity exception(s)`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
