import "dotenv/config";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  PlanStatus,
  Prisma,
  ScenarioStatus,
  SolverJobStatus,
  SolverRunStatus,
  StaffingRoleType,
} from "../src/generated/prisma/client";

import { writeAuditEvent } from "../src/lib/audit";
import { prisma } from "../src/lib/prisma";

class SolverJobCancelledError extends Error {
  constructor(message = "Solver job cancelled by user.") {
    super(message);
    this.name = "SolverJobCancelledError";
  }
}

type JobProgress = {
  phase?: string;
  phaseLabel?: string;
  percent?: number;
  currentWeek?: number;
  totalWeeks?: number | null;
  weekStartDate?: string | null;
  message?: string;
  candidateCount?: number;
  selectorCount?: number;
  candidateSeconds?: number;
  modelSeconds?: number;
  instructorTravelConstraints?: number;
  studentBreakConstraints?: number;
  updatedAt?: string;
  weekStartedAt?: string;
  recentWeekDurationsSeconds?: number[];
  estimatedRemainingSeconds?: number | null;
  estimatedCompletionAt?: string | null;
};

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
  progress?: JobProgress;
};

type BasePlanJobConfig = RecoveryJobConfig & {
  planVersion?: number;
  scenarioId?: string;
  inputFingerprint?: string;
};

type SolverSession = {
  teaching_group_id: string;
  start_minute: number;
  end_minute: number;
  instructor_id: string;
  room_id: string;
  date: string | null;
  occurrence_id?: string | null;
  instructor_ids?: string[];
  staffing_assignments?: Array<{
    role: string;
    instructor_id: string;
  }>;
};

type SolverOutput = {
  schema_version: string;
  tenant_id: string;
  plan_scenario_id: string;
  status: string;
  objective_value: number | null;
  sessions: SolverSession[];
  metrics?: Array<{
    key: string;
    value: number;
    unit?: string | null;
  }>;
  diagnostics?: Record<string, unknown>;
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
  config: object,
  key: string,
) {
  const value = (config as Record<string, unknown>)[key];

  if (typeof value !== "string" || !value) {
    throw new Error(`Solver job config is missing ${key}.`);
  }

  return value;
}

type CgroupMemorySnapshot = {
  current: string | null;
  max: string | null;
  peak: string | null;
  events: Record<string, number>;
};

async function readCgroupMemorySnapshot(): Promise<CgroupMemorySnapshot> {
  async function readValue(filePath: string): Promise<string | null> {
    try {
      return (await readFile(filePath, "utf8")).trim();
    } catch {
      return null;
    }
  }

  const [current, max, peak, eventsText] = await Promise.all([
    readValue("/sys/fs/cgroup/memory.current"),
    readValue("/sys/fs/cgroup/memory.max"),
    readValue("/sys/fs/cgroup/memory.peak"),
    readValue("/sys/fs/cgroup/memory.events"),
  ]);

  const events: Record<string, number> = {};

  if (eventsText) {
    for (const line of eventsText.split(/\r?\n/)) {
      const [name, rawValue] = line.trim().split(/\s+/, 2);
      const value = Number(rawValue);

      if (name && Number.isFinite(value)) {
        events[name] = value;
      }
    }
  }

  return {
    current,
    max,
    peak,
    events,
  };
}

function cgroupMemoryDiagnostics(
  before: CgroupMemorySnapshot,
  after: CgroupMemorySnapshot,
) {
  const eventNames = new Set([
    ...Object.keys(before.events),
    ...Object.keys(after.events),
  ]);

  const eventDelta = Object.fromEntries(
    [...eventNames]
      .map((name) => [
        name,
        (after.events[name] ?? 0) - (before.events[name] ?? 0),
      ])
      .filter(([, delta]) => delta !== 0),
  );

  return {
    before,
    after,
    eventDelta,
  };
}

