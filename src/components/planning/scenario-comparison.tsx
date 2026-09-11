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
import {
  jsonRecord,
} from "@/lib/planning/workspace-data";

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
        firstName: string;
        lastName: string;
      };
    }>;
  } | null;
};

function value(
  state: unknown,
  key: string,
): string {
  const candidate = jsonRecord(state)?.[key];

  if (candidate === null || candidate === undefined) return "—";
  if (Array.isArray(candidate)) return candidate.join(", ");
  if (typeof candidate === "object") return "Changed";

  return String(candidate);
}

function minuteLabel(value: string) {
  const minute = Number(value);

  if (!Number.isFinite(minute)) return value;

  const hours = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (minute % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${minutes}`;
}

function compareLabel(
  before: unknown,
  after: unknown,
  key: string,
  format: (value: string) => string = (item) => item,
) {
  const beforeValue = format(value(before, key));
  const afterValue = format(value(after, key));

  if (beforeValue === afterValue) return null;

  return (
    <span className="planning-change-value">
      <span>{beforeValue}</span>
      <ArrowRight size={12} />
      <strong>{afterValue}</strong>
    </span>
  );
}

export function ScenarioComparison({
  changes,
}: {
  changes: Change[];
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <span className="eyebrow">Comparison</span>
          <h2>Baseline → scenario</h2>
        </div>

        <GitCompareArrows size={18} />
      </CardHeader>

      <CardContent className="planning-change-list">
        {changes.length === 0 ? (
          <p className="planning-muted">
            No recorded changes for this scenario.
          </p>
        ) : (
          changes.map((change) => {
            const direct =
              change.explanationCode ===
              "RESOURCE_RECOVERY_DIRECT";

            return (
              <div
                key={change.id}
                className="planning-change-row"
              >
                <div className="planning-change-main">
                  <div className="planning-change-heading">
                    <strong>
                      {change.scenarioSession?.teachingGroup.code ??
                        change.scenarioSession?.teachingGroup.name ??
                        "Session"}
                    </strong>

                    <Badge
                      tone={direct ? "warning" : "info"}
                    >
                      {direct ? "Direct" : "Cascading"}
                    </Badge>

                    <Badge tone="neutral">
                      {change.changeType}
                    </Badge>
                  </div>

                  <p>
                    {change.explanation ??
                      "Scenario change recorded by the solver."}
                  </p>

                  <div className="planning-change-values">
                    {compareLabel(
                      change.beforeState,
                      change.afterState,
                      "date",
                    )}
                    {compareLabel(
                      change.beforeState,
                      change.afterState,
                      "startMinute",
                      minuteLabel,
                    )}
                    {compareLabel(
                      change.beforeState,
                      change.afterState,
                      "endMinute",
                      minuteLabel,
                    )}
                    {compareLabel(
                      change.beforeState,
                      change.afterState,
                      "roomId",
                    )}
                    {compareLabel(
                      change.beforeState,
                      change.afterState,
                      "instructorId",
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
