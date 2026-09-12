import "dotenv/config";

import { spawn } from "node:child_process";

import { prisma } from "../src/lib/prisma";

async function main() {
  const job = await prisma.solverJob.findFirst({
    where: {
      status: "QUEUED",
    },
    orderBy: [
      { priority: "asc" },
      { queuedAt: "asc" },
    ],
    select: {
      id: true,
    },
  });

  if (!job) {
    console.log("No queued solver job found.");
    return;
  }

  console.log(`Processing queued SolverJob ${job.id}...`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "tsx",
        "scripts/process-solver-job.ts",
        "--job",
        job.id,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Solver worker exited with code ${code}.`,
          ),
        );
      }
    });
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
