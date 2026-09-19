import {
  CheckCircle2,
  Clock3,
  RotateCw,
  TriangleAlert,
} from "lucide-react";

import { SolverJobAutoRefresh } from "@/components/planning/solver-job-auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { cancelBasePlanSolverJob } from "@/lib/planning/base-plan-solver-actions";

type Job = {
  id: string;
  status: string;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  failureMessage: string | null;
  config: unknown;
  planScenario: {
    id: string;
    name: string;
  };
};

type Progress = {
  phase: string | null;
  phaseLabel: string | null;
  percent: number | null;
  currentWeek: number | null;
  totalWeeks: number | null;
  weekStartDate: string | null;
  message: string | null;
  candidateCount: number | null;
  candidateSeconds: number | null;
  modelSeconds: number | null;
  updatedAt: string | null;
};

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function progressFromConfig(value: unknown): Progress {
  const progress = record(record(value)?.progress);

  return {
    phase: text(progress?.phase),
    phaseLabel: text(progress?.phaseLabel),
    percent: number(progress?.percent),
    currentWeek: number(progress?.currentWeek),
    totalWeeks: number(progress?.totalWeeks),
    weekStartDate: text(progress?.weekStartDate),
    message: text(progress?.message),
    candidateCount: number(progress?.candidateCount),
    candidateSeconds: number(progress?.candidateSeconds),
    modelSeconds: number(progress?.modelSeconds),
    updatedAt: text(progress?.updatedAt),
  };
}

function tone(status: string) {
  if (status === "SUCCEEDED") return "success" as const;
  if (status === "FAILED" || status === "CANCELLED") {
    return "danger" as const;
  }
  if (status === "RUNNING") return "warning" as const;
  return "info" as const;
}

export function BasePlanGenerationStatus({
  job,
}: {
  job: Job | null;
}) {
  if (!job) return null;

  const active =
    job.status === "QUEUED" || job.status === "RUNNING";

  const cancelling =
    job.status === "RUNNING" &&
    job.cancelRequestedAt !== null;
  const progress = progressFromConfig(job.config);
  const percent = Math.max(
    0,
    Math.min(100, Math.round(progress.percent ?? 0)),
  );
  const startedAt = job.startedAt ?? job.queuedAt;

  const weekLabel =
    progress.currentWeek && progress.totalWeeks
      ? `Week ${progress.currentWeek} of ${progress.totalWeeks}`
      : null;

  return (
    <div
      id="base-plan-generation"
      className="planning-job-row"
      style={{ marginTop: "0.9rem" }}
    >
      <SolverJobAutoRefresh active={active} intervalMs={5000} />

      <div className="planning-job-main" style={{ width: "100%" }}>
        <div>
          <strong>{job.planScenario.name}</strong>
          <Badge tone={tone(job.status)}>
            {job.status}
          </Badge>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            flexWrap: "wrap",
          }}
        >
          {active ? (
            <RotateCw className="planning-spin" size={14} />
          ) : job.status === "SUCCEEDED" ? (
            <CheckCircle2 size={14} />
          ) : job.status === "FAILED" ? (
            <TriangleAlert size={14} />
          ) : (
            <Clock3 size={14} />
          )}

          <span>
            {progress.phaseLabel ?? progress.phase ?? job.status}
            {weekLabel ? ` · ${weekLabel}` : ""}
            {" · started "}
            <LocalTime value={startedAt.toISOString()} />
          </span>
        </div>

        {active ? (
          <>
            <progress
              max={100}
              value={percent}
              aria-label="Base Plan generation progress"
              style={{ width: "100%", maxWidth: "34rem" }}
            />
            <small>
              {percent}%
              {progress.message ? ` · ${progress.message}` : ""}
            </small>
            {progress.candidateCount !== null ? (
              <small>
                {progress.candidateCount.toLocaleString("en-GB")} candidates
                {progress.candidateSeconds !== null
                  ? ` · candidates ${progress.candidateSeconds.toFixed(1)}s`
                  : ""}
                {progress.modelSeconds !== null
                  ? ` · model ${progress.modelSeconds.toFixed(1)}s`
                  : ""}
              </small>
            ) : null}
            <small>
              {cancelling
                ? "Cancellation requested. The running solver process is being stopped safely."
                : "Generation continues in the background. You can leave this page and return later."}
            </small>

            {active && !cancelling ? (
              <form action={cancelBasePlanSolverJob}>
                <input
                  type="hidden"
                  name="jobId"
                  value={job.id}
                />
                <Button type="submit">
                  Cancel generation
                </Button>
              </form>
            ) : null}
          </>
        ) : null}

        {job.status === "SUCCEEDED" ? (
          <small>
            Proposal generation completed. Open the scenario below to review
            the timetable before acceptance.
          </small>
        ) : null}

        {job.failureMessage ? (
          <p className="planning-job-error">
            <TriangleAlert size={12} />
            {job.failureMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
