import Link from "next/link";
import {
  CircleDot,
  Cpu,
  Play,
  RotateCw,
  TriangleAlert,
} from "lucide-react";

import { SolverJobAutoRefresh } from "@/components/planning/solver-job-auto-refresh";
import {
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { queueResourceRecoveryJob } from "@/lib/planning/solver-job-actions";
import {
  scenarioStatusLabel,
  solverJobStatusLabel,
  solverJobStatusTone,
  solverRunOutcomeLabel,
} from "@/lib/planning/status-labels";

type BaseScenario = {
  id: string;
  name: string;
  status: string;
};

type Instructor = {
  id: string;
  firstName: string;
  lastName: string;
};

type Room = {
  id: string;
  code: string | null;
  name: string;
};

type Job = {
  id: string;
  status: string;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failureMessage: string | null;
  planScenario: {
    id: string;
    name: string;
  };
  config: unknown;
  runs: Array<{
    id: string;
    status: string;
    objectiveValue: number | null;
  }>;
};


function configRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function configText(value: unknown, key: string) {
  const candidate = configRecord(value)?.[key];
  return typeof candidate === "string" ? candidate : null;
}

export function SolverJobPanel({
  planStartDate,
  planEndDate,
  baseScenarios,
  instructors,
  rooms,
  jobs,
}: {
  planStartDate: string;
  planEndDate: string;
  baseScenarios: BaseScenario[];
  instructors: Instructor[];
  rooms: Room[];
  jobs: Job[];
}) {
  const active = jobs.some(
    (job) => job.status === "QUEUED" || job.status === "RUNNING",
  );

  return (
    <Card className="planning-solver-card">
      <SolverJobAutoRefresh active={active} />

      <CardHeader>
        <div>
          <span className="eyebrow">Solver jobs</span>
          <h2>Generate recovery scenario</h2>
        </div>

        <div className="planning-header-actions">
          {active ? <RotateCw className="planning-spin" size={16} /> : <Cpu size={17} />}
          <Badge tone={active ? "warning" : "neutral"}>
            {active ? "Processing" : `${jobs.length} recent`}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="planning-solver-intro">
          <CircleDot size={16} />
          <p>
            Queue a controlled OR-Tools recovery run. The solver creates a new
            proposal and never overwrites the current plan.
          </p>
        </div>

        <div className="planning-solver-forms">
          <form
            action={queueResourceRecoveryJob}
            className="planning-solver-form"
          >
            <input
              type="hidden"
              name="resourceType"
              value="INSTRUCTOR_UNAVAILABLE"
            />

            <div className="planning-solver-form-title">
              <strong>Instructor unavailable</strong>
              <span>Replan globally around instructor absence.</span>
            </div>

            <Field label="Base scenario">
              <SelectInput name="baseScenarioId" required defaultValue={baseScenarios[0]?.id ?? ""}>
                {baseScenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name} · {scenarioStatusLabel(scenario.status)}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="Instructor">
              <SelectInput name="resourceId" required defaultValue="">
                <option value="" disabled>
                  Select instructor
                </option>
                {instructors.map((instructor) => (
                  <option key={instructor.id} value={instructor.id}>
                    {instructor.firstName} {instructor.lastName}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <div className="planning-solver-dates">
              <Field label="From">
                <TextInput
                  type="date"
                  name="startDate"
                  required
                  min={planStartDate}
                  max={planEndDate}
                  defaultValue={planStartDate}
                />
              </Field>

              <Field label="To">
                <TextInput
                  type="date"
                  name="endDate"
                  required
                  min={planStartDate}
                  max={planEndDate}
                  defaultValue={planStartDate}
                />
              </Field>
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={active || baseScenarios.length === 0 || instructors.length === 0}
            >
              <Play size={14} />
              Queue recovery
            </Button>
          </form>

          <form
            action={queueResourceRecoveryJob}
            className="planning-solver-form"
          >
            <input
              type="hidden"
              name="resourceType"
              value="ROOM_UNAVAILABLE"
            />

            <div className="planning-solver-form-title">
              <strong>Room unavailable</strong>
              <span>Find a feasible recovery using other rooms and resources.</span>
            </div>

            <Field label="Base scenario">
              <SelectInput name="baseScenarioId" required defaultValue={baseScenarios[0]?.id ?? ""}>
                {baseScenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name} · {scenarioStatusLabel(scenario.status)}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="Room">
              <SelectInput name="resourceId" required defaultValue="">
                <option value="" disabled>
                  Select room
                </option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.code ? `${room.code} · ` : ""}
                    {room.name}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <div className="planning-solver-dates">
              <Field label="From">
                <TextInput
                  type="date"
                  name="startDate"
                  required
                  min={planStartDate}
                  max={planEndDate}
                  defaultValue={planStartDate}
                />
              </Field>

              <Field label="To">
                <TextInput
                  type="date"
                  name="endDate"
                  required
                  min={planStartDate}
                  max={planEndDate}
                  defaultValue={planStartDate}
                />
              </Field>
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={active || baseScenarios.length === 0 || rooms.length === 0}
            >
              <Play size={14} />
              Queue recovery
            </Button>
          </form>
        </div>

        <section className="planning-job-history">
          <div className="planning-job-history-title">
            <strong>Recent jobs</strong>
            <span>Recent recovery calculations and their outcome</span>
          </div>

          {jobs.length === 0 ? (
            <p className="planning-muted">
              No solver jobs have been queued from the workspace yet.
            </p>
          ) : (
            <div className="planning-job-list">
              {jobs.map((job) => {
                const resourceLabel =
                  configText(job.config, "resourceLabel") ?? "Resource";
                const startDate =
                  configText(job.config, "startDate") ?? "—";
                const endDate =
                  configText(job.config, "endDate") ?? startDate;
                const run = job.runs[0];

                return (
                  <div key={job.id} className="planning-job-row">
                    <div className="planning-job-main">
                      <div>
                        <strong>{resourceLabel}</strong>
                        <Badge tone={solverJobStatusTone(job.status)}>
                          {solverJobStatusLabel(job.status)}
                        </Badge>
                      </div>

                      <span>
                        {startDate}
                        {endDate !== startDate ? ` → ${endDate}` : ""}
                        {" · queued "}
                        <LocalTime value={job.queuedAt.toISOString()} />
                      </span>

                      {job.failureMessage ? (
                        <p className="planning-job-error">
                          <TriangleAlert size={12} />
                          {job.failureMessage}
                        </p>
                      ) : run ? (
                        <>
                          <small>
                            {solverRunOutcomeLabel(run.status)}
                          </small>

                          <details>
                            <summary>Technical details</summary>
                            <div
                              style={{
                                display: "grid",
                                gap: "0.25rem",
                                marginTop: "0.4rem",
                              }}
                            >
                              <small>
                                Internal run status: {run.status}
                              </small>

                              {run.objectiveValue !== null ? (
                                <small>
                                  Solver score: {run.objectiveValue}
                                </small>
                              ) : null}
                            </div>
                          </details>
                        </>
                      ) : null}
                    </div>

                    {job.status === "SUCCEEDED" ? (
                      <Link
                        href={`/planning?scenario=${job.planScenario.id}&job=${job.id}`}
                      >
                        Open scenario
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
