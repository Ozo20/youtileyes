import "dotenv/config";

import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  RecoveryCaseStatus,
  SolverJobStatus,
  SolverRunStatus,
} from "../src/generated/prisma/client";

import { writeAuditEvent } from "../src/lib/audit";
import { prisma } from "../src/lib/prisma";

type JobConfig = {
  type?: string;
  recoveryCaseId?: string;
  caseVersion?: number;
  baseScenarioId?: string;
  correlationId?: string;
};

function parseJobId() {
  const index = process.argv.indexOf("--job");
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error("Required argument: --job <solver-job-id>");
  }
  return process.argv[index + 1];
}

function asConfig(value: unknown): JobConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Solver job config is missing.");
  }
  return value as JobConfig;
}

async function runCommand(command: string, args: string[]) {
  return await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(
          new Error(
            `${command} ${args.join(" ")} failed with exit code ${code}.\n${stderr || stdout}`,
          ),
        );
      });
    },
  );
}

function runStatus(value: string): SolverRunStatus {
  if (value === "OPTIMAL") return SolverRunStatus.OPTIMAL;
  if (value === "FEASIBLE") return SolverRunStatus.FEASIBLE;
  if (value === "INFEASIBLE") return SolverRunStatus.INFEASIBLE;
  return SolverRunStatus.FAILED;
}


function recoveryFailureDetails(message: string) {
  const jsonMatch = message.match(
    /\{"status"\s*:\s*"FAILED"\s*,\s*"error"\s*:\s*"([^"]+)"\}/,
  );
  const solverError = jsonMatch?.[1] ?? message;

  const candidateMatch = solverError.match(
    /No valid candidates for occurrence ([^\s]+) \(teaching group ([^)]+)\)/,
  );

  if (candidateMatch) {
    return {
      userMessage:
        "No feasible timetable was found because one required teaching session has no valid remaining candidate.",
      reasonCode: "NO_VALID_CANDIDATES",
      occurrenceId: candidateMatch[1],
      teachingGroupId: candidateMatch[2],
      solverError,
    };
  }

  if (/INFEASIBLE/i.test(solverError)) {
    return {
      userMessage:
        "No feasible timetable was found with all active disruptions applied together.",
      reasonCode: "INFEASIBLE",
      occurrenceId: null,
      teachingGroupId: null,
      solverError,
    };
  }

  return {
    userMessage:
      "The recovery solver could not generate a proposal. Review the disruptions and try again.",
    reasonCode: "SOLVER_FAILED",
    occurrenceId: null,
    teachingGroupId: null,
    solverError,
  };
}

