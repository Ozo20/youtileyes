import { CheckCircle2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { publishBasePlanRevision } from "@/lib/planning/publish-actions";

export function BasePlanPublishPanel({
  planId,
  planVersion,
  planStatus,
  scenarioName,
  sessionCount,
  predecessorVersion,
}: {
  planId: string;
  planVersion: number;
  planStatus: string;
  scenarioName: string | null;
  sessionCount: number;
  predecessorVersion: number | null;
}) {
  if (planStatus !== "APPROVED") return null;

  return (
    <Card>
      <CardHeader>
        <div>
          <span className="eyebrow">Publish</span>
          <h2>Publish Base Plan v{planVersion}</h2>
        </div>
      </CardHeader>

      <CardContent>
        <div className="planning-decision-intro">
          <ShieldCheck size={18} />
          <div>
            <strong>Review is complete</strong>
            <span>
              Publication materialises the accepted proposal as the official
              timetable for this revision.
            </span>
          </div>
        </div>

        <div className="planning-decision-checks">
          <div data-ok="true">
            <CheckCircle2 size={15} />
            <span>
              Accepted proposal: <strong>{scenarioName ?? "Base Plan proposal"}</strong>
            </span>
          </div>
          <div data-ok={sessionCount > 0}>
            <CheckCircle2 size={15} />
            <span>
              Sessions to publish: <strong>{sessionCount}</strong>
            </span>
          </div>
          {predecessorVersion !== null ? (
            <div data-ok="true">
              <CheckCircle2 size={15} />
              <span>
                Plan v{predecessorVersion} will become <strong>SUPERSEDED</strong>
              </span>
            </div>
          ) : null}
        </div>

        <div className="planning-decision-warning">
          <strong>Controlled publication</strong>
          <p>
            This creates the official Session records for Base Plan v{planVersion}
            and marks the predecessor revision as superseded. The accepted
            solver proposal remains preserved as the publication source.
          </p>
        </div>

        <form action={publishBasePlanRevision}>
          <input type="hidden" name="planId" value={planId} />
          <Button
            type="submit"
            variant="primary"
            disabled={!scenarioName || sessionCount === 0}
          >
            Publish Base Plan v{planVersion}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
