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

type QueuedSolverJob = {
  id: string;
  recoveryCaseId: string | null;
  config: unknown;
};

async function findNextQueuedJob(): Promise<QueuedSolverJob | null> {
  return prisma.solverJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: [{ priority: "asc" }, { queuedAt: "asc" }],
    select: {
      id: true,
      recoveryCaseId: true,
      config: true,
    },
  });
}

function solverJobType(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }

  const type = (config as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

async function processSolverJob(job: QueuedSolverJob): Promise<void> {
  const type = solverJobType(job.config);

  let processor: string;
  if (job.recoveryCaseId || type === "RECOVERY_CASE") {
    processor = "scripts/process-recovery-case-job.ts";
  } else if (type === "BASE_PLAN" || type === "RESOURCE_RECOVERY") {
    processor = "scripts/process-solver-job.ts";
  } else {
    const failureMessage = `Unsupported solver job type: ${JSON.stringify(type)}.`;

    await prisma.solverJob.updateMany({
      where: {
        id: job.id,
        status: "QUEUED",
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        failureMessage,
      },
    });

    console.error(
      `[solver-worker] SolverJob ${job.id} rejected: ${failureMessage}`,
    );
    return;
  }

  console.log(
    `[solver-worker] Processing SolverJob ${job.id} (${type ?? "unknown"}) with ${processor}.`,
  );

  const executable = process.platform === "win32" ? "npx.cmd" : "npx";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["tsx", processor, "--job", job.id], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `SolverJob ${job.id} worker process exited with code ${String(
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

      // The selected processor remains authoritative for the atomic
      // QUEUED -> RUNNING claim and all job state transitions.
      await processSolverJob(job);
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