async function main() {
  const jobId = parseJobId();
  const job = await prisma.solverJob.findUnique({
    where: { id: jobId },
    include: {
      recoveryCase: {
        include: {
          disruptions: { where: { active: true } },
          baseScenario: true,
        },
      },
    },
  });
  if (!job) throw new Error("Solver job not found.");
  if (!job.recoveryCase) throw new Error("Solver job has no recovery case.");
  if (job.status !== SolverJobStatus.QUEUED) return;

  const config = asConfig(job.config);
  if (config.type !== "RECOVERY_CASE") {
    throw new Error("Unsupported job type.");
  }
  const recoveryCase = job.recoveryCase;
  const correlationId = config.correlationId ?? randomUUID();

  if (config.caseVersion !== recoveryCase.version) {
    await prisma.solverJob.update({
      where: { id: job.id },
      data: {
        status: SolverJobStatus.CANCELLED,
        completedAt: new Date(),
        failureMessage:
          "Recovery case changed after this job was queued. Recalculation is required.",
      },
    });
    return;
  }

  const inputPath = `/tmp/youtileyes_case_input_${job.id}.json`;
  const reportPath = `/tmp/youtileyes_case_report_${job.id}.json`;
  const startedAt = new Date();

  const run = await prisma.$transaction(async (tx) => {
    const claimed = await tx.solverJob.updateMany({
      where: { id: job.id, status: SolverJobStatus.QUEUED },
      data: {
        status: SolverJobStatus.RUNNING,
        startedAt,
        heartbeatAt: startedAt,
        failureMessage: null,
      },
    });
    if (claimed.count !== 1) throw new Error("Job could not be claimed.");

    const createdRun = await tx.solverRun.create({
      data: {
        tenantId: job.tenantId,
        solverJobId: job.id,
        status: SolverRunStatus.STARTED,
        solverName: "OR-Tools CP-SAT",
        solverVersion: "9.15.6755",
        startedAt,
        diagnostics: {
          recoveryCaseId: recoveryCase.id,
          caseVersion: recoveryCase.version,
          disruptionCount: recoveryCase.disruptions.length,
        },
      },
    });

    await writeAuditEvent(tx, {
      tenantId: job.tenantId,
      eventType: "UPDATED",
      entityType: "SolverJob",
      entityId: job.id,
      description: `Recovery case solver started with ${recoveryCase.disruptions.length} disruption(s).`,
      source: "planning.recovery-case.worker",
      correlationId,
      planId: recoveryCase.planId,
      scenarioId: recoveryCase.baseScenarioId,
      beforeState: { status: "QUEUED" },
      afterState: { status: "RUNNING", runId: createdRun.id },
    });

    return createdRun;
  });

  try {
    await runCommand("npx", [
      "tsx",
      "scripts/build-solver-input.ts",
      "--scenario",
      recoveryCase.baseScenarioId,
      "--output",
      inputPath,
    ]);

    const result = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          "npx",
          [
            "tsx",
            "scripts/create-recovery-case-scenario.ts",
            "--case",
            recoveryCase.id,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              YOUTILEYES_SOLVER_INPUT: inputPath,
              YOUTILEYES_RECOVERY_SCENARIO_REPORT: reportPath,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) resolve({ stdout, stderr });
          else reject(new Error(stderr || stdout));
        });
      },
    );

    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      scenarioId: string;
      scenarioName: string;
      solverStatus: string;
      solverScore: number | null;
      changedSessionCount: number;
      directChangeCount: number;
      cascadingChangeCount: number;
      disruptionCount: number;
    };
    const completedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.solverRun.update({
        where: { id: run.id },
        data: {
          status: runStatus(report.solverStatus),
          objectiveValue: report.solverScore,
          completedAt,
          diagnostics: {
            recoveryCaseId: recoveryCase.id,
            caseVersion: recoveryCase.version,
            generatedScenarioId: report.scenarioId,
            disruptionCount: report.disruptionCount,
            changedSessionCount: report.changedSessionCount,
            directChangeCount: report.directChangeCount,
            cascadingChangeCount: report.cascadingChangeCount,
            output: result.stdout.slice(-6000),
          },
        },
      });

      await tx.solverJob.update({
        where: { id: job.id },
        data: {
          planScenarioId: report.scenarioId,
          status: SolverJobStatus.SUCCEEDED,
          completedAt,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: job.tenantId,
        eventType: "GENERATED",
        entityType: "SolverJob",
        entityId: job.id,
        description: `Recovery case completed: ${report.scenarioName}.`,
        source: "planning.recovery-case.worker",
        correlationId,
        planId: recoveryCase.planId,
        scenarioId: report.scenarioId,
        beforeState: { status: "RUNNING" },
        afterState: {
          status: "SUCCEEDED",
          generatedScenarioId: report.scenarioId,
        },
      });
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    const failure = recoveryFailureDetails(message);
    const completedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.solverRun.update({
        where: { id: run.id },
        data: {
          status: SolverRunStatus.FAILED,
          completedAt,
          diagnostics: {
            error: message,
            solverError: failure.solverError,
            reasonCode: failure.reasonCode,
            occurrenceId: failure.occurrenceId,
            teachingGroupId: failure.teachingGroupId,
            recoveryCaseId: recoveryCase.id,
            caseVersion: recoveryCase.version,
            disruptionCount: recoveryCase.disruptions.length,
          },
        },
      });

      await tx.solverJob.update({
        where: { id: job.id },
        data: {
          status: SolverJobStatus.FAILED,
          completedAt,
          failureMessage: failure.userMessage,
        },
      });

      await tx.recoveryCase.update({
        where: { id: recoveryCase.id },
        data: { status: RecoveryCaseStatus.OPEN },
      });

      await writeAuditEvent(tx, {
        tenantId: job.tenantId,
        eventType: "OTHER",
        entityType: "SolverJob",
        entityId: job.id,
        description: `Recovery proposal could not be generated: ${failure.userMessage}`,
        source: "planning.recovery-case.worker",
        correlationId,
        planId: recoveryCase.planId,
        scenarioId: recoveryCase.baseScenarioId,
        beforeState: { status: "RUNNING" },
        afterState: {
          status: "FAILED",
          reasonCode: failure.reasonCode,
          occurrenceId: failure.occurrenceId,
          teachingGroupId: failure.teachingGroupId,
        },
        context: {
          recoveryCaseId: recoveryCase.id,
          caseVersion: recoveryCase.version,
          disruptionCount: recoveryCase.disruptions.length,
          solverError: failure.solverError,
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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
