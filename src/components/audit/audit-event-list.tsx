import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  FileClock,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

import type {
  EventType,
  Prisma,
} from "../../generated/prisma/client";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuditText } from "@/lib/audit";

type AuditEvent = {
  id: string;
  eventType: EventType;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  description: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

type AuditEventListProps = {
  events: AuditEvent[];
  selectedEventId?: string;
  baseHref?: string;
};

function eventTone(
  eventType: EventType,
): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (eventType) {
    case "APPROVED":
    case "PUBLISHED":
      return "success";
    case "REJECTED":
      return "danger";
    case "SUBMITTED":
    case "GENERATED":
      return "info";
    case "SUPERSEDED":
    case "ARCHIVED":
      return "warning";
    default:
      return "neutral";
  }
}

function eventIcon(eventType: EventType) {
  switch (eventType) {
    case "GENERATED":
      return <Sparkles size={15} />;
    case "APPROVED":
    case "PUBLISHED":
      return <CheckCircle2 size={15} />;
    case "UPDATED":
      return <RefreshCcw size={15} />;
    default:
      return <Activity size={15} />;
  }
}

const formatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function AuditEventList({
  events,
  selectedEventId,
  baseHref = "/history",
}: AuditEventListProps) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<FileClock size={20} />}
        title="No history yet"
        description="Meaningful changes will appear here as the plan and master data evolve."
      />
    );
  }

  return (
    <div className="audit-event-list">
      {events.map((event) => {
        const actorName =
          getAuditText(event.metadata, "actorName") ??
          (event.actorId ? event.actorId : "System");

        const correlationId = getAuditText(
          event.metadata,
          "correlationId",
        );

        const href = `${baseHref}${baseHref.includes("?") ? "&" : "?"}event=${event.id}`;

        return (
          <Link
            key={event.id}
            href={href}
            className="audit-event-row"
            data-selected={event.id === selectedEventId}
          >
            <span className="audit-event-icon">
              {eventIcon(event.eventType)}
            </span>

            <span className="audit-event-main">
              <span className="audit-event-heading">
                <strong>
                  {event.description ??
                    `${event.eventType} ${event.entityType}`}
                </strong>

                <Badge tone={eventTone(event.eventType)}>
                  {event.eventType}
                </Badge>
              </span>

              <span className="audit-event-meta">
                {formatter.format(event.createdAt)}
                {" · "}
                {actorName}
                {" · "}
                {event.entityType}
                {correlationId
                  ? ` · ${correlationId.slice(0, 8)}`
                  : ""}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
