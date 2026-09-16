import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { getPlanningAnalysis } from "../src/lib/planning/planning-analysis-data";

async function main() {
  const tenantCode =
    process.env.APP_TENANT_CODE ??
    "VERIZEL-PLANNER-STAGING-M";

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { code: tenantCode },
    select: {
      id: true,
      code: true,
    },
  });

  const plan = await prisma.plan.findFirstOrThrow({
    where: {
      tenantId: tenant.id,
      status: "DRAFT",
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
    },
  });

  console.log("\n=== PLAN ===");
  console.log({
    tenant: tenant.code,
    plan: plan.name,
    version: plan.version,
    status: plan.status,
    id: plan.id,
  });

  const analysis = await getPlanningAnalysis(plan.id);

  console.log("\n=== ANALYSIS SUMMARY ===");
  console.log({
    status: analysis.status,
    canRunSolver: analysis.canRunSolver,
    counts: analysis.counts,
  });

  console.log("\n=== PHASES ===");
  console.table(
    analysis.phases.map((phase) => ({
      phase: phase.phase,
      status: phase.status,
      checks: phase.checks.length,
    })),
  );

  const blocking = analysis.checks.filter(
    (check) => check.severity === "BLOCKING",
  );

  console.log("\n=== BLOCKING ===");
  if (blocking.length === 0) {
    console.log("No blocking findings.");
  } else {
    console.table(
      blocking.map((check) => ({
        phase: check.phase,
        title: check.title,
        scope: check.scopeLabel ?? "",
        week: check.weekStartDate ?? "",
        required: check.required ?? "",
        available: check.available ?? "",
        unit: check.unit ?? "",
      })),
    );

    for (const check of blocking) {
      console.log(`\n[${check.id}]`);
      console.log(check.message);
      if (check.suggestedAction) {
        console.log(`Action: ${check.suggestedAction}`);
      }
    }
  }

  const warnings = analysis.checks.filter(
    (check) => check.severity === "WARNING",
  );

  console.log("\n=== WARNINGS ===");
  if (warnings.length === 0) {
    console.log("No warnings.");
  } else {
    console.table(
      warnings.map((check) => ({
        phase: check.phase,
        title: check.title,
        scope: check.scopeLabel ?? "",
        week: check.weekStartDate ?? "",
        required: check.required ?? "",
        available: check.available ?? "",
        unit: check.unit ?? "",
      })),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
