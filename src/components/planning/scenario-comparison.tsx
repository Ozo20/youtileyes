import {
  ArrowRight,
  GitCompareArrows,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { jsonRecord } from "@/lib/planning/workspace-data";

type Change = {
  id: string;
  changeType: string;
  explanationCode: string | null;
  explanation: string | null;
  beforeState: unknown;
  afterState: unknown;
  scenarioSession: {
    date: Date;
    startMinute: number;
    endMinute: number;
    teachingGroup: {
      id: string;
      code: string | null;
      name: string;
    };
    room: {
      code: string | null;
      name: string;
    } | null;
    instructors: Array<{
      role: string;
      instructor: {
        id: string;
        firstName: string;
        lastName: string;
      };
    }>;
  } | null;
};

type SessionState = {
  date: string | null;
  startMinute: number | null;
  endMinute: number | null;
  roomId: string | null;
  instructorId: string | null;
  instructorIds: string[];
  staffingAssignments: Array<{
    role: string;
    instructorId: string;
  }>;
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function readString(
  record: Record<string, unknown> | null,
  key: string,
) {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function readNumber(
  record: Record<string, unknown> | null,
  key: string,
) {
  const value = record?.[key];
  return typeof value === "number" ? value : null;
}

function sessionState(value: unknown): SessionState {
  const record = jsonRecord(value);
  const rawInstructorIds = record?.instructorIds;
  const rawStaffing = record?.staffingAssignments;

  const instructorIds = Array.isArray(rawInstructorIds)
    ? rawInstructorIds.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  const staffingAssignments = Array.isArray(rawStaffing)
    ? rawStaffing.flatMap((item) => {
        const assignment = jsonRecord(item);
        const role = readString(assignment, "role");
        const instructorId =
          readString(assignment, "instructorId") ??
          readString(assignment, "instructor_id");

        return role && instructorId
          ? [{ role, instructorId }]
          : [];
      })
    : [];

  const instructorId = readString(record, "instructorId");

  return {
    date: readString(record, "date"),
    startMinute: readNumber(record, "startMinute"),
    endMinute: readNumber(record, "endMinute"),
    roomId: readString(record, "roomId"),
    instructorId,
    instructorIds:
      instructorIds.length > 0
        ? instructorIds
        : instructorId
          ? [instructorId]
          : [],
    staffingAssignments,
  };
}

function minuteLabel(value: number | null) {
  if (value === null) return "—";

  const hours = Math.floor(value / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (value % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${minutes}`;
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  return dateFormatter.format(
    new Date(`${value.slice(0, 10)}T00:00:00.000Z`),
  );
}

function timeLabel(state: SessionState) {
  return `${minuteLabel(state.startMinute)}–${minuteLabel(state.endMinute)}`;
}

function roomLabel(
  roomId: string | null,
  roomNames: Record<string, string>,
) {
  if (!roomId) return "No room";
  return roomNames[roomId] ?? "Unknown room";
}

function instructorLabel(
  state: SessionState,
  instructorNames: Record<string, string>,
) {
  if (state.staffingAssignments.length > 0) {
    return state.staffingAssignments
      .map(
        (assignment) =>
          `${assignment.role}: ${
            instructorNames[assignment.instructorId] ??
            "Unknown instructor"
          }`,
      )
      .join(" · ");
  }

  if (state.instructorIds.length === 0) {
    return "No instructor";
  }

  return state.instructorIds
    .map((id) => instructorNames[id] ?? "Unknown instructor")
    .join(" · ");
}

function sameArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function DiffRow({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <div className="planning-change-diff-row">
      <span className="planning-change-diff-label">{label}</span>
      <span className="planning-change-before">{before}</span>
      <ArrowRight size={13} />
      <strong className="planning-change-after">{after}</strong>
    </div>
  );
}

export function ScenarioComparison({
  changes,
  instructorNames,
  roomNames,
}: {
  changes: Change[];
  instructorNames: Record<string, string>;
  roomNames: Record<string, string>;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <span className="eyebrow">What changes</span>
          <h2>Current arrangement → proposed arrangement</h2>
        </div>

        <GitCompareArrows size={18} />
      </CardHeader>

      <CardContent className="planning-change-list">
        {changes.length === 0 ? (
          <p className="planning-muted">
            This proposal has no recorded session changes.
          </p>
        ) : (
          changes.map((change) => {
            const direct =
              change.explanationCode ===
              "RESOURCE_RECOVERY_DIRECT";
            const before = sessionState(change.beforeState);
            const after = sessionState(change.afterState);

            const dateChanged = before.date !== after.date;
            const timeChanged =
              before.startMinute !== after.startMinute ||
              before.endMinute !== after.endMinute;
            const roomChanged = before.roomId !== after.roomId;
            const instructorsChanged =
              !sameArray(before.instructorIds, after.instructorIds) ||
              JSON.stringify(before.staffingAssignments) !==
                JSON.stringify(after.staffingAssignments);

            return (
              <div
                key={change.id}
                className="planning-change-row planning-change-row-rich"
              >
                <div className="planning-change-main">
                  <div className="planning-change-heading">
                    <div className="planning-change-title">
                      <strong>
                        {change.scenarioSession?.teachingGroup.code ??
                          "Session"}
                      </strong>
                      <span>
                        {change.scenarioSession?.teachingGroup.name ??
                          "Teaching session"}
                      </span>
                    </div>

                    <Badge tone={direct ? "warning" : "info"}>
                      {direct ? "Direct" : "Cascading"}
                    </Badge>

                    <Badge tone="neutral">
                      {change.changeType}
                    </Badge>
                  </div>

                  <p className="planning-change-explanation">
                    {direct
                      ? "This session used the unavailable resource and had to be changed."
                      : "This session was adjusted to keep the overall timetable feasible after the direct changes."}
                  </p>

                  <div className="planning-change-diff">
                    {dateChanged ? (
                      <DiffRow
                        label="Date"
                        before={dateLabel(before.date)}
                        after={dateLabel(after.date)}
                      />
                    ) : null}

                    {timeChanged ? (
                      <DiffRow
                        label="Time"
                        before={timeLabel(before)}
                        after={timeLabel(after)}
                      />
                    ) : null}

                    {roomChanged ? (
                      <DiffRow
                        label="Room"
                        before={roomLabel(before.roomId, roomNames)}
                        after={roomLabel(after.roomId, roomNames)}
                      />
                    ) : null}

                    {instructorsChanged ? (
                      <DiffRow
                        label="Instructor"
                        before={instructorLabel(
                          before,
                          instructorNames,
                        )}
                        after={instructorLabel(
                          after,
                          instructorNames,
                        )}
                      />
                    ) : null}
                  </div>

                  {change.explanation ? (
                    <small className="planning-change-technical-reason">
                      Reason: {change.explanation}
                    </small>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
