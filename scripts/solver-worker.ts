import "dotenv/config";

import { spawn } from "node:child_process";

import { prisma } from "../src/lib/prisma";

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const pollIntervalMs = positiveInteger(
  process.env.SOLVER_WORKER_POLL_INTERVAL_MS,
  5_000,
);
const errorBackoffMs = positiveInteger(
  process.env.SOLVER_WORKER_ERROR_BACKOFF_MS,
  10_000,
);
const workerName =
  process.env.SOLVER_WORKER_NAME ??
  process.env.RAILWAY_REPLICA_ID ??
  `worker-${process.pid}`;

let stopRequested = false;

function requestShutdown(signal: NodeJS.Signals) {
  if (stopRequested) return;

  stopRequested = true;
  console.log(
    `[solver-worker] ${signal} received; stopping after the current job.`,
  );
}

process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function findNextQueuedJob(): Promise<{ id: string } | null> {
  return prisma.solverJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: [{ priority: "asc" }, { queuedAt: "asc" }],
    select: { id: true },
  });
}

async function processSolverJob(jobId: string): Promise<void> {
  console.log(`[solver-worker] Processing SolverJob ${jobId}.`);

  const executable = process.platform === "win32" ? "npx.cmd" : "npx";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable,
      ["tsx", "scripts/process-solver-job.ts", "--job", jobId],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );

    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `SolverJob ${jobId} worker process exited with code ${String(
            code,
          )}${signal ? ` (${signal})` : ""}.`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  console.log(
    `[solver-worker] ${workerName} started; polling every ${pollIntervalMs} ms.`,
  );

  while (!stopRequested) {
    try {
      const job = await findNextQueuedJob();

      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }

      // process-solver-job.ts remains the authoritative place for the atomic
      // QUEUED -> RUNNING claim and all job state transitions.
      await processSolverJob(job.id);
    } catch (error) {
      console.error("[solver-worker] Worker iteration failed.", error);

      if (!stopRequested) {
        await sleep(errorBackoffMs);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error("[solver-worker] Fatal worker error.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`[solver-worker] ${workerName} stopped.`);
  });
