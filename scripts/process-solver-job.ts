import "dotenv/config";

import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  SolverJobStatus,
  SolverRunStatus,
} from "../src/generated/prisma/client";

import { writeAuditEvent } from "../src/lib/audit";
import { prisma } from "../src/lib/prisma";

type RecoveryJobConfig = {
  schemaVersion?: string;
  type?: string;
  baseScenarioId?: string;
  planId?: string;
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  startDate?: string;
  endDate?: string;
  correlationId?: string;
  requestedByName?: string;
};

type RecoveryReport = {
  scenarioId: string;
  scenarioName: string;
  basedOnScenarioId: string;
  planId: string;
  solverStatus: string;
  solverScore: number | null;
  sessions: number;
  instructorAssignments?: number;
  multiInstructorSessions?: number;
  changedSessionCount: number;
  directChangeCount: number;
  cascadingChangeCount: number;
};

function parseJobId() {
  const index = process.argv.indexOf("--job");

  if (index === -1 || !process.argv[index + 1]) {
    throw new Error("Required argument: --job <solver-job-id>");
  }

  return process.argv[index + 1];
}

function asConfig(value: unknown): RecoveryJobConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Solver job config is missing.");
  }

  return value as RecoveryJobConfig;
}

function requireConfig(
  config: RecoveryJobConfig,
  key: keyof RecoveryJobConfig,
) {
  const value = config[key];

  if (typeof value !== "string" || !value) {
    throw new Error(`Solver job config is missing ${key}.`);
  }

  return value;
}

