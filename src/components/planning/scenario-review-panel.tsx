import Link from "next/link";
import {
  CheckCircle2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { updateScenarioDecision } from "@/lib/planning/workspace-actions";
import { jsonRecord } from "@/lib/planning/workspace-data";

type Change = {
  id: string;
  explanationCode: string | null;
  beforeState: unknown;
  afterState: unknown;
  scenarioSession: {
    teachingGroup: {
      id: string;
    };
  } | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function stringValue(
  record: Record<string, unknown> | null,
  key: string,
) {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function stateIds(value: unknown) {
  const record = jsonRecord(value);
  const rawInstructorIds = record?.instructorIds;

  const instructorIds = Array.isArray(rawInstructorIds)
    ? rawInstructorIds.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  const instructorId = stringValue(record, "instructorId");

  return {
    instructorIds:
      instructorIds.length > 0
        ? instructorIds
        : instructorId
          ? [instructorId]
          : [],
    roomId: stringValue(record, "roomId"),
  };
}

function dateLabel(value: string | null) {
  if (!value) return "Unknown date";

  return dateFormatter.format(
    new Date(`${value.slice(0, 10)}T00:00:00.000Z`),
  );
}

function disruptionInfo(
  generationConfig: unknown,
  instructorNames: Record<string, string>,
  roomNames: Record<string, string>,
) {
  const config = jsonRecord(generationConfig);
  const disruptions = Array.isArray(config?.disruptions)
    ? config.disruptions
    : [];
  const disruption = jsonRecord(config?.disruption);

  if (disruptions.length > 1) {
    return {
      subject: `Recovery case · ${disruptions.length} disruptions`,
      period: null,
    };
  }

  const type = stringValue(disruption, "type");
  const resourceId = stringValue(disruption, "resourceId");
  const startDate = stringValue(disruption, "startDate");
  const endDate = stringValue(disruption, "endDate") ?? startDate;

  const resourceLabel =
    type === "INSTRUCTOR_UNAVAILABLE"
      ? resourceId
        ? instructorNames[resourceId] ?? "Instructor"
        : "Instructor"
      : resourceId
        ? roomNames[resourceId] ?? "Room"
        : "Room";

  const subject =
    type === "INSTRUCTOR_UNAVAILABLE"
      ? `${resourceLabel} unavailable`
      : `Room ${resourceLabel} unavailable`;

  const period =
    startDate && endDate
      ? startDate === endDate
        ? dateLabel(startDate)
        : `${dateLabel(startDate)} – ${dateLabel(endDate)}`
      : null;

  return { subject, period };
}

export function ScenarioReviewPanel({
  scenario,
  solverStatus,
  blockingViolations,
  instructorNames,
  roomNames,
}: {
  scenario: {
    id: string;
    name: string;
    status: string;
    generationConfig: unknown;
    sessionCount: number;
    changes: Change[];
  };
  solverStatus: string;
  blockingViolations: number;
  instructorNames: Record<string, string>;
  roomNames: Record<string, string>;
}) {
  const direct = scenario.changes.filter(
    (change) =>
      change.explanationCode ===
      "RESOURCE_RECOVERY_DIRECT",
  ).length;
  const cascading = scenario.changes.length - direct;

  const groupIds = new Set<string>();
  const instructorIds = new Set<string>();
  const roomIds = new Set<string>();

  for (const change of scenario.changes) {
    if (change.scenarioSession?.teachingGroup.id) {
      groupIds.add(change.scenarioSession.teachingGroup.id);
    }

    for (const state of [change.beforeState, change.afterState]) {
      const ids = stateIds(state);

      ids.instructorIds.forEach((id) => instructorIds.add(id));
      if (ids.roomId) roomIds.add(ids.roomId);
    }
  }

  const config = jsonRecord(scenario.generationConfig);
  const scenarioType = stringValue(config, "type");
  const isBasePlan = scenarioType === "BASE_PLAN";
  const disruption = isBasePlan
    ? { subject: scenario.name, period: null }
    : disruptionInfo(
        scenario.generationConfig,
        instructorNames,
        roomNames,
      );

  const solverOkay =
    solverStatus === "OPTIMAL" || solverStatus === "FEASIBLE";

  return (
    <Card>
      <CardHeader>
        <div>
          <span className="eyebrow">Decision review</span>
          <h2>{disruption.subject}</h2>
          {disruption.period ? (
            <p className="planning-review-period">
              {disruption.period}
            </p>
          ) : null}
        </div>

        <Badge tone="warning">Review required</Badge>
      </CardHeader>

      <CardContent>
        <div className="planning-decision-intro">
          <ShieldCheck size={18} />
          <div>
            <strong>Review exactly what you are accepting</strong>
            <span>
              {isBasePlan
                ? "Accepting selects this generated timetable as the controlled Base Plan proposal for the revision. It does not publish the plan."
                : "Accepting selects this recovery scenario as the proposal to continue with. It does not publish it or overwrite the current plan."}
            </span>
          </div>
        </div>

        <div className="planning-impact-grid">
          <div>
            <span>{isBasePlan ? "Generated sessions" : "Sessions changed"}</span>
            <strong>{isBasePlan ? scenario.sessionCount : scenario.changes.length}</strong>
          </div>
          <div>
            <span>Direct changes</span>
            <strong>{direct}</strong>
          </div>
          <div>
            <span>Cascading</span>
            <strong>{cascading}</strong>
          </div>
          <div>
            <span>Groups affected</span>
            <strong>{groupIds.size}</strong>
          </div>
          <div>
            <span>Instructors involved</span>
            <strong>{instructorIds.size}</strong>
          </div>
          <div>
            <span>Rooms involved</span>
            <strong>{roomIds.size}</strong>
          </div>
        </div>

        <div className="planning-decision-checks">
          <div data-ok={solverOkay}>
            {solverOkay ? (
              <CheckCircle2 size={15} />
            ) : (
              <TriangleAlert size={15} />
            )}
            <span>
              Solver result: <strong>{solverStatus}</strong>
            </span>
          </div>

          <div data-ok={blockingViolations === 0}>
            {blockingViolations === 0 ? (
              <CheckCircle2 size={15} />
            ) : (
              <TriangleAlert size={15} />
            )}
            <span>
              Blocking violations:{" "}
              <strong>{blockingViolations}</strong>
            </span>
          </div>

          <div data-ok="true">
            <CheckCircle2 size={15} />
            <span>
              Proposed timetable contains{" "}
              <strong>{scenario.sessionCount} sessions</strong>
            </span>
          </div>
        </div>

        <div className="planning-decision-warning">
          <strong>What Accept means</strong>
          <p>
            The scenario moves from GENERATED to ACCEPTED. {isBasePlan
              ? "The Plan revision remains GENERATED until it is submitted, approved and published through the controlled lifecycle."
              : "The current plan remains unchanged. Publishing an accepted scenario will be a separate controlled step with its own review and audit trail."}
          </p>
        </div>

        <div className="planning-decision-actions">
          <Link href={`/planning?scenario=${scenario.id}`}>
            <Button type="button" variant="ghost">
              Cancel review
            </Button>
          </Link>

          <form action={updateScenarioDecision}>
            <input
              type="hidden"
              name="scenarioId"
              value={scenario.id}
            />
            <input type="hidden" name="decision" value="REJECT" />
            <Button type="submit" variant="secondary">
              Reject proposal
            </Button>
          </form>

          <form action={updateScenarioDecision}>
            <input
              type="hidden"
              name="scenarioId"
              value={scenario.id}
            />
            <input type="hidden" name="decision" value="ACCEPT" />
            <Button type="submit" variant="primary">
              Accept proposal
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
