import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";

import {
  type RecoveryCandidateDescriptor,
  type SolverInputLike,
  verifyRecoveryCandidate,
} from "../src/lib/planning/recovery-verification";
import { prisma } from "../src/lib/prisma";

const SOLVER_INPUT_PATH =
  process.env.YOUTILEYES_SOLVER_INPUT ??
  "/tmp/youtileyes_solver_input.json";
const RECOVERY_PATH =
  process.env.YOUTILEYES_RECOVERY_INPUT ??
  "/tmp/youtileyes_recovery.json";
const OUTPUT_PATH =
  process.env.YOUTILEYES_RECOVERY_VERIFIED_OUTPUT ??
  "/tmp/youtileyes_recovery_verified.json";

type RecoveryReport = {
  schemaVersion: string;
  planId: string;
  planName: string;
  planningWindow: {
    startDate: string;
    endDate: string;
  };
  requirements: Array<{
    requirementId: string;
    groupCode: string;
    courseName: string;
    baseline: {
      status: "GREEN" | "AMBER" | "RED";
      marginMinutes: number;
    };
    recovery: Array<
      RecoveryCandidateDescriptor & {
        disruptionScore: number;
        resultingStatus: "GREEN" | "AMBER" | "RED";
        resultingMarginMinutes: number;
        deferredMinutes?: number;
      }
    >;
  }>;
};

async function main() {
  const baseInput = JSON.parse(
    await readFile(SOLVER_INPUT_PATH, "utf8"),
  ) as SolverInputLike;

  const recoveryReport = JSON.parse(
    await readFile(RECOVERY_PATH, "utf8"),
  ) as RecoveryReport;

  const redRequirements = recoveryReport.requirements.filter(
    (item) => item.baseline.status === "RED",
  );

  const results = [];

  for (const requirement of redRequirements) {
    const requirementRecord =
      await prisma.teachingRequirement.findUnique({
        where: {
          id: requirement.requirementId,
        },
        select: {
          id: true,
          teachingGroupId: true,
        },
      });

    if (!requirementRecord) {
      throw new Error(
        `TeachingRequirement ${requirement.requirementId} was not found.`,
      );
    }

    const options = [];

    for (const candidate of requirement.recovery) {
      const verification = await verifyRecoveryCandidate(
        baseInput,
        requirementRecord.teachingGroupId,
        candidate,
      );

      options.push({
        ...candidate,
        ...verification,
      });
    }

    options.sort((a, b) => {
      const rank = {
        VERIFIED: 0,
        REQUIRES_POLICY_CHANGE: 1,
        ESTIMATED: 2,
        NOT_APPLICABLE: 3,
        NOT_FEASIBLE: 4,
      } as const;

      const statusDifference =
        rank[a.verificationStatus] - rank[b.verificationStatus];

      if (statusDifference !== 0) return statusDifference;

      return a.disruptionScore - b.disruptionScore;
    });

    results.push({
      requirementId: requirement.requirementId,
      teachingGroupId: requirementRecord.teachingGroupId,
      groupCode: requirement.groupCode,
      courseName: requirement.courseName,
      baseline: requirement.baseline,
      recovery: options,
    });
  }

  const output = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    planId: recoveryReport.planId,
    planName: recoveryReport.planName,
    planningWindow: recoveryReport.planningWindow,
    requirements: results,
  };

  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );

  console.log("=== YOUTILEYES VERIFIED RECOVERY ===");
  console.log(`Plan: ${recoveryReport.planName}`);
  console.log(
    `Window: ${recoveryReport.planningWindow.startDate} -> ${recoveryReport.planningWindow.endDate}`,
  );

  if (results.length === 0) {
    console.log(
      "No RED requirements. No solver recovery verification is currently required.",
    );
  } else {
    for (const requirement of results) {
      console.log(
        `\nRED ${requirement.groupCode} ${requirement.courseName}`,
      );

      for (const [index, option] of requirement.recovery.entries()) {
        const solver = option.solverStatus
          ? ` · solver ${option.solverStatus}`
          : "";

        console.log(
          `  ${index + 1}. ${option.title} -> ${option.verificationStatus}${solver}`,
        );
      }
    }
  }

  console.log(`\nReport: ${OUTPUT_PATH}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