async function runCommand(
  command: string,
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv;
  },
) {
  return await new Promise<{
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options?.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code}.\n` +
            `${stderr || stdout}`,
        ),
      );
    });
  });
}

function runStatus(value: string): SolverRunStatus {
  if (value === "OPTIMAL") return SolverRunStatus.OPTIMAL;
  if (value === "FEASIBLE") return SolverRunStatus.FEASIBLE;
  if (value === "INFEASIBLE") return SolverRunStatus.INFEASIBLE;
  if (value === "UNKNOWN") return SolverRunStatus.UNKNOWN;
  return SolverRunStatus.FAILED;
}

function tail(value: string, length = 6000) {
  return value.length <= length
    ? value
    : value.slice(value.length - length);
}

async function processJob(jobId: string) {
  const job = await prisma.solverJob.findUnique({
    where: {
      id: jobId,
    },
    include: {
      planScenario: {
        include: {
          plan: true,
        },
      },
      runs: {
        orderBy: {
          startedAt: "desc",
        },
        take: 1,
      },
    },
  });

  if (!job) {
    throw new Error(`SolverJob ${jobId} was not found.`);
  }

  if (job.status !== SolverJobStatus.QUEUED) {
    console.log(
      `SolverJob ${job.id} is ${job.status}; nothing to process.`,
    );
    return;
  }

  const config = asConfig(job.config);

  if (config.type !== "RESOURCE_RECOVERY") {
    throw new Error(
      `Unsupported solver job type: ${config.type ?? "missing"}.`,
    );
  }

  const baseScenarioId = requireConfig(config, "baseScenarioId");
  const resourceType = requireConfig(config, "resourceType");
  const resourceId = requireConfig(config, "resourceId");
  const resourceLabel = requireConfig(config, "resourceLabel");
  const startDate = requireConfig(config, "startDate");
  const endDate = requireConfig(config, "endDate");
  const correlationId =
    config.correlationId ?? randomUUID();

  if (
    resourceType !== "INSTRUCTOR_UNAVAILABLE" &&
    resourceType !== "ROOM_UNAVAILABLE"
  ) {
    throw new Error(`Invalid resourceType ${resourceType}.`);
  }

  const inputPath =
    `/tmp/youtileyes_solver_input_${job.id}.json`;
  const reportPath =
    `/tmp/youtileyes_solver_report_${job.id}.json`;

  const startedAt = new Date();

  const run = await prisma.$transaction(async (tx) => {
    const claimed = await tx.solverJob.updateMany({
      where: {
        id: job.id,
        status: SolverJobStatus.QUEUED,
      },
      data: {
        status: SolverJobStatus.RUNNING,
        startedAt,
        failureMessage: null,
      },
    });

    if (claimed.count !== 1) {
      throw new Error(
        `SolverJob ${job.id} could not be claimed atomically.`,
      );
    }

    const createdRun = await tx.solverRun.create({
      data: {
        tenantId: job.tenantId,
        solverJobId: job.id,
        status: SolverRunStatus.STARTED,
        solverName: "OR-Tools CP-SAT",
        solverVersion: "9.15.6755",
        startedAt,
        diagnostics: {
          jobType: config.type,
          baseScenarioId,
          resourceType,
          resourceId,
          resourceLabel,
          startDate,
          endDate,
        },
      },
    });

    await writeAuditEvent(tx, {
      tenantId: job.tenantId,
      eventType: "UPDATED",
      entityType: "SolverJob",
      entityId: job.id,
      description:
        `Solver job started for ${resourceLabel}.`,
      source: "planning.solver-job.worker",
      correlationId,
      planId: job.planScenario.planId,
      scenarioId: baseScenarioId,
      beforeState: {
        status: SolverJobStatus.QUEUED,
      },
      afterState: {
        status: SolverJobStatus.RUNNING,
        runId: createdRun.id,
      },
      context: {
        resourceType,
        resourceId,
        startDate,
        endDate,
      },
    });

    return createdRun;
  });

  let buildStdout = "";
  let recoveryStdout = "";

  try {
    const buildResult = await runCommand(
      "npx",
      [
        "tsx",
        "scripts/build-solver-input.ts",
        "--scenario",
        baseScenarioId,
        "--output",
        inputPath,
      ],
    );

    buildStdout = buildResult.stdout;

    const recoveryResult = await runCommand(
      "npx",
      [
        "tsx",
        "scripts/create-resource-recovery-scenario.ts",
        "--type",
        resourceType,
        "--resource",
        resourceId,
        "--from",
        startDate,
        "--to",
        endDate,
        "--label",
        resourceLabel,
      ],
      {
        env: {
          ...process.env,
          YOUTILEYES_SOLVER_INPUT: inputPath,
          YOUTILEYES_RECOVERY_SCENARIO_REPORT: reportPath,
        },
      },
    );

    recoveryStdout = recoveryResult.stdout;

    const report = JSON.parse(
      await readFile(reportPath, "utf8"),
    ) as RecoveryReport;

    const completedAt = new Date();
    const finalRunStatus = runStatus(report.solverStatus);

    if (
      finalRunStatus !== SolverRunStatus.OPTIMAL &&
      finalRunStatus !== SolverRunStatus.FEASIBLE
    ) {
      throw new Error(
        `Recovery solver finished with ${report.solverStatus}.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.solverRun.update({
        where: {
          id: run.id,
        },
        data: {
          status: finalRunStatus,
          objectiveValue: report.solverScore,
          completedAt,
          diagnostics: {
            jobType: config.type,
            baseScenarioId,
            generatedScenarioId: report.scenarioId,
            resourceType,
            resourceId,
            resourceLabel,
            startDate,
            endDate,
            sessions: report.sessions,
            instructorAssignments:
              report.instructorAssignments ?? null,
            multiInstructorSessions:
              report.multiInstructorSessions ?? null,
            changedSessionCount:
              report.changedSessionCount,
            directChangeCount:
              report.directChangeCount,
            cascadingChangeCount:
              report.cascadingChangeCount,
            buildOutput: tail(buildStdout),
            recoveryOutput: tail(recoveryStdout),
          },
        },
      });

      await tx.solverJob.update({
        where: {
          id: job.id,
        },
        data: {
          planScenarioId: report.scenarioId,
          status: SolverJobStatus.SUCCEEDED,
          completedAt,
          failureMessage: null,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: job.tenantId,
        eventType: "GENERATED",
        entityType: "SolverJob",
        entityId: job.id,
        description:
          `Solver job completed: ${report.scenarioName}, ` +
          `${report.changedSessionCount} change(s).`,
        source: "planning.solver-job.worker",
        correlationId,
        planId: report.planId,
        scenarioId: report.scenarioId,
        beforeState: {
          status: SolverJobStatus.RUNNING,
          baseScenarioId,
        },
        afterState: {
          status: SolverJobStatus.SUCCEEDED,
          generatedScenarioId: report.scenarioId,
          solverStatus: report.solverStatus,
        },
        context: {
          resourceType,
          resourceId,
          resourceLabel,
          startDate,
          endDate,
          sessions: report.sessions,
          changedSessionCount:
            report.changedSessionCount,
          directChangeCount:
            report.directChangeCount,
          cascadingChangeCount:
            report.cascadingChangeCount,
        },
      });
    });

    console.log(
      `SolverJob ${job.id} completed with scenario ${report.scenarioId}.`,
    );
  } catch (error) {
    const completedAt = new Date();
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await prisma.$transaction(async (tx) => {
      await tx.solverRun.update({
        where: {
          id: run.id,
        },
        data: {
          status: SolverRunStatus.FAILED,
          completedAt,
          diagnostics: {
            jobType: config.type,
            baseScenarioId,
            resourceType,
            resourceId,
            resourceLabel,
            startDate,
            endDate,
            error: message,
            buildOutput: tail(buildStdout),
            recoveryOutput: tail(recoveryStdout),
          },
        },
      });

      await tx.solverJob.update({
        where: {
          id: job.id,
        },
        data: {
          status: SolverJobStatus.FAILED,
          completedAt,
          failureMessage: message.slice(0, 4000),
        },
      });

      await writeAuditEvent(tx, {
        tenantId: job.tenantId,
        eventType: "OTHER",
        entityType: "SolverJob",
        entityId: job.id,
        description:
          `Solver job failed for ${resourceLabel}: ${message.slice(0, 500)}.`,
        source: "planning.solver-job.worker",
        correlationId,
        planId: job.planScenario.planId,
        scenarioId: baseScenarioId,
        beforeState: {
          status: SolverJobStatus.RUNNING,
        },
        afterState: {
          status: SolverJobStatus.FAILED,
          failureMessage: message,
        },
        context: {
          resourceType,
          resourceId,
          resourceLabel,
          startDate,
          endDate,
        },
      });
    });

    throw error;
  } finally {
    await Promise.allSettled([
      rm(inputPath, { force: true }),
      rm(reportPath, { force: true }),
    ]);
  }
}

async function main() {
  const jobId = parseJobId();
  await processJob(jobId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
