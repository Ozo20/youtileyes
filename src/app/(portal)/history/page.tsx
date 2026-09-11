import {
  FileClock,
  Filter,
  Search,
} from "lucide-react";

import {
  EventType,
  type Prisma,
} from "@/generated/prisma/client";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  getAuditMetadata,
  getAuditText,
} from "@/lib/audit";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    type?: string;
    entity?: string;
    event?: string;
  }>;
};

const eventTypes = Object.values(EventType);

function validEventType(value?: string) {
  return eventTypes.includes(value as EventType)
    ? (value as EventType)
    : undefined;
}

function prettyJson(value: Prisma.JsonValue | null) {
  if (!value) return null;

  return JSON.stringify(value, null, 2);
}

export default async function HistoryPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
  });

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader
          title="History"
          description="Audit history is unavailable because no active tenant was found."
        />
      </div>
    );
  }

  const eventType = validEventType(params.type);

  const where = {
    tenantId: tenant.id,
    ...(eventType ? { eventType } : {}),
    ...(params.entity
      ? { entityType: params.entity }
      : {}),
    ...(params.q
      ? {
          OR: [
            {
              description: {
                contains: params.q,
                mode: "insensitive" as const,
              },
            },
            {
              entityType: {
                contains: params.q,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };

  const [events, entityTypes, totalCount] =
    await Promise.all([
      prisma.eventLog.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        take: 150,
      }),
      prisma.eventLog.findMany({
        where: {
          tenantId: tenant.id,
        },
        distinct: ["entityType"],
        select: {
          entityType: true,
        },
        orderBy: {
          entityType: "asc",
        },
      }),
      prisma.eventLog.count({
        where: {
          tenantId: tenant.id,
        },
      }),
    ]);

  const selectedEvent = params.event
    ? await prisma.eventLog.findFirst({
        where: {
          id: params.event,
          tenantId: tenant.id,
        },
      })
    : null;

  const query = new URLSearchParams();

  if (params.q) query.set("q", params.q);
  if (params.type) query.set("type", params.type);
  if (params.entity) query.set("entity", params.entity);

  const listHref = query.toString()
    ? `/history?${query.toString()}`
    : "/history";

  const metadata = selectedEvent
    ? getAuditMetadata(selectedEvent.metadata)
    : null;

  return (
    <div className="page-container">
      <PageHeader
        title="History"
        description="Append-only audit trail for planning, recovery, review and master-data changes."
        actions={
          <Badge tone="info">
            {totalCount} events
          </Badge>
        }
      />

      <Card className="history-filter-card">
        <CardContent>
          <form
            method="get"
            className="history-filters"
          >
            <label className="history-search">
              <Search size={15} />
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Search history"
              />
            </label>

            <select
              name="type"
              defaultValue={params.type ?? ""}
              className="history-select"
            >
              <option value="">All event types</option>
              {eventTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            <select
              name="entity"
              defaultValue={params.entity ?? ""}
              className="history-select"
            >
              <option value="">All entities</option>
              {entityTypes.map((item) => (
                <option
                  key={item.entityType}
                  value={item.entityType}
                >
                  {item.entityType}
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="ui-button ui-button-secondary"
            >
              <Filter size={14} />
              Apply
            </button>
          </form>
        </CardContent>
      </Card>

      <div
        className="history-workspace"
        data-detail-open={Boolean(selectedEvent)}
      >
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">
                Audit trail
              </span>
              <h2>
                {events.length} matching events
              </h2>
            </div>
          </CardHeader>

          <CardContent className="history-list-content">
            <AuditEventList
              events={events}
              selectedEventId={selectedEvent?.id}
              baseHref={listHref}
            />
          </CardContent>
        </Card>

        {selectedEvent ? (
          <Card className="history-detail-card">
            <CardHeader>
              <div>
                <span className="eyebrow">
                  Event details
                </span>
                <h2>{selectedEvent.eventType}</h2>
              </div>

              <a
                href={listHref}
                className="history-close"
              >
                Close
              </a>
            </CardHeader>

            <CardContent>
              <dl className="history-detail-grid">
                <div>
                  <dt>Entity</dt>
                  <dd>{selectedEvent.entityType}</dd>
                </div>

                <div>
                  <dt>Entity ID</dt>
                  <dd>
                    {selectedEvent.entityId ?? "—"}
                  </dd>
                </div>

                <div>
                  <dt>Actor</dt>
                  <dd>
                    {getAuditText(
                      selectedEvent.metadata,
                      "actorName",
                    ) ??
                      selectedEvent.actorId ??
                      "System"}
                  </dd>
                </div>

                <div>
                  <dt>Source</dt>
                  <dd>
                    {getAuditText(
                      selectedEvent.metadata,
                      "source",
                    ) ?? "Legacy event"}
                  </dd>
                </div>

                <div>
                  <dt>Correlation</dt>
                  <dd>
                    {getAuditText(
                      selectedEvent.metadata,
                      "correlationId",
                    ) ?? "—"}
                  </dd>
                </div>
              </dl>

              <section className="history-description">
                <span className="eyebrow">Description</span>
                <p>
                  {selectedEvent.description ??
                    "No description recorded."}
                </p>
              </section>

              {metadata ? (
                <section className="history-json-section">
                  <span className="eyebrow">
                    Audit metadata
                  </span>

                  <pre>
                    {prettyJson(selectedEvent.metadata)}
                  </pre>
                </section>
              ) : (
                <EmptyState
                  title="No structured metadata"
                  description="This is likely an older audit event created before the standardized audit envelope."
                  icon={<FileClock size={18} />}
                />
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
