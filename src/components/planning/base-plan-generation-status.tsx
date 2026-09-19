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
  estimatedRemainingSeconds: number | null;
  estimatedCompletionAt: string | null;
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
    estimatedRemainingSeconds: number(
      progress?.estimatedRemainingSeconds,
    ),
    estimatedCompletionAt: text(
      progress?.estimatedCompletionAt,
    ),
  };
}

function statusLabel(status: string) {
  if (status === "QUEUED") return "Waiting to start";
  if (status === "RUNNING") return "In progress";
  if (status === "SUCCEEDED") return "Proposal ready";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "FAILED") return "Could not complete";

  return status;
}

function phaseLabel(
  status: string,
  phase: string | null,
  cancelling: boolean,
) {
  if (cancelling) return "Stopping generation…";

  if (status === "QUEUED") {
    return "Waiting to start";
  }

  if (status === "SUCCEEDED") {
    return "Timetable proposal ready";
  }

  if (status === "CANCELLED") {
    return "Generation was cancelled";
  }

  if (status === "FAILED") {
    return "Generation could not be completed";
  }

  if (phase === "BUILDING_INPUT") {
    return "Preparing planning data";
  }

  if (
    phase === "BUILDING_MODEL" ||
    phase === "SOLVING"
  ) {
    return "Creating timetable proposal";
  }

  if (phase === "PERSISTING") {
    return "Saving timetable proposal";
  }

  return "Creating timetable proposal";
}

function phaseDescription(
  phase: string | null,
  cancelling: boolean,
) {
  if (cancelling) {
    return "The process is being stopped safely. No published timetable will be changed.";
  }

  if (phase === "BUILDING_INPUT") {
    return "The planning data is being prepared before timetable generation begins.";
  }

  if (
    phase === "BUILDING_MODEL" ||
    phase === "SOLVING"
  ) {
    return "The system is testing combinations of teachers, rooms and times to find a good timetable.";
  }

  if (phase === "PERSISTING") {
    return "The generated timetable is being saved and prepared for review.";
  }

  return null;
}

function humanDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));

  if (minutes < 5) {
    return "less than 5 min";
  }

  const roundedMinutes = Math.round(minutes / 5) * 5;

  if (roundedMinutes < 60) {
    return `about ${roundedMinutes} min`;
  }

  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;

  if (remainingMinutes === 0) {
    return `about ${hours} h`;
  }

  return `about ${hours} h ${remainingMinutes} min`;
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

  const currentPhaseLabel = phaseLabel(
    job.status,
    progress.phase,
    cancelling,
  );

  const description = phaseDescription(
    progress.phase,
    cancelling,
  );

  const solving =
    job.status === "RUNNING" &&
    (progress.phase === "SOLVING" ||
      progress.phase === "BUILDING_MODEL");

  const etaAvailable =
    solving &&
    progress.estimatedRemainingSeconds !== null &&
    progress.estimatedCompletionAt !== null;

  const hasTechnicalDetails =
    progress.message !== null ||
    progress.candidateCount !== null ||
    progress.candidateSeconds !== null ||
    progress.modelSeconds !== null ||
    progress.updatedAt !== null;

  return (
    <div
      id="base-plan-generation"
      className="planning-job-row"
      style={{ marginTop: "0.9rem" }}
    >
      <SolverJobAutoRefresh
        active={active}
        intervalMs={5000}
      />

      <div
        className="planning-job-main"
        style={{ width: "100%" }}
      >
        <div>
          <strong>{job.planScenario.name}</strong>

          <Badge tone={tone(job.status)}>
            {statusLabel(job.status)}
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
            <RotateCw
              className="planning-spin"
              size={14}
            />
          ) : job.status === "SUCCEEDED" ? (
            <CheckCircle2 size={14} />
          ) : job.status === "FAILED" ? (
            <TriangleAlert size={14} />
          ) : (
            <Clock3 size={14} />
          )}

          <span>
            {currentPhaseLabel}
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
              aria-label="Timetable generation progress"
              style={{
                width: "100%",
                maxWidth: "34rem",
              }}
            />

            <small>{percent}% complete</small>

            {description ? (
              <small>{description}</small>
            ) : null}

            {progress.phase === "PERSISTING" ? (
              <small>
                Almost finished. The timetable proposal
                is being saved.
              </small>
            ) : etaAvailable ? (
              <small>
                {humanDuration(
                  progress.estimatedRemainingSeconds!,
                )}{" "}
                remaining · expected around{" "}
                <LocalTime
                  value={
                    progress.estimatedCompletionAt!
                  }
                />
              </small>
            ) : solving ? (
              <small>
                Estimating remaining time…
              </small>
            ) : null}

            {!cancelling ? (
              <small>
                You can leave this page and return later.
                Generation continues in the background.
              </small>
            ) : null}

            {hasTechnicalDetails ? (
              <details>
                <summary>Technical details</summary>

                <div
                  style={{
                    display: "grid",
                    gap: "0.25rem",
                    marginTop: "0.4rem",
                  }}
                >
                  {progress.message ? (
                    <small>{progress.message}</small>
                  ) : null}

                  {progress.candidateCount !== null ? (
                    <small>
                      {progress.candidateCount.toLocaleString(
                        "en-GB",
                      )}{" "}
                      candidates
                    </small>
                  ) : null}

                  {progress.candidateSeconds !== null ? (
                    <small>
                      Candidate generation:{" "}
                      {progress.candidateSeconds.toFixed(1)} s
                    </small>
                  ) : null}

                  {progress.modelSeconds !== null ? (
                    <small>
                      Model preparation:{" "}
                      {progress.modelSeconds.toFixed(1)} s
                    </small>
                  ) : null}

                  {progress.phase ? (
                    <small>
                      Internal phase: {progress.phase}
                    </small>
                  ) : null}
                </div>
              </details>
            ) : null}

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
            The timetable proposal is ready. Review it
            before approval or publication.
          </small>
        ) : null}

        {job.status === "CANCELLED" ? (
          <small>
            Generation was stopped. No published
            timetable was changed.
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
