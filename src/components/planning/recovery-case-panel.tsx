import {
  AlertTriangle,
  CircleDot,
  Layers3,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";

import {
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  addRecoveryDisruption,
  queueRecoveryCaseJob,
  removeRecoveryDisruption,
  updateRecoveryDisruption,
} from "@/lib/planning/recovery-case-actions";

type Resource = {
  id: string;
  label: string;
};

type SolverJobView = {
  id: string;
  status: string;
  failureMessage: string | null;
  queuedAt: Date;
  completedAt: Date | null;
  config: unknown;
  runs: Array<{
    diagnostics: unknown;
  }>;
};

type RecoveryCaseView = {
  id: string;
  name: string;
  status: string;
  version: number;
  disruptions: Array<{
    id: string;
    type: string;
    resourceId: string;
    resourceLabel: string;
    startDate: Date;
    endDate: Date;
  }>;
  proposals: Array<{
    id: string;
    status: string;
    caseVersion: number;
    scenario: {
      id: string;
      name: string;
      status: string;
    };
  }>;
  solverJobs: SolverJobView[];
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function dateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function configVersion(value: unknown) {
  const candidate = record(value)?.caseVersion;
  return typeof candidate === "number" ? candidate : null;
}

function diagnosticText(value: unknown, key: string) {
  const candidate = record(value)?.[key];
  return typeof candidate === "string" ? candidate : null;
}

function resourceOptions(
  type: string,
  instructors: Resource[],
  rooms: Resource[],
) {
  return type === "INSTRUCTOR_UNAVAILABLE"
    ? instructors
    : rooms;
}

export function RecoveryCasePanel({
  planId,
  baseScenarioId,
  planStartDate,
  planEndDate,
  recoveryCase,
  instructors,
  rooms,
}: {
  planId: string;
  baseScenarioId: string;
  planStartDate: string;
  planEndDate: string;
  recoveryCase: RecoveryCaseView | null;
  instructors: Resource[];
  rooms: Resource[];
}) {
  const activeJob = Boolean(
    recoveryCase?.solverJobs.some(
      (job) => job.status === "QUEUED" || job.status === "RUNNING",
    ),
  );

  const latestJob = recoveryCase?.solverJobs[0] ?? null;
  const latestJobIsCurrentVersion =
    latestJob !== null &&
    configVersion(latestJob.config) === recoveryCase?.version;

  const currentFailure =
    latestJob?.status === "FAILED" &&
    latestJobIsCurrentVersion
      ? latestJob
      : null;

  const diagnostics = currentFailure?.runs[0]?.diagnostics;
  const reasonCode = diagnosticText(diagnostics, "reasonCode");
  const occurrenceId = diagnosticText(diagnostics, "occurrenceId");
  const teachingGroupId = diagnosticText(
    diagnostics,
    "teachingGroupId",
  );
  const teachingGroupLabel = diagnosticText(
    diagnostics,
    "teachingGroupLabel",
  );

  const canGenerate =
    Boolean(recoveryCase) &&
    recoveryCase!.disruptions.length > 0 &&
    !activeJob;

  const buttonLabel = currentFailure
    ? "Try again"
    : recoveryCase && recoveryCase.proposals.length > 0
      ? "Recalculate proposal"
      : "Generate proposal";

  return (
    <section id="change-define" className="planning-anchor-section">
    <Card className="planning-recovery-case-card">
      <CardHeader>
        <div>
          <span className="eyebrow">Recovery workspace</span>
          <h2>
            {recoveryCase
              ? `Active recovery case · v${recoveryCase.version}`
              : "Create recovery case"}
          </h2>
        </div>

        <div className="planning-header-actions">
          {activeJob ? (
            <RotateCw className="planning-spin" size={16} />
          ) : currentFailure ? (
            <AlertTriangle size={17} />
          ) : (
            <Layers3 size={17} />
          )}

          <Badge
            tone={
              activeJob
                ? "warning"
                : currentFailure
                  ? "danger"
                  : "info"
            }
          >
            {activeJob
              ? "Recalculating"
              : currentFailure
                ? "FAILED"
                : recoveryCase?.status ?? "NEW"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="planning-recovery-case-intro">
          <CircleDot size={16} />
          <p>
            Add all disruptions that must be satisfied together. Editing,
            removing or adding a disruption makes the previous proposal stale
            and requires one global recalculation.
          </p>
        </div>

        {currentFailure ? (
          <div className="planning-recovery-failure">
            <AlertTriangle size={18} />

            <div>
              <strong>Recovery proposal could not be generated</strong>

              <p>
                {currentFailure.failureMessage ??
                  "No feasible timetable was found with all active disruptions applied together."}
              </p>

              {reasonCode === "NO_VALID_CANDIDATES" ? (
                <div className="planning-recovery-failure-detail">
                  <span>Scheduling bottleneck</span>
                  <strong>
                    {teachingGroupLabel ??
                      (teachingGroupId
                        ? `Teaching group ${teachingGroupId}`
                        : "Required teaching session")}
                  </strong>
                  <small>
                    One required teaching session has no legal remaining placement.
                  </small>
                </div>
              ) : null}

              <small>
                The disruptions are still saved. Adjust or remove one of them,
                then run the recovery again.
              </small>
            </div>
          </div>
        ) : null}

        {recoveryCase ? (
          <div className="planning-disruption-list">
            {recoveryCase.disruptions.map((item, index) => {
              const options = resourceOptions(
                item.type,
                instructors,
                rooms,
              );

              return (
                <div
                  key={item.id}
                  className="planning-disruption-row planning-disruption-row-managed"
                >
                  <span className="planning-disruption-index">
                    {index + 1}
                  </span>

                  <div className="planning-disruption-summary">
                    <strong>{item.resourceLabel}</strong>
                    <span>
                      {item.type === "INSTRUCTOR_UNAVAILABLE"
                        ? "Instructor unavailable"
                        : "Room unavailable"}
                      {" · "}
                      {dateFormatter.format(item.startDate)}
                      {item.endDate.getTime() !==
                      item.startDate.getTime()
                        ? ` – ${dateFormatter.format(item.endDate)}`
                        : ""}
                    </span>
                  </div>

                  <details className="planning-disruption-manage">
                    <summary>
                      <Pencil size={12} />
                      Edit
                    </summary>

                    <form
                      action={updateRecoveryDisruption}
                      className="planning-disruption-edit-form"
                    >
                      <input
                        type="hidden"
                        name="disruptionId"
                        value={item.id}
                      />
                      <input
                        type="hidden"
                        name="resourceType"
                        value={item.type}
                      />

                      <Field
                        label={
                          item.type === "INSTRUCTOR_UNAVAILABLE"
                            ? "Instructor"
                            : "Room"
                        }
                      >
                        <SelectInput
                          name="resourceId"
                          required
                          defaultValue={item.resourceId}
                        >
                          {options.map((option) => (
                            <option
                              key={option.id}
                              value={option.id}
                            >
                              {option.label}
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
                            defaultValue={dateInputValue(
                              item.startDate,
                            )}
                          />
                        </Field>

                        <Field label="To">
                          <TextInput
                            type="date"
                            name="endDate"
                            required
                            min={planStartDate}
                            max={planEndDate}
                            defaultValue={dateInputValue(
                              item.endDate,
                            )}
                          />
                        </Field>
                      </div>

                      <div className="planning-disruption-edit-actions">
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={activeJob}
                        >
                          Save change
                        </Button>
                      </div>
                    </form>

                    <form
                      action={removeRecoveryDisruption}
                      className="planning-disruption-remove-form"
                    >
                      <input
                        type="hidden"
                        name="disruptionId"
                        value={item.id}
                      />

                      <Button
                        type="submit"
                        variant="ghost"
                        disabled={activeJob}
                      >
                        <Trash2 size={13} />
                        Remove disruption
                      </Button>
                    </form>
                  </details>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="planning-recovery-add-grid">
          <form
            action={addRecoveryDisruption}
            className="planning-recovery-add-form"
          >
            <input type="hidden" name="planId" value={planId} />
            <input
              type="hidden"
              name="baseScenarioId"
              value={baseScenarioId}
            />
            {recoveryCase ? (
              <input
                type="hidden"
                name="recoveryCaseId"
                value={recoveryCase.id}
              />
            ) : null}
            <input
              type="hidden"
              name="resourceType"
              value="INSTRUCTOR_UNAVAILABLE"
            />

            <strong>
              <Plus size={13} /> Add instructor absence
            </strong>

            <Field label="Instructor">
              <SelectInput
                name="resourceId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select instructor
                </option>
                {instructors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
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
              variant="secondary"
              disabled={activeJob}
            >
              Add disruption
            </Button>
          </form>

          <form
            action={addRecoveryDisruption}
            className="planning-recovery-add-form"
          >
            <input type="hidden" name="planId" value={planId} />
            <input
              type="hidden"
              name="baseScenarioId"
              value={baseScenarioId}
            />
            {recoveryCase ? (
              <input
                type="hidden"
                name="recoveryCaseId"
                value={recoveryCase.id}
              />
            ) : null}
            <input
              type="hidden"
              name="resourceType"
              value="ROOM_UNAVAILABLE"
            />

            <strong>
              <Plus size={13} /> Add room outage
            </strong>

            <Field label="Room">
              <SelectInput
                name="resourceId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select room
                </option>
                {rooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
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
              variant="secondary"
              disabled={activeJob}
            >
              Add disruption
            </Button>
          </form>
        </div>

        {recoveryCase ? (
          <div
            id="change-calculate"
            className="planning-recovery-generate planning-anchor-target"
          >
            <div>
              <strong>
                {recoveryCase.disruptions.length} active disruption
                {recoveryCase.disruptions.length === 1 ? "" : "s"}
              </strong>
              <span>
                OR-Tools will solve all of them together against the same
                baseline.
              </span>
            </div>

            <form action={queueRecoveryCaseJob}>
              <input
                type="hidden"
                name="recoveryCaseId"
                value={recoveryCase.id}
              />

              <Button
                type="submit"
                variant="primary"
                disabled={!canGenerate || activeJob}
              >
                {activeJob ? (
                  <>
                    <RotateCw
                      className="planning-spin"
                      size={14}
                    />
                    Recalculating…
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    {buttonLabel}
                  </>
                )}
              </Button>
            </form>
          </div>
        ) : null}
      </CardContent>
    </Card>
    </section>
  );
}