async function runCommand(
  command: string,
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv;
    onStdoutLine?: (line: string) => void | Promise<void>;
    shouldCancel?: () => boolean | Promise<boolean>;
  },
) {
  const cgroupMemoryBefore = await readCgroupMemorySnapshot();

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
    let stdoutBuffer = "";
    let lineWork = Promise.resolve();
    let cancellationRequested = false;
    let cancellationCheckInFlight = false;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const cancellationTimer = options?.shouldCancel
      ? setInterval(() => {
          if (cancellationRequested || cancellationCheckInFlight) return;

          cancellationCheckInFlight = true;

          void Promise.resolve(options.shouldCancel?.())
            .then((shouldCancel) => {
              if (!shouldCancel || cancellationRequested) return;

              cancellationRequested = true;

              console.log(
                `[solver-worker] Cancellation requested; sending SIGTERM to ${command}.`,
              );

              child.kill("SIGTERM");

              forceKillTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                  console.warn(
                    `[solver-worker] ${command} did not stop after SIGTERM; sending SIGKILL.`,
                  );
                  child.kill("SIGKILL");
                }
              }, 5_000);
            })
            .catch((error) => {
              console.error(
                "[solver-worker] Could not check solver cancellation state.",
                error,
              );
            })
            .finally(() => {
              cancellationCheckInFlight = false;
            });
        }, 5_000)
      : null;

    const clearCancellationTimers = () => {
      if (cancellationTimer) {
        clearInterval(cancellationTimer);
      }

      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;

      if (!options?.onStdoutLine) return;

      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        lineWork = lineWork.then(async () => {
          await options.onStdoutLine?.(line);
        });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearCancellationTimers();
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearCancellationTimers();

      void (async () => {
        if (options?.onStdoutLine && stdoutBuffer) {
          await lineWork;
          await options.onStdoutLine(stdoutBuffer);
        } else {
          await lineWork;
        }

        if (cancellationRequested) {
          reject(
            new SolverJobCancelledError(
              "Solver job cancelled by user while optimization was running.",
            ),
          );
          return;
        }

        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        let signalDiagnostics = "";

        if (signal) {
          const cgroupMemoryAfter = await readCgroupMemorySnapshot();
          signalDiagnostics =
            `\nCGROUP_MEMORY_DIAGNOSTICS ` +
            JSON.stringify(
              cgroupMemoryDiagnostics(
                cgroupMemoryBefore,
                cgroupMemoryAfter,
              ),
            );
        }

        reject(
          new Error(
            `${command} ${args.join(" ")} failed with ` +
              (signal
                ? `signal ${signal}`
                : `exit code ${code}`) +
              `.\n${stderr || stdout}` +
              signalDiagnostics,
          ),
        );
      })().catch(reject);
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

async function cancellationRequested(
  jobId: string,
): Promise<boolean> {
  const state = await prisma.solverJob.findUnique({
    where: {
      id: jobId,
    },
    select: {
      status: true,
      cancelRequestedAt: true,
    },
  });

  return (
    state?.status === SolverJobStatus.CANCELLED ||
    state?.cancelRequestedAt != null
  );
}

async function throwIfCancellationRequested(
  jobId: string,
): Promise<void> {
  if (await cancellationRequested(jobId)) {
    throw new SolverJobCancelledError();
  }
}

function tail(value: string, length = 6000) {
  return value.length <= length
    ? value
    : value.slice(value.length - length);
}


function dateValue(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function staffingRole(value: string): StaffingRoleType {
  if (
    value === StaffingRoleType.LEAD ||
    value === StaffingRoleType.ASSISTANT ||
    value === StaffingRoleType.SUPPORT ||
    value === StaffingRoleType.OTHER
  ) {
    return value;
  }

  return StaffingRoleType.OTHER;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const left = sorted[middle - 1];
  const right = sorted[middle];

  if (left === undefined || right === undefined) {
    return null;
  }

  return (left + right) / 2;
}

function etaProgress(
  previous: JobProgress,
  patch: JobProgress,
  now: Date,
): Partial<JobProgress> {
  if (patch.phase === "PERSISTING") {
    return {
      estimatedRemainingSeconds: null,
      estimatedCompletionAt: null,
    };
  }

  const currentWeek =
    patch.currentWeek ?? previous.currentWeek ?? null;
  const totalWeeks =
    patch.totalWeeks ?? previous.totalWeeks ?? null;

  if (!currentWeek || !totalWeeks) {
    return {};
  }

  let weekStartedAt = previous.weekStartedAt;
  let durations = [
    ...(previous.recentWeekDurationsSeconds ?? []),
  ];

  const previousWeek = previous.currentWeek ?? null;

  if (
    previousWeek !== null &&
    currentWeek > previousWeek &&
    previous.weekStartedAt
  ) {
    const startedAtMs = Date.parse(previous.weekStartedAt);

    if (Number.isFinite(startedAtMs)) {
      const durationSeconds = Math.max(
        1,
        Math.round((now.getTime() - startedAtMs) / 1000),
      );

      durations = [...durations, durationSeconds].slice(-5);
    }

    weekStartedAt = now.toISOString();
  } else if (!weekStartedAt) {
    weekStartedAt = now.toISOString();
  }

  if (durations.length < 2) {
    return {
      weekStartedAt,
      recentWeekDurationsSeconds: durations,
      estimatedRemainingSeconds: null,
      estimatedCompletionAt: null,
    };
  }

  const typicalWeekSeconds = median(durations);

  if (typicalWeekSeconds === null) {
    return {
      weekStartedAt,
      recentWeekDurationsSeconds: durations,
    };
  }

  const currentWeekStartedMs = Date.parse(weekStartedAt);
  const currentWeekElapsedSeconds = Number.isFinite(
    currentWeekStartedMs,
  )
    ? Math.max(
        0,
        Math.round(
          (now.getTime() - currentWeekStartedMs) / 1000,
        ),
      )
    : 0;

  const currentWeekRemainingSeconds = Math.max(
    0,
    typicalWeekSeconds - currentWeekElapsedSeconds,
  );

  const fullWeeksRemaining = Math.max(
    0,
    totalWeeks - currentWeek,
  );

  const estimatedRemainingSeconds = Math.round(
    currentWeekRemainingSeconds +
      fullWeeksRemaining * typicalWeekSeconds,
  );

  return {
    weekStartedAt,
    recentWeekDurationsSeconds: durations,
    estimatedRemainingSeconds,
    estimatedCompletionAt: new Date(
      now.getTime() + estimatedRemainingSeconds * 1000,
    ).toISOString(),
  };
}

function progressRecord(value: unknown): JobProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JobProgress;
}

async function ensureReviewWorkflow(
  tx: Prisma.TransactionClient,
  plan: {
    id: string;
    tenantId: string;
    planningScopeId: string;
    version: number;
  },
) {
  const existing = await tx.planReviewWorkflow.findFirst({
    where: {
      tenantId: plan.tenantId,
      planId: plan.id,
    },
  });

  if (existing) return existing;

  const templatePlan = await tx.plan.findFirst({
    where: {
      tenantId: plan.tenantId,
      planningScopeId: plan.planningScopeId,
      id: {
        not: plan.id,
      },
      reviewWorkflows: {
        some: {},
      },
    },
    orderBy: {
      version: "desc",
    },
    include: {
      reviewWorkflows: {
        include: {
          steps: {
            orderBy: [
              { stage: "asc" },
              { position: "asc" },
            ],
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 1,
      },
    },
  });

  const template = templatePlan?.reviewWorkflows[0];

  if (!template) {
    throw new Error(
      `No review workflow template exists for planning scope. ` +
        `Cannot prepare Base Plan v${plan.version} for controlled review.`,
    );
  }

  return tx.planReviewWorkflow.create({
    data: {
      tenantId: plan.tenantId,
      planId: plan.id,
      name: template.name,
      status: "DRAFT",
      steps: {
        create: template.steps.map((step) => ({
          tenantId: plan.tenantId,
          stage: step.stage,
          position: step.position,
          name: step.name,
          reviewerRole: step.reviewerRole,
          reviewerId: step.reviewerId,
          reviewerName: null,
          required: step.required,
          status: "PENDING",
        })),
      },
    },
  });
}

async function processBasePlanJob(jobId: string) {
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

  const config = asConfig(job.config) as BasePlanJobConfig;
  const plan = job.planScenario.plan;
  const scenario = job.planScenario;
  const correlationId = config.correlationId ?? randomUUID();
  const inputFingerprint = requireConfig(
    config,
    "inputFingerprint",
  );
  const startedAt = new Date();
  const inputPath = `/tmp/youtileyes_base_plan_input_${job.id}.json`;
  const outputPath = `/tmp/youtileyes_base_plan_output_${job.id}.json`;

  let currentConfig: BasePlanJobConfig = {
    ...config,
  };

  const updateProgress = async (
    patch: JobProgress,
  ) => {
    const previous = progressRecord(currentConfig.progress);
    const now = new Date();
    const eta = etaProgress(previous, patch, now);

    const progress: JobProgress = {
      ...previous,
      ...patch,
      ...eta,
      updatedAt: now.toISOString(),
    };

    currentConfig = {
      ...currentConfig,
      progress,
    };

    await prisma.solverJob.update({
      where: {
        id: job.id,
      },
      data: {
        heartbeatAt: new Date(),
        config: JSON.parse(
          JSON.stringify(currentConfig),
        ) as Prisma.InputJsonValue,
      },
    });
  };

  const run = await prisma.$transaction(async (tx) => {
    const claimed = await tx.solverJob.updateMany({
      where: {
        id: job.id,
        status: SolverJobStatus.QUEUED,
      },
      data: {
        status: SolverJobStatus.RUNNING,
        startedAt,
        heartbeatAt: startedAt,
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
          jobType: "BASE_PLAN",
          planId: plan.id,
          planVersion: plan.version,
          scenarioId: scenario.id,
          inputFingerprint,
        },
      },
    });

    await writeAuditEvent(tx, {
      tenantId: job.tenantId,
      eventType: "UPDATED",
      entityType: "SolverJob",
      entityId: job.id,
      description:
        `Base Plan solver job started for v${plan.version}.`,
      source: "planning.base-plan.worker",
      correlationId,
      planId: plan.id,
      scenarioId: scenario.id,
      beforeState: {
        status: SolverJobStatus.QUEUED,
      },
      afterState: {
        status: SolverJobStatus.RUNNING,
        runId: createdRun.id,
      },
    });

    return createdRun;
  });

  let buildStdout = "";
  let solverStdout = "";

  try {
    await updateProgress({
      phase: "BUILDING_INPUT",
      phaseLabel: "Building input",
      percent: 1,
      currentWeek: 0,
      totalWeeks: null,
      weekStartDate: null,
      message:
        `Preparing solver input for Base Plan v${plan.version}.`,
    });

    const buildResult = await runCommand(
      "npx",
      [
        "tsx",
        "scripts/build-solver-input.ts",
        "--scenario",
        scenario.id,
        "--output",
        inputPath,
      ],
      {
        shouldCancel: () => cancellationRequested(job.id),
      },
    );

    buildStdout = buildResult.stdout;

    await throwIfCancellationRequested(job.id);

    await updateProgress({
      phase: "SOLVING",
      phaseLabel: "Optimizing",
      percent: 3,
      message:
        "Solver input ready. Starting timetable optimization.",
    });

    const python = existsSync("solver/.venv/bin/python")
      ? "solver/.venv/bin/python"
      : "python3";

    const solverResult = await runCommand(
      python,
      [
        "-m",
        "solver.src.cli",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--progress",
      ],
      {
        shouldCancel: () => cancellationRequested(job.id),
        onStdoutLine: async (line) => {
          const prefix = "YOUTILEYES_PROGRESS ";

          if (!line.startsWith(prefix)) return;

          try {
            const event = JSON.parse(
              line.slice(prefix.length),
            ) as JobProgress;

            await updateProgress(event);
          } catch (error) {
            console.warn(
              `Could not parse solver progress line: ${line}`,
              error,
            );
          }
        },
      },
    );

    solverStdout = solverResult.stdout;

    await throwIfCancellationRequested(job.id);

    const output = JSON.parse(
      await readFile(outputPath, "utf8"),
    ) as SolverOutput;

    if (output.plan_scenario_id !== scenario.id) {
      throw new Error(
        "Solver output belongs to a different PlanScenario.",
      );
    }

    if (output.tenant_id !== plan.tenantId) {
      throw new Error(
        "Solver output belongs to a different tenant.",
      );
    }

    const finalRunStatus = runStatus(output.status);

    if (
      finalRunStatus !== SolverRunStatus.OPTIMAL &&
      finalRunStatus !== SolverRunStatus.FEASIBLE
    ) {
      throw new Error(
        `Base Plan solver finished with ${output.status}.`,
      );
    }

    await throwIfCancellationRequested(job.id);

    await updateProgress({
      phase: "PERSISTING",
      phaseLabel: "Saving proposal",
      percent: 97,
      message:
        `Saving ${output.sessions.length} generated sessions.`,
    });

    const groupIds = [
      ...new Set(
        output.sessions.map(
          (session) => session.teaching_group_id,
        ),
      ),
    ];

    const groups = await prisma.teachingGroup.findMany({
      where: {
        tenantId: plan.tenantId,
        id: {
          in: groupIds,
        },
      },
      include: {
        students: {
          select: {
            studentId: true,
          },
        },
      },
    });

    const groupsById = new Map(
      groups.map((group) => [group.id, group]),
    );

    const solverCompletedAt = new Date();

    const preparedSessions = output.sessions.map((item) => {
      const group = groupsById.get(
        item.teaching_group_id,
      );

      if (!group) {
        throw new Error(
          `Solver returned unknown teaching group ${item.teaching_group_id}.`,
        );
      }

      if (!item.date) {
        throw new Error(
          "Planning-horizon solver returned a session without a date.",
        );
      }

      const assignments =
        item.staffing_assignments &&
        item.staffing_assignments.length > 0
          ? item.staffing_assignments
          : (
              item.instructor_ids &&
              item.instructor_ids.length > 0
                ? item.instructor_ids
                : [item.instructor_id]
            ).map((instructorId, index) => ({
              instructor_id: instructorId,
              role:
                index === 0
                  ? StaffingRoleType.LEAD
                  : StaffingRoleType.ASSISTANT,
            }));

      const uniqueAssignments = [
        ...new Map(
          assignments.map((assignment) => [
            assignment.instructor_id,
            assignment,
          ]),
        ).values(),
      ];

      return {
        item,
        group,
        uniqueAssignments,
      };
    });

    // A retried job must not duplicate partially persisted sessions.
    // Keep this separate from the bulk inserts so no interactive
    // transaction needs to remain open for the whole result set.
    await throwIfCancellationRequested(job.id);

    await prisma.scenarioSession.deleteMany({
      where: {
        tenantId: plan.tenantId,
        planScenarioId: scenario.id,
      },
    });

    const sessionChunkSize = 50;

    for (
      let offset = 0;
      offset < preparedSessions.length;
      offset += sessionChunkSize
    ) {
      await throwIfCancellationRequested(job.id);

      const chunk = preparedSessions.slice(
        offset,
        offset + sessionChunkSize,
      );

      await prisma.$transaction(
        async (tx) => {
          for (const {
            item,
            group,
            uniqueAssignments,
          } of chunk) {
            await tx.scenarioSession.create({
              data: {
                tenantId: plan.tenantId,
                planScenarioId: scenario.id,
                teachingGroupId:
                  item.teaching_group_id,
                roomId: item.room_id,
                date: dateValue(item.date!),
                startMinute: item.start_minute,
                endMinute: item.end_minute,
                origin: "GENERATED",
                instructors: {
                  create: uniqueAssignments.map(
                    (assignment) => ({
                      tenantId: plan.tenantId,
                      instructorId:
                        assignment.instructor_id,
                      role: staffingRole(
                        assignment.role,
                      ),
                    }),
                  ),
                },
                students: {
                  create: group.students.map(
                    (student) => ({
                      tenantId: plan.tenantId,
                      studentId: student.studentId,
                    }),
                  ),
                },
              },
            });
          }
        },
        {
          maxWait: 10_000,
          timeout: 120_000,
        },
      );
    }

    await throwIfCancellationRequested(job.id);

    await prisma.$transaction(
      async (tx) => {
        const afterScenario =
          await tx.planScenario.update({
            where: {
              id: scenario.id,
            },
            data: {
              status: ScenarioStatus.GENERATED,
              solverScore: output.objective_value,
              objectiveSummary: {
                solverStatus: output.status,
                schemaVersion: output.schema_version,
                metrics: output.metrics ?? [],
                diagnostics: JSON.parse(
                  JSON.stringify(
                    output.diagnostics ?? {},
                  ),
                ) as Prisma.InputJsonValue,
                inputFingerprint,
              } satisfies Prisma.InputJsonValue,
              generatedAt: solverCompletedAt,
              failureMessage: null,
            },
          });

        await tx.plan.update({
          where: {
            id: plan.id,
          },
          data: {
            status: PlanStatus.GENERATED,
          },
        });

        await ensureReviewWorkflow(tx, {
          id: plan.id,
          tenantId: plan.tenantId,
          planningScopeId: plan.planningScopeId,
          version: plan.version,
        });

        await tx.solverRun.update({
          where: {
            id: run.id,
          },
          data: {
            status: finalRunStatus,
            objectiveValue: output.objective_value,
            completedAt: solverCompletedAt,
            wallTimeSeconds:
              (solverCompletedAt.getTime() -
                startedAt.getTime()) /
              1000,
            diagnostics: {
              jobType: "BASE_PLAN",
              planId: plan.id,
              planVersion: plan.version,
              scenarioId: scenario.id,
              sessionCount: output.sessions.length,
              solverStatus: output.status,
              buildOutput: tail(buildStdout),
              solverOutput: tail(solverStdout),
            },
          },
        });

        await writeAuditEvent(tx, {
          tenantId: plan.tenantId,
          eventType: "GENERATED",
          entityType: "PlanScenario",
          entityId: scenario.id,
          description:
            `Base Plan proposal generated for v${plan.version}: ` +
            `${output.sessions.length} session(s), solver ${output.status}.`,
          source: "planning.base-plan.worker",
          correlationId,
          planId: plan.id,
          scenarioId: scenario.id,
          beforeState: {
            status: ScenarioStatus.GENERATING,
          },
          afterState: {
            status: afterScenario.status,
            solverStatus: output.status,
            solverScore: output.objective_value,
            sessionCount: output.sessions.length,
            inputFingerprint,
          },
        });
      },
      {
        maxWait: 10_000,
        timeout: 120_000,
      },
    );

    await updateProgress({
      phase: "COMPLETED",
      phaseLabel: "Completed",
      percent: 100,
      message:
        `Proposal ready with ${output.sessions.length} sessions.`,
    });

    const jobCompletedAt = new Date();

    await prisma.solverJob.update({
      where: {
        id: job.id,
      },
      data: {
        status: SolverJobStatus.SUCCEEDED,
        completedAt: jobCompletedAt,
        failureMessage: null,
      },
    });

    await prisma.$transaction(async (tx) => {
      await writeAuditEvent(tx, {
        tenantId: plan.tenantId,
        eventType: "GENERATED",
        entityType: "SolverJob",
        entityId: job.id,
        description:
          `Base Plan solver job completed for v${plan.version}.`,
        source: "planning.base-plan.worker",
        correlationId,
        planId: plan.id,
        scenarioId: scenario.id,
        beforeState: {
          status: SolverJobStatus.RUNNING,
        },
        afterState: {
          status: SolverJobStatus.SUCCEEDED,
          solverStatus: output.status,
          sessionCount: output.sessions.length,
        },
      });
    });

    console.log(
      `Base Plan SolverJob ${job.id} completed for scenario ${scenario.id}.`,
    );
  } catch (error) {
    const completedAt = new Date();
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    if (error instanceof SolverJobCancelledError) {
      // Persistence is chunked, so cancellation may happen after some
      // ScenarioSession rows have already been written. Remove them before
      // marking the proposal as cancelled.
      await prisma.scenarioSession.deleteMany({
        where: {
          tenantId: plan.tenantId,
          planScenarioId: scenario.id,
        },
      });

      try {
        await updateProgress({
          phase: "CANCELLED",
          phaseLabel: "Cancelled",
          message: message.slice(0, 1000),
        });
      } catch (progressError) {
        console.error(
          "Could not persist cancellation progress.",
          progressError,
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.solverRun.update({
          where: {
            id: run.id,
          },
          data: {
            status: SolverRunStatus.CANCELLED,
            completedAt,
            wallTimeSeconds:
              (completedAt.getTime() - startedAt.getTime()) / 1000,
            diagnostics: {
              jobType: "BASE_PLAN",
              planId: plan.id,
              planVersion: plan.version,
              scenarioId: scenario.id,
              cancellation: true,
              message,
              buildOutput: tail(buildStdout),
              solverOutput: tail(solverStdout),
            },
          },
        });

        await tx.planScenario.update({
          where: {
            id: scenario.id,
          },
          data: {
            status: ScenarioStatus.CANCELLED,
            failureMessage: null,
            generatedAt: completedAt,
          },
        });

        await tx.solverJob.update({
          where: {
            id: job.id,
          },
          data: {
            status: SolverJobStatus.CANCELLED,
            completedAt,
            failureMessage: null,
          },
        });

        await writeAuditEvent(tx, {
          tenantId: plan.tenantId,
          eventType: "UPDATED",
          entityType: "SolverJob",
          entityId: job.id,
          description:
            `Base Plan solver job cancelled for v${plan.version}.`,
          source: "planning.base-plan.worker",
          correlationId,
          planId: plan.id,
          scenarioId: scenario.id,
          beforeState: {
            status: SolverJobStatus.RUNNING,
          },
          afterState: {
            status: SolverJobStatus.CANCELLED,
          },
        });
      });

      console.log(
        `Base Plan SolverJob ${job.id} cancelled for scenario ${scenario.id}.`,
      );

      return;
    }

    try {
      await updateProgress({
        phase: "FAILED",
        phaseLabel: "Failed",
        message: message.slice(0, 1000),
      });
    } catch (progressError) {
      console.error(
        "Could not persist failure progress.",
        progressError,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.solverRun.update({
        where: {
          id: run.id,
        },
        data: {
          status: SolverRunStatus.FAILED,
          completedAt,
          wallTimeSeconds:
            (completedAt.getTime() - startedAt.getTime()) / 1000,
          diagnostics: {
            jobType: "BASE_PLAN",
            planId: plan.id,
            planVersion: plan.version,
            scenarioId: scenario.id,
            error: message,
            buildOutput: tail(buildStdout),
            solverOutput: tail(solverStdout),
          },
        },
      });

      await tx.planScenario.update({
        where: {
          id: scenario.id,
        },
        data: {
          status: ScenarioStatus.FAILED,
          failureMessage: message.slice(0, 4000),
          generatedAt: completedAt,
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
        tenantId: plan.tenantId,
        eventType: "OTHER",
        entityType: "SolverJob",
        entityId: job.id,
        description:
          `Base Plan solver job failed for v${plan.version}: ` +
          `${message.slice(0, 500)}.`,
        source: "planning.base-plan.worker",
        correlationId,
        planId: plan.id,
        scenarioId: scenario.id,
        beforeState: {
          status: SolverJobStatus.RUNNING,
        },
        afterState: {
          status: SolverJobStatus.FAILED,
          failureMessage: message,
        },
      });
    });

    throw error;
  } finally {
    await Promise.allSettled([
      rm(inputPath, { force: true }),
      rm(outputPath, { force: true }),
    ]);
  }
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

  if (config.type === "BASE_PLAN") {
    await processBasePlanJob(job.id);
    return;
  }

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
        heartbeatAt: startedAt,
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
