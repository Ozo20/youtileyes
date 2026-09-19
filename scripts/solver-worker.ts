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
const heartbeatIntervalMs = positiveInteger(
  process.env.SOLVER_WORKER_HEARTBEAT_INTERVAL_MS,
  30_000,
);

const staleHeartbeatMs = positiveInteger(
  process.env.SOLVER_WORKER_STALE_HEARTBEAT_MS,
  15 * 60_000,
);

const staleCheckIntervalMs = positiveInteger(
  process.env.SOLVER_WORKER_STALE_CHECK_INTERVAL_MS,
  60_000,
);

const workerName =
  process.env.SOLVER_WORKER_NAME ??
  process.env.RAILWAY_REPLICA_ID ??
  `worker-${process.pid}`;

const recoverStaleOnly = process.argv.includes("--recover-stale-only");

let stopRequested = false;
let lastStaleCheckAt = 0;

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

const staleJobUserMessage =
  "The timetable process stopped unexpectedly before it finished. " +
  "No published plan was changed. You can start the generation again.";

async function recoverStaleJobs(): Promise<void> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleHeartbeatMs);

  const staleJobs = await prisma.solverJob.findMany({
    where: {
      status: "RUNNING",
      OR: [
        {
          heartbeatAt: {
            lt: staleBefore,
          },
        },
        {
          heartbeatAt: null,
          startedAt: {
            lt: staleBefore,
          },
        },
      ],
    },
    select: {
      id: true,
      tenantId: true,
      planScenarioId: true,
      recoveryCaseId: true,
      config: true,
      heartbeatAt: true,
      startedAt: true,
      runs: {
        where: {
          status: "STARTED",
        },
        select: {
          id: true,
          diagnostics: true,
        },
      },
    },
  });

  for (const job of staleJobs) {
    const type = solverJobType(job.config);

    const recovered = await prisma.$transaction(async (tx) => {
      const claimed = await tx.solverJob.updateMany({
        where: {
          id: job.id,
          status: "RUNNING",
          OR: [
            {
              heartbeatAt: {
                lt: staleBefore,
              },
            },
            {
              heartbeatAt: null,
              startedAt: {
                lt: staleBefore,
              },
            },
          ],
        },
        data: {
          status: "FAILED",
          completedAt: now,
          failureMessage: staleJobUserMessage,
        },
      });

      if (claimed.count !== 1) {
        return false;
      }

      for (const run of job.runs) {
        const diagnostics =
          run.diagnostics &&
          typeof run.diagnostics === "object" &&
          !Array.isArray(run.diagnostics)
            ? run.diagnostics
            : {};

        await tx.solverRun.update({
          where: {
            id: run.id,
          },
          data: {
            status: "FAILED",
            completedAt: now,
            diagnostics: {
              ...diagnostics,
              reasonCode: "STALE_HEARTBEAT",
              interruptionType: "WORKER_HEARTBEAT_TIMEOUT",
              heartbeatAt:
                job.heartbeatAt?.toISOString() ?? null,
              recoveredAt: now.toISOString(),
            },
          },
        });
      }

      if (type === "BASE_PLAN") {
        await tx.planScenario.updateMany({
          where: {
            id: job.planScenarioId,
            status: "GENERATING",
          },
          data: {
            status: "FAILED",
            failureMessage: staleJobUserMessage,
            generatedAt: now,
          },
        });
      }

      if (type === "RECOVERY_CASE" && job.recoveryCaseId) {
        await tx.recoveryCase.updateMany({
          where: {
            id: job.recoveryCaseId,
          },
          data: {
            status: "OPEN",
          },
        });
      }

      return true;
    });

    if (!recovered) {
      continue;
    }

    console.warn(
      `[solver-worker] Recovered stale SolverJob ${job.id} ` +
        `(${type ?? "unknown"}); last heartbeat ` +
        `${job.heartbeatAt?.toISOString() ?? "missing"}.`,
    );
  }
}

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

function startJobHeartbeat(jobId: string): () => void {
  let heartbeatInFlight = false;

  const timer = setInterval(() => {
    if (heartbeatInFlight) return;

    heartbeatInFlight = true;

    void prisma.solverJob
      .updateMany({
        where: {
          id: jobId,
          status: "RUNNING",
        },
        data: {
          heartbeatAt: new Date(),
        },
      })
      .catch((error) => {
        console.error(
          `[solver-worker] Could not update heartbeat for SolverJob ${jobId}.`,
          error,
        );
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, heartbeatIntervalMs);

  timer.unref();

  return () => {
    clearInterval(timer);
  };
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

  const stopHeartbeat = startJobHeartbeat(job.id);

  try {
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
  } finally {
    stopHeartbeat();
  }
}

async function main(): Promise<void> {
  console.log(
    `[solver-worker] ${workerName} started; polling every ${pollIntervalMs} ms.`,
  );

  if (recoverStaleOnly) {
    await recoverStaleJobs();
    console.log("[solver-worker] Stale-job recovery completed.");
    return;
  }

  while (!stopRequested) {
    try {
      const now = Date.now();

      if (now - lastStaleCheckAt >= staleCheckIntervalMs) {
        await recoverStaleJobs();
        lastStaleCheckAt = now;
      }

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
