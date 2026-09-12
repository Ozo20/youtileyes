import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Download,
  FileClock,
  FileJson,
  FileSpreadsheet,
  FileText,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { planRevisionState } from "@/lib/planning/revision-history";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function label(value: Date | null) {
  return value ? dateFormatter.format(value) : "Open";
}

function tone(state: string) {
  if (state === "CURRENT") return "success" as const;
  if (state === "FUTURE") return "info" as const;
  if (state === "DRAFT") return "warning" as const;
  return "neutral" as const;
}

function canExport(status: string) {
  return status === "PUBLISHED" || status === "SUPERSEDED";
}

export function PlanRevisionTimeline({
  revisions,
  compact = false,
}: {
  revisions: Array<{
    id: string;
    name: string;
    version: number;
    status: string;
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
    publishedAt: Date | null;
    publishedById: string | null;
    _count: {
      sessions: number;
      distributions: number;
    };
    publishedRecoveryCases: Array<{
      id: string;
      version: number;
      publishedAt: Date | null;
      publishedByName: string | null;
      disruptions: Array<{
        id: string;
        type: string;
        resourceLabel: string;
        startDate: Date;
        endDate: Date;
      }>;
      proposals: Array<{
        scenario: {
          id: string;
          _count: { changes: number };
        };
      }>;
    }>;
    distributions: Array<{
      id: string;
      format: string;
      status: string;
      fileName: string;
      contentHash: string;
      sizeBytes: number;
      generatedByName: string | null;
      generatedAt: Date;
    }>;
  }>;
  compact?: boolean;
}) {
  const shown = compact ? revisions.slice(0, 4) : revisions;

  return (
    <Card>
      <CardHeader>
        <div>
          <span className="eyebrow">Controlled revisions</span>
          <h2>Plan revision history</h2>
        </div>

        {compact ? (
          <Link className="planning-inline-link" href="/planning/revisions">
            View all <ArrowRight size={13} />
          </Link>
        ) : null}
      </CardHeader>

      <CardContent className="planning-revision-timeline">
        {shown.map((revision) => {
          const state = planRevisionState(revision);
          const sourceCase = revision.publishedRecoveryCases[0];
          const changes =
            sourceCase?.proposals[0]?.scenario._count.changes ?? 0;
          const exportable = canExport(revision.status);

          return (
            <article
              key={revision.id}
              className="planning-revision-row"
              data-state={state}
            >
              <div className="planning-revision-marker" />

              <div className="planning-revision-main">
                <div className="planning-revision-title">
                  <strong>Plan v{revision.version}</strong>
                  <Badge tone={tone(state)}>{state}</Badge>
                  <span>{revision.status}</span>
                </div>

                <div className="planning-revision-period">
                  <CalendarClock size={13} />
                  <span>
                    {label(revision.effectiveFrom)} →{" "}
                    {label(revision.effectiveTo)}
                  </span>
                </div>

                {sourceCase ? (
                  <div className="planning-revision-cause">
                    <strong>{changes} session changes</strong>
                    <span>
                      {sourceCase.disruptions.length} disruption
                      {sourceCase.disruptions.length === 1 ? "" : "s"}
                    </span>
                    {sourceCase.disruptions.slice(0, 3).map((item) => (
                      <em key={item.id}>{item.resourceLabel}</em>
                    ))}
                  </div>
                ) : null}

                <div className="planning-revision-meta">
                  <span>{revision._count.sessions} sessions</span>
                  <span>
                    <Download size={11} />{" "}
                    {revision._count.distributions} distributions
                  </span>
                  {revision.publishedAt ? (
                    <span>
                      <FileClock size={11} /> Published{" "}
                      {dateFormatter.format(revision.publishedAt)}
                    </span>
                  ) : null}
                </div>

                {!compact && exportable ? (
                  <div
                    className="planning-revision-export-actions"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "7px",
                      marginTop: "9px",
                    }}
                  >
                    <span
                      style={{
                        marginRight: "3px",
                        color: "var(--text-muted)",
                        fontSize: "9px",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Export
                    </span>

                    <a
                      href={`/api/planning/plans/${revision.id}/export/pdf`}
                      style={{
                        minHeight: "30px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "5px",
                        padding: "0 10px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--surface)",
                        color: "var(--text-primary)",
                        fontSize: "10px",
                        fontWeight: 700,
                        lineHeight: 1,
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <FileText size={13} />
                      PDF
                    </a>

                    <a
                      href={`/api/planning/plans/${revision.id}/export/csv`}
                      style={{
                        minHeight: "30px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "5px",
                        padding: "0 10px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--surface)",
                        color: "var(--text-primary)",
                        fontSize: "10px",
                        fontWeight: 700,
                        lineHeight: 1,
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <FileSpreadsheet size={13} />
                      CSV
                    </a>

                    <a
                      href={`/api/planning/plans/${revision.id}/export/json`}
                      style={{
                        minHeight: "30px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "5px",
                        padding: "0 10px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--surface)",
                        color: "var(--text-primary)",
                        fontSize: "10px",
                        fontWeight: 700,
                        lineHeight: 1,
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <FileJson size={13} />
                      JSON
                    </a>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}
