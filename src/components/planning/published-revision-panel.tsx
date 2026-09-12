import Link from "next/link";

import {
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  History,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function PublishedRevisionPanel({
  plan,
}: {
  plan: {
    id: string;
    name: string;
    version: number;
    status: string;
    effectiveFrom: Date | null;
    publishedAt: Date | null;
    sessionCount: number;
  };
}) {
  return (
    <section
      id="change-publish"
      className="planning-anchor-section"
    >
      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">
              Published revision
            </span>
            <h2>
              {plan.name} · v{plan.version}
            </h2>
          </div>

          <Badge tone="success">
            {plan.status}
          </Badge>
        </CardHeader>

        <CardContent>
          <div
            className="planning-workflow-message"
            data-tone="success"
          >
            <CheckCircle2 size={16} />
            <div>
              <strong>
                New plan revision published
              </strong>
              <span>
                {plan.sessionCount} sessions are controlled by
                this revision
                {plan.effectiveFrom
                  ? ` from ${dateFormatter.format(plan.effectiveFrom)}`
                  : ""}
                .
              </span>
            </div>
          </div>

          <div className="planning-distribution-note">
            Each export is recorded as a distribution event with file hash and timestamp.
          </div>

          <div className="planning-distribution-actions">
            <a
              className="ui-button ui-button-secondary"
              href={`/api/planning/plans/${plan.id}/export/pdf`}
            >
              <FileText size={14} />
              PDF
              <Download size={12} />
            </a>

            <a
              className="ui-button ui-button-secondary"
              href={`/api/planning/plans/${plan.id}/export/csv`}
            >
              <FileSpreadsheet size={14} />
              CSV
              <Download size={12} />
            </a>

            <a
              className="ui-button ui-button-secondary"
              href={`/api/planning/plans/${plan.id}/export/json`}
            >
              <FileJson size={14} />
              JSON
              <Download size={12} />
            </a>
          </div>

          <Link className="planning-inline-link planning-published-history-link" href="/planning/revisions">
            <History size={13} /> Revision & distribution history
          </Link>

          {plan.publishedAt ? (
            <small className="planning-published-meta">
              Published{" "}
              {plan.publishedAt.toLocaleString(
                "en-GB",
              )}
            </small>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
