import "dotenv/config";

import { prisma } from "../src/lib/prisma";

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
  });

  assert(tenant, "Demo tenant not found. Run npm run db:seed first.");

  const plan = await prisma.plan.findFirst({
    where: {
      tenantId: tenant.id,
      name: "Demo plan",
      version: 1,
    },
    include: {
      academicPeriod: true,
      reviewWorkflows: {
        include: {
          steps: {
            orderBy: [{ stage: "asc" }, { position: "asc" }],
          },
        },
      },
    },
  });

  assert(plan, "Demo plan not found.");
  assert(plan.planningAsOfDate, "planningAsOfDate is missing.");
  assert(plan.frozenThroughDate, "frozenThroughDate is missing.");
  assert(plan.planningStartDate, "planningStartDate is missing.");
  assert(plan.planningEndDate, "planningEndDate is missing.");
  assert(plan.effectiveFrom, "effectiveFrom is missing.");

  assert(
    plan.planningAsOfDate <= plan.frozenThroughDate,
    "planningAsOfDate must be on/before frozenThroughDate.",
  );
  assert(
    plan.frozenThroughDate < plan.planningStartDate,
    "planningStartDate must be after the frozen period.",
  );
  assert(
    plan.planningStartDate <= plan.planningEndDate,
    "planningStartDate must be on/before planningEndDate.",
  );
  assert(
    plan.planningStartDate >= plan.academicPeriod.startDate,
    "planningStartDate is before the academic period.",
  );
  assert(
    plan.planningEndDate <= plan.academicPeriod.endDate,
    "planningEndDate is after the academic period.",
  );
  assert(
    plan.effectiveFrom === null || plan.effectiveFrom >= plan.planningStartDate,
    "effectiveFrom cannot precede planningStartDate for this future revision.",
  );

  const workflow = plan.reviewWorkflows.find(
    (item) => item.name === "Standard plan approval",
  );

  assert(workflow, "Standard plan approval workflow not found.");
  assert(workflow.steps.length >= 1, "Review workflow has no steps.");

  const requiredSteps = workflow.steps.filter((step) => step.required);
  assert(requiredSteps.length >= 1, "Review workflow has no required approval steps.");

  console.log("=== YOUTILEYES PLAN LIFECYCLE ===");
  console.log(`Plan: ${plan.name} v${plan.version}`);
  console.log(`Status: ${plan.status}`);
  console.log(`Academic period: ${dateOnly(plan.academicPeriod.startDate)} -> ${dateOnly(plan.academicPeriod.endDate)}`);
  console.log(`As-of date: ${dateOnly(plan.planningAsOfDate)}`);
  console.log(`Frozen through: ${dateOnly(plan.frozenThroughDate)}`);
  console.log(`Editable horizon: ${dateOnly(plan.planningStartDate)} -> ${dateOnly(plan.planningEndDate)}`);
  console.log(`Effective from: ${dateOnly(plan.effectiveFrom)}`);
  console.log(`Review workflow: ${workflow.name} (${workflow.status})`);

  for (const step of workflow.steps) {
    console.log(
      `  Stage ${step.stage}.${step.position}: ${step.name} · ${step.reviewerRole ?? "unassigned role"} · ${step.status}${step.required ? " · required" : ""}`,
    );
  }

  console.log("Plan lifecycle check: PASS");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
